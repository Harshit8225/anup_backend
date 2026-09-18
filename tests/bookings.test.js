/**
 * Phase 7 tests: the booking state machine, ownership, double-booking
 * prevention and the notifications those events produce.
 *
 * Runs against its own throwaway database (staysphere_test_bookings),
 * dropped afterwards.
 *
 * Requires a local MongoDB on 27017.
 */
import test, { after, before, beforeEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTestUri } from './testDatabase.js'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = resolveTestUri('staysphere_test_bookings')
process.env.JWT_SECRET = 'test-secret-do-not-use-anywhere-else'

const mongoose = (await import('mongoose')).default
const { createApp } = await import('../src/app.js')
const { connectDatabase } = await import('../src/config/db.js')
const { User } = await import('../src/models/User.js')
const { Property } = await import('../src/models/Property.js')
const { Booking } = await import('../src/models/Booking.js')
const { Notification } = await import('../src/models/Notification.js')

let baseUrl
let server
const tokens = {}
const ids = {}

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

async function registerAndLogin(account) {
  await call('/api/auth/register', { method: 'POST', body: account })
  const { body } = await call('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  })
  return body.data.token
}

const TENANT = { name: 'Arjun Sharma', email: 'tenant-b@test.com', phone: '9876543210', password: 'Password123', role: 'tenant' }
const TENANT2 = { name: 'Neha Singh', email: 'tenant2-b@test.com', phone: '9876543211', password: 'Password123', role: 'tenant' }
const LANDLORD = { name: 'Ramesh Patel', email: 'landlord-b@test.com', phone: '9812345678', password: 'Password123', role: 'landlord' }
const OTHER_LANDLORD = { name: 'Sunita Devi', email: 'landlord2-b@test.com', phone: '9812345679', password: 'Password123', role: 'landlord' }

/** A verified, available property with `rooms` rooms free. */
async function makeProperty({ rooms = 3, landlordId } = {}) {
  const property = new Property({
    title: 'Sunrise PG for tests near campus',
    description: 'A seeded listing used by the booking tests, long enough to satisfy the validation rules.',
    type: 'PG',
    gender: 'Any',
    occupancy: ['Single', 'Double'],
    rent: { single: 7000, double: 5000 },
    deposit: 14000,
    totalRooms: Math.max(rooms, 1),
    availableRooms: rooms,
    landlord: landlordId ?? ids.landlord,
    verificationStatus: 'verified',
    availabilityStatus: rooms > 0 ? 'available' : 'booked',
    location: {
      address: 'Civil Lines', city: 'Gorakhpur', state: 'Uttar Pradesh', pincode: '273001',
      geo: { type: 'Point', coordinates: [83.3732, 26.7606] },
    },
  })
  await property.save()
  return property
}

function bookingPayload(propertyId, overrides = {}) {
  const moveIn = new Date()
  moveIn.setDate(moveIn.getDate() + 14)

  return {
    propertyId: String(propertyId),
    occupancyType: 'Single',
    moveInDate: moveIn.toISOString(),
    durationMonths: 11,
    message: 'I would like to move in this month.',
    ...overrides,
  }
}

before(async () => {
  await connectDatabase()
  await mongoose.connection.dropDatabase()
  await Promise.all([Property.syncIndexes(), User.syncIndexes(), Booking.syncIndexes()])

  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  tokens.tenant = await registerAndLogin(TENANT)
  tokens.tenant2 = await registerAndLogin(TENANT2)
  tokens.landlord = await registerAndLogin(LANDLORD)
  tokens.otherLandlord = await registerAndLogin(OTHER_LANDLORD)

  ids.tenant = (await User.findOne({ email: TENANT.email }))._id
  ids.tenant2 = (await User.findOne({ email: TENANT2.email }))._id
  ids.landlord = (await User.findOne({ email: LANDLORD.email }))._id
  ids.otherLandlord = (await User.findOne({ email: OTHER_LANDLORD.email }))._id
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await new Promise((resolve) => server.close(resolve))
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([Booking.deleteMany({}), Property.deleteMany({}), Notification.deleteMany({})])
})

describe('Creating a booking request', () => {
  test('a tenant can request an available property', async () => {
    const property = await makeProperty()
    const { status, body } = await call('/api/bookings', {
      method: 'POST',
      token: tokens.tenant,
      body: bookingPayload(property._id),
    })

    assert.equal(status, 201)
    assert.equal(body.data.booking.status, 'pending')
    // Rent is taken from the property, not the request body.
    assert.equal(body.data.booking.monthlyRent, 7000)
    assert.equal(body.data.booking.securityDeposit, 14000)
    assert.equal(body.data.booking.property.id, String(property._id))
  })

  test('the rent cannot be dictated by the client', async () => {
    const property = await makeProperty()
    const { body } = await call('/api/bookings', {
      method: 'POST',
      token: tokens.tenant,
      body: bookingPayload(property._id, { monthlyRent: 1, securityDeposit: 0, status: 'booked' }),
    })

    assert.equal(body.data.booking.monthlyRent, 7000)
    assert.equal(body.data.booking.status, 'pending')
  })

  test('notifies the landlord', async () => {
    const property = await makeProperty()
    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(property._id) })

    const notifications = await Notification.find({ user: ids.landlord })
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].type, 'booking_requested')
  })

  test('a landlord cannot request their own property', async () => {
    const property = await makeProperty()
    const { status, body } = await call('/api/bookings', {
      method: 'POST',
      token: tokens.landlord,
      body: bookingPayload(property._id),
    })

    // Blocked by role before ownership even matters.
    assert.equal(status, 403)
    assert.ok(body.code)
  })

  test('the same tenant cannot open two requests for one property', async () => {
    const property = await makeProperty()
    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(property._id) })
    const second = await call('/api/bookings', {
      method: 'POST',
      token: tokens.tenant,
      body: bookingPayload(property._id),
    })

    assert.equal(second.status, 409)
    assert.equal(second.body.code, 'DUPLICATE_REQUEST')
  })

  test('an unverified property cannot be booked', async () => {
    const property = await makeProperty()
    property.verificationStatus = 'pending'
    await property.save()

    const { status, body } = await call('/api/bookings', {
      method: 'POST',
      token: tokens.tenant,
      body: bookingPayload(property._id),
    })

    assert.equal(status, 400)
    assert.equal(body.code, 'PROPERTY_NOT_VERIFIED')
  })

  test('an occupancy the property does not offer is rejected', async () => {
    const property = await makeProperty()
    const { status, body } = await call('/api/bookings', {
      method: 'POST',
      token: tokens.tenant,
      body: bookingPayload(property._id, { occupancyType: 'Triple' }),
    })

    assert.equal(status, 400)
    assert.equal(body.code, 'OCCUPANCY_NOT_OFFERED')
  })

  test('a move-in date in the past is rejected', async () => {
    const property = await makeProperty()
    const { status, body } = await call('/api/bookings', {
      method: 'POST',
      token: tokens.tenant,
      body: bookingPayload(property._id, { moveInDate: '2020-01-01' }),
    })

    assert.equal(status, 400)
    assert.ok(body.errors.moveInDate)
  })
})

