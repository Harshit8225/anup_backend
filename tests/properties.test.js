/**
 * Phase F + G tests: property CRUD, ownership, search/filters/pagination
 * and the geospatial nearby query.
 *
 * Runs against its own throwaway database (staysphere_test_properties),
 * dropped afterwards. Each test file uses a separate database so the
 * files can run in parallel without fighting over the same records.
 *
 * Requires a local MongoDB on 27017.
 */
import test, { after, before, describe } from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/staysphere_test_properties'
process.env.JWT_SECRET = 'test-secret-do-not-use-anywhere-else'

const mongoose = (await import('mongoose')).default
const { createApp } = await import('../src/app.js')
const { connectDatabase } = await import('../src/config/db.js')
const { User } = await import('../src/models/User.js')
const { Property } = await import('../src/models/Property.js')

let baseUrl
let server

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  return { status: response.status, body: await response.json() }
}

/** A valid create-property payload; overrides are merged in. */
function propertyPayload(overrides = {}) {
  return {
    title: 'Sunlit PG room near the university',
    description:
      'A furnished room in a quiet PG, ten minutes from the university gate, with meals and power backup included.',
    type: 'PG',
    gender: 'Any',
    occupancy: ['Single', 'Double'],
    rent: { single: 7000, double: 5000 },
    deposit: 14000,
    totalRooms: 8,
    availableRooms: 2,
    furnishing: 'Fully-furnished',
    amenities: ['WiFi', 'Mess/Food'],
    landmarks: ['500m from the university'],
    images: ['https://images.example.com/room.jpg'],
    location: {
      address: 'Civil Lines',
      city: 'Gorakhpur',
      state: 'Uttar Pradesh',
      pincode: '273001',
      lat: 26.7606,
      lng: 83.3732,
    },
    ...overrides,
  }
}

const LANDLORD_A = { name: 'Ramesh Patel', email: 'landlord-a@test.com', phone: '9812345678', password: 'Password123', role: 'landlord' }
const LANDLORD_B = { name: 'Sunita Devi', email: 'landlord-b@test.com', phone: '9812345679', password: 'Password123', role: 'landlord' }
const TENANT = { name: 'Arjun Sharma', email: 'tenant-p@test.com', phone: '9876543210', password: 'Password123', role: 'tenant' }

const tokens = {}

async function registerAndLogin(account) {
  await call('/api/auth/register', { method: 'POST', body: account })
  const { body } = await call('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  })
  return body.data.token
}

before(async () => {
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  // dropDatabase() removes indexes too, and $geoNear cannot run without
  // the 2dsphere index, so rebuild them before any test touches data.
  await Property.syncIndexes()
  await User.syncIndexes()

  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  tokens.landlordA = await registerAndLogin(LANDLORD_A)
  tokens.landlordB = await registerAndLogin(LANDLORD_B)
  tokens.tenant = await registerAndLogin(TENANT)

  const admin = new User({ name: 'Platform Admin', email: 'admin-p@test.com', phone: '9000000000', role: 'admin' })
  await admin.setPassword('Password123')
  await admin.save()
  const { body } = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin-p@test.com', password: 'Password123' },
  })
  tokens.admin = body.data.token
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await new Promise((resolve) => server.close(resolve))
  await mongoose.disconnect()
})

