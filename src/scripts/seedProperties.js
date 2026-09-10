import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { User } from '../models/User.js'
import { Property } from '../models/Property.js'

/**
 * Seeds a realistic set of listings so search, filters and the nearby
 * query have something to work with, and so the app can be demonstrated
 * end to end.
 *
 * Cities are tier-2/tier-3, matching the project's actual premise. Two
 * landlords are used, which is what makes the ownership rules
 * demonstrable ("landlord A cannot edit landlord B's property").
 *
 * Safe to re-run: it removes only the listings owned by these two seed
 * landlords, never anything a real account created.
 *
 * Run with:  npm run seed:properties
 */

const SEED_LANDLORDS = [
  { name: 'Ramesh Patel', email: 'landlord@test.com', phone: '9812345678' },
  { name: 'Sunita Devi', email: 'landlord2@test.com', phone: '9812345679' },
]

const DEMO_PASSWORD = 'Password123'

const IMG = (id) => `https://images.unsplash.com/photo-${id}?w=800&q=80`

/** landlordIndex picks which seed landlord owns the listing. */
const FIXTURES = [
  {
    landlordIndex: 0,
    title: 'Sunrise PG for Girls near DDU University',
    description:
      'Fully furnished PG for students and working women, a ten minute walk from DDU Gorakhpur University. Home-cooked vegetarian meals three times a day, CCTV on every floor and a warden on site. Power backup covers the whole building.',
    type: 'PG',
    gender: 'Female',
    occupancy: ['Single', 'Double'],
    rent: { single: 7500, double: 5200 },
    deposit: 15000,
    totalRooms: 12,
    availableRooms: 3,
    furnishing: 'Fully-furnished',
    area: 180,
    amenities: ['WiFi', 'Mess/Food', 'CCTV', 'Laundry', 'Power Backup', 'Water 24/7', 'Housekeeping', 'Geyser'],
    landmarks: ['700m from DDU University', '400m from Golghar market', '2km from Gorakhpur Junction'],
    images: [IMG('1555854877-bab0e564b8d5'), IMG('1522708323590-d24dbb6b0267'), IMG('1586023492125-27b2c045efd7')],
    location: { address: 'Betiahata, near Civil Lines', city: 'Gorakhpur', state: 'Uttar Pradesh', pincode: '273001', lat: 26.7606, lng: 83.3732 },
    verificationStatus: 'verified',
    featured: true,
    rating: 4.6,
    reviews: 38,
  },
  {
    landlordIndex: 0,
    title: 'Quiet single room for working professionals',
    description:
      'A private room on the first floor of a family house, with its own entrance and attached bathroom. Suited to a working professional who wants somewhere calm. Walking distance to the bus stand and a daily vegetable market.',
    type: 'Room',
    gender: 'Any',
    occupancy: ['Single'],
    rent: { single: 6000 },
    deposit: 12000,
    totalRooms: 2,
    availableRooms: 1,
    furnishing: 'Semi-furnished',
    area: 160,
    amenities: ['WiFi', 'Water 24/7', 'Power Backup', 'Parking'],
    landmarks: ['300m from Bank Road', '1.5km from Gorakhpur bus stand'],
    images: [IMG('1505691938895-1758d7feb511'), IMG('1493809842364-78817add7ffb')],
    location: { address: 'Bank Road, Civil Lines', city: 'Gorakhpur', state: 'Uttar Pradesh', pincode: '273001', lat: 26.7523, lng: 83.3697 },
    verificationStatus: 'verified',
    rating: 4.2,
    reviews: 14,
  },
  {
    landlordIndex: 0,
    title: 'Boys hostel with mess near engineering college',
    description:
      'Budget hostel built for engineering students, with triple and shared rooms, a common study room and a mess serving three meals. Fifteen minutes from the main engineering campus by shared auto.',
    type: 'Hostel',
    gender: 'Male',
    occupancy: ['Triple', 'Shared'],
    rent: { triple: 4200, shared: 3400 },
    deposit: 5000,
    totalRooms: 24,
    availableRooms: 7,
    furnishing: 'Semi-furnished',
    area: 320,
    amenities: ['WiFi', 'Mess/Food', 'Water 24/7', 'Security Guard', 'Power Backup'],
    landmarks: ['1km from MMMUT campus', '600m from Medical College Road'],
    images: [IMG('1555854877-bab0e564b8d5'), IMG('1522771739844-6a9f6d5f14af')],
    location: { address: 'Deoria Road, near MMMUT', city: 'Gorakhpur', state: 'Uttar Pradesh', pincode: '273010', lat: 26.7311, lng: 83.4479 },
    verificationStatus: 'verified',
    rating: 4.0,
    reviews: 52,
  },
  {
    landlordIndex: 1,
    title: 'Modern co-living flat in Gomti Nagar',
    description:
      'Three private bedrooms sharing a large kitchen and living room, in a gated society with a lift and covered parking. Built for young professionals who want their own room but not their own cooking. Fibre internet included in the rent.',
    type: 'Flat',
    gender: 'Any',
    occupancy: ['Single', 'Double'],
    rent: { single: 12500, double: 8500 },
    deposit: 25000,
    totalRooms: 3,
    availableRooms: 2,
    furnishing: 'Fully-furnished',
    area: 1150,
    amenities: ['WiFi', 'AC', 'Lift', 'Parking', 'Housekeeping', 'Power Backup', 'CCTV', 'Water 24/7'],
    landmarks: ['800m from Lulu Mall', '1.2km from Gomti Nagar station', '3km from Hazratganj'],
    images: [IMG('1560448204-e02f11c3d0e2'), IMG('1522708323590-d24dbb6b0267'), IMG('1484154218962-a197022b5858')],
    location: { address: 'Vibhuti Khand, Gomti Nagar', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226010', lat: 26.8558, lng: 81.0043 },
    verificationStatus: 'verified',
    featured: true,
    rating: 4.7,
    reviews: 41,
  },
  {
    landlordIndex: 1,
    title: 'Studio apartment near Hazratganj metro',
    description:
      'A compact self-contained studio with a kitchenette and attached bathroom, two minutes from the metro. Ideal for someone posted to Lucknow on their own who would rather not share. Rent includes housekeeping twice a week.',
    type: 'Studio',
    gender: 'Any',
    occupancy: ['Single'],
    rent: { single: 11000 },
    deposit: 22000,
    totalRooms: 1,
    availableRooms: 1,
    furnishing: 'Fully-furnished',
    area: 380,
    amenities: ['WiFi', 'AC', 'Lift', 'Geyser', 'Housekeeping', 'Water 24/7'],
    landmarks: ['200m from Hazratganj metro', '900m from GPO'],
    images: [IMG('1493809842364-78817add7ffb'), IMG('1586023492125-27b2c045efd7')],
    location: { address: 'Ashok Marg, Hazratganj', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001', lat: 26.8467, lng: 80.9462 },
    verificationStatus: 'verified',
    rating: 4.4,
    reviews: 23,
  },
  {
    landlordIndex: 1,
    title: 'Shared room in a family home near Assi Ghat',
    description:
      'Two beds in a bright room within a family house in the old city, ten minutes from Assi Ghat and BHU gate. Kitchen access included. Popular with research students staying a semester or two.',
    type: 'Room',
    gender: 'Any',
    occupancy: ['Double', 'Shared'],
    rent: { double: 5500, shared: 4000 },
    deposit: 8000,
    totalRooms: 3,
    availableRooms: 2,
    furnishing: 'Semi-furnished',
    area: 200,
    amenities: ['WiFi', 'Water 24/7', 'Geyser', 'Power Backup'],
    landmarks: ['700m from Assi Ghat', '1km from BHU main gate'],
    images: [IMG('1522771739844-6a9f6d5f14af'), IMG('1505691938895-1758d7feb511')],
    location: { address: 'Lanka, near BHU', city: 'Varanasi', state: 'Uttar Pradesh', pincode: '221005', lat: 25.2677, lng: 82.9913 },
    verificationStatus: 'verified',
    rating: 4.3,
    reviews: 19,
  },
  {
    landlordIndex: 0,
    title: 'Premium PG with AC rooms in Vijay Nagar',
    description:
      'An upmarket PG aimed at IT professionals working in the Vijay Nagar corridor. Air-conditioned single rooms, a gym in the basement, laundry service and a cook who takes requests. The rent reflects the location and the extras.',
    type: 'PG',
    gender: 'Any',
    occupancy: ['Single', 'Double'],
    rent: { single: 15500, double: 11000 },
    deposit: 31000,
    totalRooms: 18,
    availableRooms: 4,
    furnishing: 'Fully-furnished',
    area: 240,
    amenities: ['WiFi', 'AC', 'Gym', 'Laundry', 'Mess/Food', 'CCTV', 'Lift', 'Parking', 'Housekeeping', 'TV'],
    landmarks: ['500m from C21 Mall', '1.5km from Infosys campus', '2km from Bhawarkuan'],
    images: [IMG('1560448204-e02f11c3d0e2'), IMG('1484154218962-a197022b5858'), IMG('1555854877-bab0e564b8d5')],
    location: { address: 'Scheme 54, Vijay Nagar', city: 'Indore', state: 'Madhya Pradesh', pincode: '452010', lat: 22.7533, lng: 75.8937 },
    verificationStatus: 'verified',
    featured: true,
    rating: 4.8,
    reviews: 64,
  },
  {
    landlordIndex: 1,
    title: 'Two bedroom flat for a small family',
    description:
      'An unfurnished 2 BHK on the second floor of a quiet colony, suitable for a small family or two colleagues sharing. Covered parking for one car, water tank plus borewell, and a school within walking distance.',
    type: 'Flat',
    gender: 'Any',
    occupancy: ['Single', 'Double'],
    rent: { single: 13000, double: 13000 },
    deposit: 26000,
    totalRooms: 2,
    availableRooms: 2,
    furnishing: 'Unfurnished',
    area: 850,
    amenities: ['Parking', 'Water 24/7', 'Power Backup', 'Lift'],
    landmarks: ['400m from Malviya Nagar market', '1.8km from Jaipur ring road'],
    images: [IMG('1484154218962-a197022b5858'), IMG('1560448204-e02f11c3d0e2')],
    location: { address: 'Malviya Nagar, Sector 4', city: 'Jaipur', state: 'Rajasthan', pincode: '302017', lat: 26.8505, lng: 75.8065 },
    verificationStatus: 'verified',
    rating: 4.1,
    reviews: 9,
  },
  {
    landlordIndex: 0,
    title: 'Girls PG close to Allahabad University',
    description:
      'A small, quiet PG with six rooms, run by a resident family. Vegetarian meals, a study desk in every room and a 10pm gate time. Five minutes from the university arts faculty on foot.',
    type: 'PG',
    gender: 'Female',
    occupancy: ['Single', 'Double'],
    rent: { single: 6800, double: 4800 },
    deposit: 10000,
    totalRooms: 6,
    availableRooms: 0,
    furnishing: 'Fully-furnished',
    area: 170,
    amenities: ['WiFi', 'Mess/Food', 'Water 24/7', 'CCTV', 'Geyser'],
    landmarks: ['350m from Allahabad University', '1km from Civil Lines'],
    images: [IMG('1522708323590-d24dbb6b0267'), IMG('1586023492125-27b2c045efd7')],
    location: { address: 'Katra, near University Road', city: 'Prayagraj', state: 'Uttar Pradesh', pincode: '211002', lat: 25.4805, lng: 81.8632 },
    // Every room is taken — this is the fixture that demonstrates an
    // occupied listing still being visible but not bookable.
    availabilityStatus: 'occupied',
    verificationStatus: 'verified',
    rating: 4.5,
    reviews: 31,
  },
  {
    landlordIndex: 1,
    title: 'Newly built rooms awaiting verification',
    description:
      'Four newly finished rooms above a shop on the main road, with independent electricity meters. This listing was submitted recently and has not been through admin verification yet, so it is not publicly discoverable.',
    type: 'Room',
    gender: 'Any',
    occupancy: ['Single', 'Double'],
    rent: { single: 5800, double: 4200 },
    deposit: 9000,
    totalRooms: 4,
    availableRooms: 4,
    furnishing: 'Semi-furnished',
    area: 150,
    amenities: ['Water 24/7', 'Power Backup'],
    landmarks: ['On Faizabad Road', '2km from Indira Nagar'],
    images: [IMG('1505691938895-1758d7feb511')],
    location: { address: 'Faizabad Road, Indira Nagar', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226016', lat: 26.8934, lng: 80.9812 },
    // Left pending on purpose: it should NOT appear in public search.
    verificationStatus: 'pending',
    rating: 0,
    reviews: 0,
  },
]

async function ensureLandlord({ name, email, phone }) {
  const existing = await User.findOne({ email })
  const user = existing ?? new User({ email })

  user.name = name
  user.phone = phone
  user.role = 'landlord'
  user.status = 'active'
  if (!existing) {
    await user.setPassword(DEMO_PASSWORD)
  }
  await user.save()

  return user
}

async function seedProperties() {
  await connectDatabase()

  const landlords = []
  for (const seed of SEED_LANDLORDS) {
    const landlord = await ensureLandlord(seed)
    landlords.push(landlord)
    console.log(`Landlord ready: ${landlord.email}`)
  }

  const landlordIds = landlords.map((landlord) => landlord._id)
  const removed = await Property.deleteMany({ landlord: { $in: landlordIds } })
  if (removed.deletedCount > 0) {
    console.log(`Cleared ${removed.deletedCount} previously seeded listing(s).`)
  }

  for (const fixture of FIXTURES) {
    const { landlordIndex, location, ...rest } = fixture

    const property = new Property({
      ...rest,
      landlord: landlordIds[landlordIndex],
      location: {
        address: location.address,
        city: location.city,
        state: location.state,
        pincode: location.pincode,
        geo: { type: 'Point', coordinates: [location.lng, location.lat] },
      },
    })

    await property.save()
    console.log(`  + ${property.title} (${property.location.city}, ${property.verificationStatus})`)
  }

  const publicCount = await Property.countDocuments({
    verificationStatus: 'verified',
    availabilityStatus: { $in: ['available', 'booked', 'occupied'] },
  })

  console.log(`\n${FIXTURES.length} listings seeded; ${publicCount} are publicly discoverable.`)
  console.log(`Seed landlords use the password: ${DEMO_PASSWORD}`)
  console.log('These are development fixtures — do not seed them in production.')

  await disconnectDatabase()
}

seedProperties().catch(async (error) => {
  console.error('Property seeding failed:', error.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