describe('Approving and rejecting', () => {
  let bookingId
  let property

  beforeEach(async () => {
    property = await makeProperty({ rooms: 2 })
    const { body } = await call('/api/bookings', {
      method: 'POST',
      token: tokens.tenant,
      body: bookingPayload(property._id),
    })
    bookingId = body.data.booking.id
  })

  test('the owning landlord can approve, which opens the payment step', async () => {
    const { status, body } = await call(`/api/bookings/${bookingId}/approve`, {
      method: 'PATCH',
      token: tokens.landlord,
    })

    assert.equal(status, 200)
    assert.equal(body.data.booking.status, 'payment_pending')
    assert.equal(body.data.booking.paymentStatus, 'pending')
    assert.ok(body.data.booking.approvedAt)

    // The history records the route taken, including the intermediate state.
    const states = body.data.booking.history.map((h) => h.to)
    assert.deepEqual(states, ['pending', 'accepted', 'payment_pending'])
  })

  test('approving claims a room', async () => {
    await call(`/api/bookings/${bookingId}/approve`, { method: 'PATCH', token: tokens.landlord })

    const updated = await Property.findById(property._id)
    assert.equal(updated.availableRooms, 1)
    assert.equal(updated.availabilityStatus, 'available')
  })

  test('claiming the last room marks the listing booked', async () => {
    const single = await makeProperty({ rooms: 1 })
    const created = await call('/api/bookings', {
      method: 'POST',
      token: tokens.tenant2,
      body: bookingPayload(single._id),
    })
    await call(`/api/bookings/${created.body.data.booking.id}/approve`, {
      method: 'PATCH',
      token: tokens.landlord,
    })

    const updated = await Property.findById(single._id)
    assert.equal(updated.availableRooms, 0)
    assert.equal(updated.availabilityStatus, 'booked')
  })

  test('another landlord cannot approve it', async () => {
    const { status, body } = await call(`/api/bookings/${bookingId}/approve`, {
      method: 'PATCH',
      token: tokens.otherLandlord,
    })

    assert.equal(status, 403)
    assert.equal(body.code, 'NOT_OWNER')
  })

  test('a tenant cannot approve their own booking', async () => {
    const { status } = await call(`/api/bookings/${bookingId}/approve`, {
      method: 'PATCH',
      token: tokens.tenant,
    })

    assert.equal(status, 403)
  })

  test('a booking cannot be approved twice', async () => {
    await call(`/api/bookings/${bookingId}/approve`, { method: 'PATCH', token: tokens.landlord })
    const second = await call(`/api/bookings/${bookingId}/approve`, {
      method: 'PATCH',
      token: tokens.landlord,
    })

    assert.equal(second.status, 409)
    assert.equal(second.body.code, 'INVALID_BOOKING_STATE')

    // And the second attempt must not have claimed another room.
    const updated = await Property.findById(property._id)
    assert.equal(updated.availableRooms, 1)
  })

  test('rejecting records the reason and notifies the tenant', async () => {
    const { status, body } = await call(`/api/bookings/${bookingId}/reject`, {
      method: 'PATCH',
      token: tokens.landlord,
      body: { reason: 'Already promised to another tenant.' },
    })

    assert.equal(status, 200)
    assert.equal(body.data.booking.status, 'rejected')
    assert.equal(body.data.booking.rejectionReason, 'Already promised to another tenant.')

    const notifications = await Notification.find({ user: ids.tenant, type: 'booking_rejected' })
    assert.equal(notifications.length, 1)
  })

  test('a rejected booking cannot then be approved', async () => {
    await call(`/api/bookings/${bookingId}/reject`, { method: 'PATCH', token: tokens.landlord })
    const { status, body } = await call(`/api/bookings/${bookingId}/approve`, {
      method: 'PATCH',
      token: tokens.landlord,
    })

    assert.equal(status, 409)
    assert.equal(body.code, 'INVALID_BOOKING_STATE')
  })

  test('rejecting does not consume a room', async () => {
    await call(`/api/bookings/${bookingId}/reject`, { method: 'PATCH', token: tokens.landlord })

    const updated = await Property.findById(property._id)
    assert.equal(updated.availableRooms, 2)
  })
})