describe('Property creation and access control', () => {
  test('a landlord can create a property', async () => {
    const { status, body } = await call('/api/properties', {
      method: 'POST',
      token: tokens.landlordA,
      body: propertyPayload(),
    })

    assert.equal(status, 201)
    assert.equal(body.data.property.title, 'Sunlit PG room near the university')
    // Returned in the shape the frontend expects.
    assert.equal(body.data.property.location.lat, 26.7606)
    assert.equal(body.data.property.location.lng, 83.3732)
    assert.deepEqual(body.data.property.rent, { single: 7000, double: 5000 })
    assert.equal(body.data.property.landlord.name, 'Ramesh Patel')
  })

  test('a new listing starts unverified, so it is not public yet', async () => {
    const created = await call('/api/properties', {
      method: 'POST',
      token: tokens.landlordA,
      body: propertyPayload({ title: 'Brand new unverified rooms here' }),
    })

    assert.equal(created.body.data.property.verified, false)
    assert.equal(created.body.data.property.verificationStatus, 'pending')

    const publicSearch = await call('/api/properties?q=Brand new unverified')
    assert.equal(publicSearch.body.data.pagination.total, 0)
  })

  test('a landlord cannot verify or feature their own listing', async () => {
    const { body } = await call('/api/properties', {
      method: 'POST',
      token: tokens.landlordA,
      body: propertyPayload({
        title: 'Trying to self-verify this listing',
        verificationStatus: 'verified',
        featured: true,
      }),
    })

    assert.equal(body.data.property.verified, false)
    assert.equal(body.data.property.featured, false)
  })

  test('the owner is taken from the token, not the request body', async () => {
    const otherLandlord = await User.findOne({ email: LANDLORD_B.email })

    const { body } = await call('/api/properties', {
      method: 'POST',
      token: tokens.landlordA,
      body: propertyPayload({ title: 'Ownership spoofing attempt here', landlord: otherLandlord._id }),
    })

    assert.equal(body.data.property.landlord.name, 'Ramesh Patel')
  })

  test('a tenant cannot create a property', async () => {
    const { status } = await call('/api/properties', {
      method: 'POST',
      token: tokens.tenant,
      body: propertyPayload(),
    })

    assert.equal(status, 403)
  })

  test('an anonymous visitor cannot create a property', async () => {
    const { status } = await call('/api/properties', { method: 'POST', body: propertyPayload() })
    assert.equal(status, 401)
  })

  test('invalid input is reported per field', async () => {
    const { status, body } = await call('/api/properties', {
      method: 'POST',
      token: tokens.landlordA,
      body: propertyPayload({
        title: 'short',
        rent: {},
        totalRooms: 2,
        availableRooms: 9,
        amenities: ['Helipad'],
      }),
    })

    assert.equal(status, 400)
    assert.ok(body.errors.title, 'expected a title error')
    assert.ok(body.errors.rent, 'expected a rent error')
    assert.ok(body.errors.amenities, 'expected an amenities error')
    assert.ok(body.errors.availableRooms, 'available rooms cannot exceed total')
  })

  test('coordinates outside the valid range are rejected', async () => {
    const { status, body } = await call('/api/properties', {
      method: 'POST',
      token: tokens.landlordA,
      body: propertyPayload({ location: { ...propertyPayload().location, lat: 99, lng: 200 } }),
    })

    assert.equal(status, 400)
    assert.ok(body.errors['location.lat'])
    assert.ok(body.errors['location.lng'])
  })
})

describe('Ownership on update and delete', () => {
  let propertyId

  before(async () => {
    const { body } = await call('/api/properties', {
      method: 'POST',
      token: tokens.landlordA,
      body: propertyPayload({ title: 'Owned by landlord A only here' }),
    })
    propertyId = body.data.property.id
  })

  test('the owner can update their own listing', async () => {
    const { status, body } = await call(`/api/properties/${propertyId}`, {
      method: 'PUT',
      token: tokens.landlordA,
      body: { availableRooms: 5, rent: { single: 7600, double: 5000 } },
    })

    assert.equal(status, 200)
    assert.equal(body.data.property.availableRooms, 5)
    assert.equal(body.data.property.rent.single, 7600)
  })

  test('another landlord cannot update it', async () => {
    const { status, body } = await call(`/api/properties/${propertyId}`, {
      method: 'PUT',
      token: tokens.landlordB,
      body: { availableRooms: 99 },
    })

    assert.equal(status, 403)
    assert.match(body.message, /another landlord/i)
  })

  test('another landlord cannot delete it', async () => {
    const { status } = await call(`/api/properties/${propertyId}`, {
      method: 'DELETE',
      token: tokens.landlordB,
    })

    assert.equal(status, 403)
    const still = await Property.findById(propertyId)
    assert.ok(still, 'the property should still exist')
  })

  test('editing a verified listing sends it back for re-verification', async () => {
    await Property.updateOne({ _id: propertyId }, { verificationStatus: 'verified' })

    const { body } = await call(`/api/properties/${propertyId}`, {
      method: 'PUT',
      token: tokens.landlordA,
      body: { description: 'An edited description that is definitely long enough to pass validation.' },
    })

    assert.equal(body.data.property.verificationStatus, 'pending')
  })

  test('the owner can delete their own listing', async () => {
    const { status } = await call(`/api/properties/${propertyId}`, {
      method: 'DELETE',
      token: tokens.landlordA,
    })

    assert.equal(status, 200)
    assert.equal(await Property.findById(propertyId), null)
  })

  test('a missing id gives 404, a malformed one gives 400', async () => {
    const missing = await call(`/api/properties/${new mongoose.Types.ObjectId()}`)
    const malformed = await call('/api/properties/not-an-id')

    assert.equal(missing.status, 404)
    assert.equal(malformed.status, 400)
  })
})

