import mongoose from 'mongoose'
import {
  ACTIVE_BOOKING_STATUSES,
  Booking,
  COMMITTED_BOOKING_STATUSES,
} from '../models/Booking.js'
import { OCCUPANCY_TYPES, Property } from '../models/Property.js'
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError.js'
import { notify } from './notificationService.js'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

function paginate(query) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_LIMIT), MAX_LIMIT)
  return { page, limit, skip: (page - 1) * limit }
}

function toPage(documents, total, { page, limit, skip }) {
  return {
    bookings: documents.map((booking) => booking.toPublicJSON()),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + documents.length < total,
    },
  }
}

const POPULATE = [
  { path: 'tenant', select: 'name email phone' },
  { path: 'landlord', select: 'name email phone' },
  { path: 'property', populate: { path: 'landlord', select: 'name phone profileImage' } },
]

/**
 * Creates a booking request.
 *
 * Every rule here is enforced server-side, because the client is free to
 * send anything: the rent is read from the property rather than the
 * request body, a landlord cannot request their own listing, and a
 * tenant cannot open a second request for a property they are already
 * waiting on.
 */
export async function createBookingRequest(body, tenant) {
  const property = await Property.findById(body.propertyId)

  if (!property) {
    throw notFound('Property not found.')
  }

  if (property.verificationStatus !== 'verified') {
    throw badRequest('This property is not open for booking yet.', undefined, 'PROPERTY_NOT_VERIFIED')
  }

  if (property.availabilityStatus !== 'available') {
    throw conflict('This property is no longer available.', 'PROPERTY_UNAVAILABLE')
  }

  if (property.availableRooms < 1) {
    throw conflict('This property has no rooms left.', 'NO_ROOMS_AVAILABLE')
  }

  if (String(property.landlord) === String(tenant._id)) {
    throw forbidden('You cannot book your own property.', 'OWN_PROPERTY')
  }

  // The requested tier must be one the property actually offers, and the
  // rent comes from the property — never from the request.
  const occupancyType = body.occupancyType
  if (!property.occupancy.includes(occupancyType)) {
    throw badRequest(
      `This property does not offer ${occupancyType} occupancy.`,
      { occupancyType: `Choose one of: ${property.occupancy.join(', ')}.` },
      'OCCUPANCY_NOT_OFFERED',
    )
  }

  const monthlyRent = property.rent?.[occupancyType.toLowerCase()]
  if (typeof monthlyRent !== 'number') {
    throw badRequest('That occupancy has no rent set.', undefined, 'RENT_NOT_SET')
  }

  const duplicate = await Booking.findOne({
    tenant: tenant._id,
    property: property._id,
    status: { $in: ACTIVE_BOOKING_STATUSES },
  })

  if (duplicate) {
    throw conflict('You already have an open request for this property.', 'DUPLICATE_REQUEST')
  }

  const booking = new Booking({
    tenant: tenant._id,
    landlord: property.landlord,
    property: property._id,
    occupancyType,
    monthlyRent,
    securityDeposit: property.deposit ?? 0,
    moveInDate: body.moveInDate,
    durationMonths: body.durationMonths ?? 11,
    message: body.message,
    history: [{ from: null, to: 'pending', at: new Date(), by: tenant._id }],
  })

  await booking.save()
  await booking.populate(POPULATE)

  await notify({
    user: property.landlord,
    type: 'booking_requested',
    title: 'New booking request',
    body: `${tenant.name} requested ${property.title} (${occupancyType}).`,
    relatedEntity: { kind: 'booking', id: booking._id },
  })

  return booking.toPublicJSON()
}

/** Loads a booking the caller is allowed to see. */
export async function getBookingById(id, user) {
  const booking = await Booking.findById(id).populate(POPULATE)

  if (!booking) {
    throw notFound('Booking not found.')
  }

  const tenantId = String(booking.tenant?._id ?? booking.tenant)
  const landlordId = String(booking.landlord?._id ?? booking.landlord)
  const viewerId = String(user._id)

  if (viewerId !== tenantId && viewerId !== landlordId && user.role !== 'admin') {
    // Same answer as a missing id, so bookings cannot be enumerated.
    throw notFound('Booking not found.')
  }

  return booking.toPublicJSON()
}

export async function getTenantBookings(query, tenant) {
  const pagination = paginate(query)
  const filter = { tenant: tenant._id }
  if (query.status) filter.status = query.status

  const [documents, total] = await Promise.all([
    Booking.find(filter).populate(POPULATE).sort({ createdAt: -1 })
      .skip(pagination.skip).limit(pagination.limit),
    Booking.countDocuments(filter),
  ])

  return toPage(documents, total, pagination)
}

export async function getLandlordBookings(query, landlord) {
  const pagination = paginate(query)
  const filter = { landlord: landlord._id }
  if (query.status) filter.status = query.status

  const [documents, total] = await Promise.all([
    Booking.find(filter).populate(POPULATE).sort({ createdAt: -1 })
      .skip(pagination.skip).limit(pagination.limit),
    Booking.countDocuments(filter),
  ])

  return toPage(documents, total, pagination)
}

/** Loads a booking and checks the caller is the landlord who owns it. */
async function loadForLandlord(id, landlord) {
  const booking = await Booking.findById(id)

  if (!booking) {
    throw notFound('Booking not found.')
  }

  if (String(booking.landlord) !== String(landlord._id)) {
    throw forbidden('This booking is for another landlord’s property.', 'NOT_OWNER')
  }

  return booking
}

/**
 * Approves a pending request.
 *
 * Two guards matter here. First, the state machine: only a pending
 * booking can be approved, so a second approval cannot re-run the flow.
 * Second, double booking: the property is claimed with a conditional
 * update, so if two landlords' requests race, only the one whose update
 * matches an available property wins.
 *
 * On success the booking passes through `accepted` to `payment_pending`,
 * which is the state the payment step starts from.
 */