describe('Double-booking prevention', () => {
  test('two approvals racing for the last room: only one wins', async () => {
    const property = await makeProperty({ rooms: 1 })

    const first = await call('/api/bookings', {
      method: 'POST', token: tokens.tenant, body: bookingPayload(property._id),
    })
    const second = await call('/api/bookings', {
      method: 'POST', token: tokens.tenant2, body: bookingPayload(property._id),
    })

    // Both requests are legitimate; the conflict only appears on approval.
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)

    const [a, b] = await Promise.all([
      call(`/api/bookings/${first.body.data.booking.id}/approve`, { method: 'PATCH', token: tokens.landlord }),
      call(`/api/bookings/${second.body.data.booking.id}/approve`, { method: 'PATCH', token: tokens.landlord }),
    ])

    const statuses = [a.status, b.status].sort()
    assert.deepEqual(statuses, [200, 409], `expected one success and one conflict, got ${statuses}`)

    const updated = await Property.findById(property._id)
    assert.equal(updated.availableRooms, 0, 'rooms must never go negative')
    assert.equal(updated.availabilityStatus, 'booked')
  })

  test('a property with no rooms left cannot be requested', async () => {
    const property = await makeProperty({ rooms: 0 })

    const { status, body } = await call('/api/bookings', {
      method: 'POST', token: tokens.tenant, body: bookingPayload(property._id),
    })

    assert.equal(status, 409)
    assert.ok(['PROPERTY_UNAVAILABLE', 'NO_ROOMS_AVAILABLE'].includes(body.code))
  })
})