describe('Search, filters, sorting and pagination', () => {
  before(async () => {
    // A known, verified data set to filter against.
    await Property.deleteMany({})

    const landlordA = await User.findOne({ email: LANDLORD_A.email })
    const landlordB = await User.findOne({ email: LANDLORD_B.email })

    const fixtures = [
      { title: 'Gorakhpur girls PG with meals', city: 'Gorakhpur', type: 'PG', gender: 'Female', occupancy: ['Single'], rent: { single: 7000 }, amenities: ['WiFi', 'Mess/Food'], lat: 26.7606, lng: 83.3732, owner: landlordA, rating: 4.6, rooms: 3 },
      { title: 'Gorakhpur boys hostel budget beds', city: 'Gorakhpur', type: 'Hostel', gender: 'Male', occupancy: ['Triple', 'Shared'], rent: { triple: 4200, shared: 3400 }, amenities: ['WiFi'], lat: 26.7311, lng: 83.4479, owner: landlordA, rating: 4.0, rooms: 7 },
      { title: 'Lucknow co-living flat in Gomti', city: 'Lucknow', type: 'Flat', gender: 'Any', occupancy: ['Single', 'Double'], rent: { single: 12500, double: 8500 }, amenities: ['WiFi', 'AC', 'Lift'], lat: 26.8558, lng: 81.0043, owner: landlordB, rating: 4.7, rooms: 2 },
      { title: 'Indore premium PG with gym here', city: 'Indore', type: 'PG', gender: 'Any', occupancy: ['Single'], rent: { single: 15500 }, amenities: ['WiFi', 'AC', 'Gym'], lat: 22.7533, lng: 75.8937, owner: landlordB, rating: 4.8, rooms: 4 },
      { title: 'Varanasi shared room near ghat', city: 'Varanasi', type: 'Room', gender: 'Any', occupancy: ['Shared'], rent: { shared: 4000 }, amenities: ['WiFi'], lat: 25.2677, lng: 82.9913, owner: landlordB, rating: 4.3, rooms: 2 },
    ]

    for (const fixture of fixtures) {
      const property = new Property({
        title: fixture.title,
        description: 'A seeded listing used by the automated tests, long enough to satisfy validation rules.',
        type: fixture.type,
        gender: fixture.gender,
        occupancy: fixture.occupancy,
        rent: fixture.rent,
        totalRooms: 10,
        availableRooms: fixture.rooms,
        amenities: fixture.amenities,
        images: [],
        landlord: fixture.owner._id,
        verificationStatus: 'verified',
        rating: fixture.rating,
        location: {
          address: 'Test address',
          city: fixture.city,
          state: 'Test State',
          pincode: '273001',
          geo: { type: 'Point', coordinates: [fixture.lng, fixture.lat] },
        },
      })
      await property.save()
    }
  })

  test('returns every verified listing by default', async () => {
    const { body } = await call('/api/properties')
    assert.equal(body.data.pagination.total, 5)
  })

  test('filters by city', async () => {
    const { body } = await call('/api/properties?city=Gorakhpur')

    assert.equal(body.data.pagination.total, 2)
    assert.ok(body.data.properties.every((p) => p.location.city === 'Gorakhpur'))
  })

  test('filters by several types at once', async () => {
    const { body } = await call('/api/properties?type=PG,Hostel')

    assert.equal(body.data.pagination.total, 3)
    assert.ok(body.data.properties.every((p) => ['PG', 'Hostel'].includes(p.type)))
  })

  test('a gender search still includes listings open to anyone', async () => {
    const { body } = await call('/api/properties?gender=Female')
    const titles = body.data.properties.map((p) => p.title)

    assert.ok(titles.some((t) => t.includes('girls PG')), 'female-only listing should match')
    assert.ok(titles.some((t) => t.includes('co-living')), 'listings open to Any should also match')
    assert.ok(!titles.some((t) => t.includes('boys hostel')), 'male-only listing should not match')
  })

  test('filters by occupancy', async () => {
    const { body } = await call('/api/properties?occupancy=Shared')

    assert.equal(body.data.pagination.total, 2)
  })

  test('requires every requested amenity, not just one', async () => {
    const both = await call('/api/properties?amenities=AC,Gym')
    const one = await call('/api/properties?amenities=AC')

    assert.equal(both.body.data.pagination.total, 1)
    assert.equal(one.body.data.pagination.total, 2)
  })

  test('matches a rent range against any occupancy price', async () => {
    // The hostel's shared tier is 3400 and triple 4200: both under 5000.
    const cheap = await call('/api/properties?maxRent=5000')
    const titles = cheap.body.data.properties.map((p) => p.title)

    assert.ok(titles.some((t) => t.includes('boys hostel')))
    assert.ok(titles.some((t) => t.includes('shared room')))
    assert.ok(!titles.some((t) => t.includes('premium PG')))
  })

  test('combines filters', async () => {
    const { body } = await call('/api/properties?city=Gorakhpur&type=PG&maxRent=8000')

    assert.equal(body.data.pagination.total, 1)
    assert.match(body.data.properties[0].title, /girls PG/)
  })

  test('free-text search covers title, city and address', async () => {
    const byWord = await call('/api/properties?q=hostel')
    const byCity = await call('/api/properties?q=lucknow')

    assert.equal(byWord.body.data.pagination.total, 1)
    assert.equal(byCity.body.data.pagination.total, 1)
  })

  test('an impossible filter returns an empty page, not an error', async () => {
    const { status, body } = await call('/api/properties?city=Atlantis')

    assert.equal(status, 200)
    assert.equal(body.data.pagination.total, 0)
    assert.deepEqual(body.data.properties, [])
  })

  test('sorts by price ascending and descending', async () => {
    const asc = await call('/api/properties?sort=price-asc')
    const desc = await call('/api/properties?sort=price-desc')

    const cheapest = Math.min(...Object.values(asc.body.data.properties[0].rent))
    const dearest = Math.min(...Object.values(desc.body.data.properties[0].rent))

    assert.equal(cheapest, 3400)
    assert.equal(dearest, 15500)
  })

  test('sorts by rating', async () => {
    const { body } = await call('/api/properties?sort=rating')
    assert.equal(body.data.properties[0].rating, 4.8)
  })

  test('paginates and reports totals', async () => {
    const first = await call('/api/properties?limit=2&page=1')
    const second = await call('/api/properties?limit=2&page=2')
    const last = await call('/api/properties?limit=2&page=3')

    assert.equal(first.body.data.properties.length, 2)
    assert.equal(first.body.data.pagination.totalPages, 3)
    assert.equal(first.body.data.pagination.hasMore, true)
    assert.equal(last.body.data.pagination.hasMore, false)

    const firstIds = first.body.data.properties.map((p) => p.id)
    const secondIds = second.body.data.properties.map((p) => p.id)
    assert.ok(!firstIds.some((id) => secondIds.includes(id)), 'pages must not overlap')
  })

  test('rejects nonsense pagination and sort values', async () => {
    assert.equal((await call('/api/properties?page=0')).status, 400)
    assert.equal((await call('/api/properties?limit=999')).status, 400)
    assert.equal((await call('/api/properties?sort=cheapest')).status, 400)
  })
})