export async function approveBooking(id, landlord) {
  const booking = await loadForLandlord(id, landlord)

  if (booking.status !== 'pending') {
    throw conflict(
      `This request is ${booking.status.replace('_', ' ')} and can no longer be approved.`,
      'INVALID_BOOKING_STATE',
    )
  }

  const property = await Property.findById(booking.property)
  if (!property) {
    throw notFound('The property for this booking no longer exists.')
  }

  // Claim a room atomically: the filter includes the condition, so two
  // concurrent approvals cannot both succeed on the last room.
  const claimed = await Property.findOneAndUpdate(
    { _id: property._id, availabilityStatus: 'available', availableRooms: { $gte: 1 } },
    { $inc: { availableRooms: -1 } },
    { new: true },
  )

  if (!claimed) {
    throw conflict('That property has no rooms left to approve.', 'NO_ROOMS_AVAILABLE')
  }

  // The last room going means the listing itself is no longer available.
  if (claimed.availableRooms === 0) {
    claimed.availabilityStatus = 'booked'
    await claimed.save()
  }

  booking.transitionTo('accepted', { by: landlord._id })
  booking.approvedAt = new Date()
  booking.transitionTo('payment_pending', { by: landlord._id, note: 'Payment window opened' })
  booking.paymentStatus = 'pending'
  await booking.save()
  await booking.populate(POPULATE)

  await notify({
    user: booking.tenant._id ?? booking.tenant,
    type: 'booking_accepted',
    title: 'Your booking was approved',
    body: `${landlord.name} approved your request. You can now pay to confirm it.`,
    relatedEntity: { kind: 'booking', id: booking._id },
  })

  return booking.toPublicJSON()
}

export async function rejectBooking(id, landlord, reason) {
  const booking = await loadForLandlord(id, landlord)

  if (booking.status !== 'pending') {
    throw conflict(
      `This request is ${booking.status.replace('_', ' ')} and can no longer be rejected.`,
      'INVALID_BOOKING_STATE',
    )
  }

  booking.transitionTo('rejected', { by: landlord._id, note: reason })
  booking.rejectedAt = new Date()
  booking.rejectionReason = reason ?? null
  await booking.save()
  await booking.populate(POPULATE)

  await notify({
    user: booking.tenant._id ?? booking.tenant,
    type: 'booking_rejected',
    title: 'Your booking was declined',
    body: reason
      ? `${landlord.name} declined your request: ${reason}`
      : `${landlord.name} declined your request.`,
    relatedEntity: { kind: 'booking', id: booking._id },
  })

  return booking.toPublicJSON()
}

/**
 * Cancels a booking. A tenant may cancel their own request before it is
 * paid; an admin may cancel any.
 *
 * If the property had a room claimed for this booking, it is released.
 */
export async function cancelBooking(id, user, reason) {
  const booking = await Booking.findById(id)

  if (!booking) {
    throw notFound('Booking not found.')
  }

  const isTenant = String(booking.tenant) === String(user._id)
  if (!isTenant && user.role !== 'admin') {
    throw forbidden('Only the tenant who made this request can cancel it.', 'NOT_OWNER')
  }

  if (!booking.canTransitionTo('cancelled')) {
    throw conflict(
      `A ${booking.status.replace('_', ' ')} booking cannot be cancelled.`,
      'INVALID_BOOKING_STATE',
    )
  }

  // A room was only claimed once the request was approved.
  const roomWasClaimed = ['accepted', 'payment_pending', 'paid', 'booked'].includes(booking.status)

  booking.transitionTo('cancelled', { by: user._id, note: reason })
  booking.cancelledAt = new Date()
  booking.cancellationReason = reason ?? null
  booking.paymentStatus = 'not_required'
  await booking.save()

  if (roomWasClaimed) {
    const property = await Property.findById(booking.property)
    if (property) {
      property.availableRooms = Math.min(property.availableRooms + 1, property.totalRooms)
      if (property.availabilityStatus === 'booked' && property.availableRooms > 0) {
        property.availabilityStatus = 'available'
      }
      await property.save()
    }
  }

  await booking.populate(POPULATE)

  await notify({
    user: booking.landlord._id ?? booking.landlord,
    type: 'booking_cancelled',
    title: 'A booking was cancelled',
    body: `A request for ${booking.property?.title ?? 'your property'} was cancelled.`,
    relatedEntity: { kind: 'booking', id: booking._id },
  })

  return booking.toPublicJSON()
}

/**
 * Marks a paid booking as booked and the property occupied.
 *
 * Exported for the payment phase, which is the only thing that should
 * call it — after a verified payment, never from a client request.
 */
export async function confirmPaidBooking(bookingId, { session } = {}) {
  const booking = await Booking.findById(bookingId).session(session ?? null)

  if (!booking) {
    throw notFound('Booking not found.')
  }

  if (booking.status !== 'paid') {
    throw conflict('Only a paid booking can be confirmed.', 'INVALID_BOOKING_STATE')
  }

  booking.transitionTo('booked', { note: 'Payment verified' })
  booking.bookedAt = new Date()
  booking.paymentStatus = 'paid'
  await booking.save({ session })

  await Property.findByIdAndUpdate(
    booking.property,
    { availabilityStatus: 'occupied' },
    { session },
  )

  await notify({
    user: booking.tenant,
    type: 'payment_confirmed',
    title: 'Booking confirmed',
    body: 'Your payment was verified and your booking is confirmed.',
    relatedEntity: { kind: 'booking', id: booking._id },
  })

  return booking
}

export { OCCUPANCY_TYPES, mongoose }