describe('Cancelling', () => {
  test('a tenant can cancel their pending request', async () => {
    const property = await makeProperty()
    const created = await call('/api/bookings', {
      method: 'POST', token: tokens.tenant, body: bookingPayload(property._id),
    })

    const { status, body } = await call(`/api/bookings/${created.body.data.booking.id}/cancel`, {
      method: 'PATCH',
      token: tokens.tenant,
      body: { reason: 'Found somewhere closer.' },
    })

    assert.equal(status, 200)
    assert.equal(body.data.booking.status, 'cancelled')
  })

  test('cancelling after approval releases the claimed room', async () => {
    const property = await makeProperty({ rooms: 1 })
    const created = await call('/api/bookings', {
      method: 'POST', token: tokens.tenant, body: bookingPayload(property._id),
    })
    await call(`/api/bookings/${created.body.data.booking.id}/approve`, {
      method: 'PATCH', token: tokens.landlord,
    })

    const claimed = await Property.findById(property._id)
    assert.equal(claimed.availableRooms, 0)
    assert.equal(claimed.availabilityStatus, 'booked')

    await call(`/api/bookings/${created.body.data.booking.id}/cancel`, {
      method: 'PATCH', token: tokens.tenant,
    })

    const released = await Property.findById(property._id)
    assert.equal(released.availableRooms, 1)
    assert.equal(released.availabilityStatus, 'available')
  })

  test('another tenant cannot cancel someone else\'s booking', async () => {
    const property = await makeProperty()
    const created = await call('/api/bookings', {
      method: 'POST', token: tokens.tenant, body: bookingPayload(property._id),
    })

    const { status, body } = await call(`/api/bookings/${created.body.data.booking.id}/cancel`, {
      method: 'PATCH', token: tokens.tenant2,
    })

    assert.equal(status, 403)
    assert.equal(body.code, 'NOT_OWNER')
  })
})

describe('Reading bookings', () => {
  test('a tenant sees only their own', async () => {
    const property = await makeProperty()
    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(property._id) })
    await call('/api/bookings', { method: 'POST', token: tokens.tenant2, body: bookingPayload(property._id) })

    const { body } = await call('/api/bookings/my-bookings', { token: tokens.tenant })

    assert.equal(body.data.pagination.total, 1)
    assert.equal(body.data.bookings[0].tenant.email, TENANT.email)
  })

  test('a landlord sees requests for their properties', async () => {
    const mine = await makeProperty()
    const theirs = await makeProperty({ landlordId: ids.otherLandlord })

    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(mine._id) })
    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(theirs._id) })

    const { body } = await call('/api/bookings/landlord', { token: tokens.landlord })

    assert.equal(body.data.pagination.total, 1)
    assert.equal(body.data.bookings[0].property.id, String(mine._id))
  })

  test('an unrelated user cannot read a booking by id', async () => {
    const property = await makeProperty()
    const created = await call('/api/bookings', {
      method: 'POST', token: tokens.tenant, body: bookingPayload(property._id),
    })

    const asStranger = await call(`/api/bookings/${created.body.data.booking.id}`, { token: tokens.tenant2 })
    const asTenant = await call(`/api/bookings/${created.body.data.booking.id}`, { token: tokens.tenant })
    const asLandlord = await call(`/api/bookings/${created.body.data.booking.id}`, { token: tokens.landlord })

    // 404 rather than 403, so bookings cannot be enumerated.
    assert.equal(asStranger.status, 404)
    assert.equal(asTenant.status, 200)
    assert.equal(asLandlord.status, 200)
  })

  test('booking routes require authentication', async () => {
    assert.equal((await call('/api/bookings/my-bookings')).status, 401)
    assert.equal((await call('/api/bookings', { method: 'POST' })).status, 401)
  })
})

describe('Notifications', () => {
  test('a user reads their own feed with an unread count', async () => {
    const property = await makeProperty()
    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(property._id) })

    const { status, body } = await call('/api/notifications', { token: tokens.landlord })

    assert.equal(status, 200)
    assert.equal(body.data.unreadCount, 1)
    assert.equal(body.data.notifications[0].type, 'booking_requested')
    assert.equal(body.data.notifications[0].read, false)
  })

  test('marking one read clears it from the unread count', async () => {
    const property = await makeProperty()
    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(property._id) })

    const feed = await call('/api/notifications', { token: tokens.landlord })
    const id = feed.body.data.notifications[0].id

    const marked = await call(`/api/notifications/${id}/read`, { method: 'PATCH', token: tokens.landlord })
    assert.equal(marked.status, 200)
    assert.equal(marked.body.data.notification.read, true)

    const after = await call('/api/notifications', { token: tokens.landlord })
    assert.equal(after.body.data.unreadCount, 0)
  })

  test('a user cannot read someone else\'s notification', async () => {
    const property = await makeProperty()
    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(property._id) })

    const feed = await call('/api/notifications', { token: tokens.landlord })
    const id = feed.body.data.notifications[0].id

    const { status, body } = await call(`/api/notifications/${id}/read`, {
      method: 'PATCH',
      token: tokens.tenant,
    })

    assert.equal(status, 403)
    assert.equal(body.code, 'NOT_OWNER')
  })

  test('each user only sees their own feed', async () => {
    const property = await makeProperty()
    await call('/api/bookings', { method: 'POST', token: tokens.tenant, body: bookingPayload(property._id) })

    const tenantFeed = await call('/api/notifications', { token: tokens.tenant })
    assert.equal(tenantFeed.body.data.notifications.length, 0)
  })
})