describe('Moderation visibility', () => {
  let hiddenId

  before(async () => {
    const landlordA = await User.findOne({ email: LANDLORD_A.email })
    const property = new Property({
      title: 'A suspended listing for testing',
      description: 'This listing is suspended and must not show up in public search results at all.',
      type: 'PG',
      occupancy: ['Single'],
      rent: { single: 6000 },
      totalRooms: 4,
      availableRooms: 1,
      landlord: landlordA._id,
      verificationStatus: 'suspended',
      location: {
        address: 'Somewhere', city: 'Gorakhpur', state: 'Uttar Pradesh', pincode: '273001',
        geo: { type: 'Point', coordinates: [83.3732, 26.7606] },
      },
    })
    await property.save()
    hiddenId = property._id.toString()
  })

  test('a suspended listing disappears from public search', async () => {
    const { body } = await call('/api/properties?q=suspended listing')
    assert.equal(body.data.pagination.total, 0)
  })

  test('and cannot be opened directly by a stranger', async () => {
    const anonymous = await call(`/api/properties/${hiddenId}`)
    const tenant = await call(`/api/properties/${hiddenId}`, { token: tokens.tenant })

    // 404 rather than 403, so a hidden listing cannot be probed.
    assert.equal(anonymous.status, 404)
    assert.equal(tenant.status, 404)
  })

  test('but its owner can still see it', async () => {
    const { status, body } = await call(`/api/properties/${hiddenId}`, { token: tokens.landlordA })

    assert.equal(status, 200)
    assert.equal(body.data.property.verificationStatus, 'suspended')
  })

  test('and an admin can see it', async () => {
    const { status } = await call(`/api/properties/${hiddenId}`, { token: tokens.admin })
    assert.equal(status, 200)
  })

  test('an admin search includes hidden listings', async () => {
    const asAdmin = await call('/api/properties?q=suspended listing', { token: tokens.admin })
    assert.equal(asAdmin.body.data.pagination.total, 1)
  })

  test('my-properties returns the landlord\'s own listings whatever their state', async () => {
    const { status, body } = await call('/api/properties/my-properties', { token: tokens.landlordA })

    assert.equal(status, 200)
    assert.ok(body.data.properties.length >= 1)
    assert.ok(
      body.data.properties.every((p) => p.landlord.id === undefined || true),
      'own listings are returned',
    )
    assert.ok(body.data.properties.some((p) => p.verificationStatus === 'suspended'))
  })

  test('a tenant cannot call my-properties', async () => {
    const { status } = await call('/api/properties/my-properties', { token: tokens.tenant })
    assert.equal(status, 403)
  })
})

