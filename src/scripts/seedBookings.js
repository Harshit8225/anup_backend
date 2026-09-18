import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { User } from '../models/User.js'
import { Property } from '../models/Property.js'
import { Booking } from '../models/Booking.js'
import { Notification } from '../models/Notification.js'
import {
  approveBooking,
  createBookingRequest,
  rejectBooking,
} from '../services/bookingService.js'

/**
 * Seeds booking requests in every state a demo needs, so each role has
 * something real to look at:
 *
 *   tenant   — a pending request, one awaiting payment, one rejected
 *   landlord — a queue with requests to approve or reject, plus history
 *
 * These go through the real booking service rather than being inserted
 * directly, so the status history, notifications and room counts all end
 * up exactly as they would from live use.
 *
 * Run after seed:demo and seed:properties, or just use `npm run seed`.
 */
const DEMO_PASSWORD = 'Password123'

const SECOND_TENANT = {
  name: 'Neha Singh',
  email: 'tenant2@test.com',
  phone: '9876500011',
  role: 'tenant',
}

function daysFromNow(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

async function ensureUser({ name, email, phone, role }) {
  const existing = await User.findOne({ email })
  const user = existing ?? new User({ email })

  user.name = name
  user.phone = phone
  user.role = role
  user.status = 'active'
  if (!existing) await user.setPassword(DEMO_PASSWORD)
  await user.save()

  return user
}

async function seedBookings() {
  await connectDatabase()

  const tenant = await User.findOne({ email: 'user@test.com' })
  const landlord = await User.findOne({ email: 'landlord@test.com' })

  if (!tenant || !landlord) {
    console.error('Run "npm run seed:demo" first — the demo tenant and landlord are missing.')
    process.exit(1)
  }

  const tenant2 = await ensureUser(SECOND_TENANT)
  console.log(`Second tenant ready: ${tenant2.email}`)

  // Start clean so re-running does not pile up duplicate requests.
  const tenantIds = [tenant._id, tenant2._id]
  const removed = await Booking.deleteMany({ tenant: { $in: tenantIds } })
  await Notification.deleteMany({ user: { $in: [...tenantIds, landlord._id] } })
  if (removed.deletedCount > 0) {
    console.log(`Cleared ${removed.deletedCount} previously seeded booking(s).`)
  }

  // Room counts were decremented by any earlier approvals, so reset the
  // seeded listings to their intended availability first.
  await Property.updateMany(
    { landlord: landlord._id, availabilityStatus: { $in: ['booked', 'available'] } },
    [{ $set: { availableRooms: '$totalRooms', availabilityStatus: 'available' } }],
  )

  const properties = await Property.find({
    landlord: landlord._id,
    verificationStatus: 'verified',
    availabilityStatus: 'available',
  }).sort({ createdAt: 1 })

  if (properties.length < 3) {
    console.error('Run "npm run seed:properties" first — not enough verified listings to book.')
    process.exit(1)
  }

  const [first, second, third] = properties

  // 1. A pending request the landlord can approve or reject live.
  const pending = await createBookingRequest(
    {
      propertyId: first._id,
      occupancyType: first.occupancy[0],
      moveInDate: daysFromNow(21),
      durationMonths: 11,
      userType: 'Student',
      purpose: 'Study',
      message: 'Final year student, looking for a quiet room near campus.',
    },
    tenant,
  )
  console.log(`  pending          ${first.title}`)

  // 2. A second pending request, from another tenant, so the landlord's
  //    queue is not a single row.
  await createBookingRequest(
    {
      propertyId: second._id,
      occupancyType: second.occupancy[0],
      moveInDate: daysFromNow(30),
      durationMonths: 6,
      userType: 'Working Professional',
      purpose: 'Work',
      message: 'Relocating for a new job, can move in next month.',
    },
    tenant2,
  )
  console.log(`  pending          ${second.title} (from ${tenant2.name})`)

  // 3. An approved request, so the tenant lands on the payment step.
  const toApprove = await createBookingRequest(
    {
      propertyId: second._id,
      occupancyType: second.occupancy[0],
      moveInDate: daysFromNow(14),
      durationMonths: 11,
      userType: 'Working Professional',
      purpose: 'Work',
      message: 'Happy to pay the deposit up front.',
    },
    tenant,
  )
  await approveBooking(toApprove.id, landlord)
  console.log(`  payment_pending  ${second.title}`)

  // 4. A rejected request, so the rejection reason has somewhere to show.
  const toReject = await createBookingRequest(
    {
      propertyId: third._id,
      occupancyType: third.occupancy[0],
      moveInDate: daysFromNow(7),
      durationMonths: 3,
      userType: 'Student',
      purpose: 'Study',
      message: 'Can I move in this week?',
    },
    tenant,
  )
  await rejectBooking(toReject.id, landlord, 'Minimum stay for this property is six months.')
  console.log(`  rejected         ${third.title}`)

  const counts = await Booking.aggregate([
    { $match: { tenant: { $in: tenantIds } } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])

  console.log('\nBookings by status:')
  for (const row of counts) console.log(`  ${row._id.padEnd(16)} ${row.n}`)
  console.log(`Notifications created: ${await Notification.countDocuments()}`)
  console.log(`\nThe pending request on "${first.title}" is left for you to approve or reject.`)
  console.log(`(booking id ${pending.id})`)

  await disconnectDatabase()
}

seedBookings().catch(async (error) => {
  console.error('Booking seeding failed:', error.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