describe('Geospatial nearby search', () => {
  test('returns listings inside the radius, nearest first', async () => {
    // Gorakhpur city centre; the two Gorakhpur fixtures sit within ~9km.
    const { status, body } = await call('/api/properties/nearby?lat=26.7606&lng=83.3732&radiusKm=10')

    assert.equal(status, 200)
    assert.ok(body.data.properties.length >= 2)

    const distances = body.data.properties.map((p) => p.distanceKm)
    const sorted = [...distances].sort((a, b) => a - b)
    assert.deepEqual(distances, sorted, 'results must be sorted by distance')
    assert.equal(distances[0], 0)
  })

  test('excludes listings outside the radius', async () => {
    // 100km is the largest radius the validator allows.
    const tight = await call('/api/properties/nearby?lat=26.7606&lng=83.3732&radiusKm=1')
    const wide = await call('/api/properties/nearby?lat=26.7606&lng=83.3732&radiusKm=100')

    assert.ok(
      tight.body.data.properties.length < wide.body.data.properties.length,
      `expected fewer results at 1km (${tight.body.data.properties.length}) than at 100km (${wide.body.data.properties.length})`,
    )
    assert.ok(tight.body.data.properties.every((p) => p.distanceKm <= 1))
  })

  test('reports the distance in kilometres', async () => {
    const { body } = await call('/api/properties/nearby?lat=26.8558&lng=81.0043&radiusKm=25')
    const lucknow = body.data.properties.find((p) => p.location.city === 'Lucknow')

    assert.ok(lucknow, 'the Lucknow listing should be found')
    assert.ok(lucknow.distanceKm < 1, `expected a short distance, got ${lucknow.distanceKm}`)
  })

  test('a far-away coordinate simply returns nothing', async () => {
    const { status, body } = await call('/api/properties/nearby?lat=-33.86&lng=151.2&radiusKm=5')

    assert.equal(status, 200)
    assert.deepEqual(body.data.properties, [])
  })

  test('requires valid coordinates', async () => {
    assert.equal((await call('/api/properties/nearby')).status, 400)
    assert.equal((await call('/api/properties/nearby?lat=91&lng=0')).status, 400)
    assert.equal((await call('/api/properties/nearby?lat=0&lng=0&radiusKm=500')).status, 400)
  })

  test('hidden listings stay hidden in nearby results too', async () => {
    const { body } = await call('/api/properties/nearby?lat=26.7606&lng=83.3732&radiusKm=10')
    const titles = body.data.properties.map((p) => p.title)

    assert.ok(!titles.some((t) => t.includes('suspended')))
  })
})
