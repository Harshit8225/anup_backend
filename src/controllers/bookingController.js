import {
  approveBooking,
  cancelBooking,
  createBookingRequest,
  getBookingById,
  getLandlordBookings,
  getTenantBookings,
  rejectBooking,
} from '../services/bookingService.js'

/**
 * Booking endpoints.
 *
 * Note what no endpoint accepts: a status. A client calls an action —
 * approve, reject, cancel — and the server decides the resulting state.
 */

// POST /api/bookings  (tenant)
export async function requestBooking(req, res) {
  const booking = await createBookingRequest(req.body, req.user)

  res.status(201).json({
    success: true,
    message: 'Booking request sent. The landlord will review it shortly.',
    data: { booking },
  })
}

// GET /api/bookings/my-bookings  (tenant)
export async function listMyBookings(req, res) {
  const { bookings, pagination } = await getTenantBookings(req.query, req.user)

  res.status(200).json({ success: true, data: { bookings, pagination } })
}

// GET /api/bookings/landlord  (landlord)
export async function listLandlordBookings(req, res) {
  const { bookings, pagination } = await getLandlordBookings(req.query, req.user)

  res.status(200).json({ success: true, data: { bookings, pagination } })
}

// GET /api/bookings/:id  (tenant, landlord or admin on that booking)
export async function getBooking(req, res) {
  const booking = await getBookingById(req.params.id, req.user)

  res.status(200).json({ success: true, data: { booking } })
}

// PATCH /api/bookings/:id/approve  (owning landlord)
export async function approve(req, res) {
  const booking = await approveBooking(req.params.id, req.user)

  res.status(200).json({
    success: true,
    message: 'Request approved. The tenant can now pay to confirm.',
    data: { booking },
  })
}

// PATCH /api/bookings/:id/reject  (owning landlord)
export async function reject(req, res) {
  const booking = await rejectBooking(req.params.id, req.user, req.body.reason)

  res.status(200).json({ success: true, message: 'Request rejected.', data: { booking } })
}

// PATCH /api/bookings/:id/cancel  (tenant who made it, or admin)
export async function cancel(req, res) {
  const booking = await cancelBooking(req.params.id, req.user, req.body.reason)

  res.status(200).json({ success: true, message: 'Booking cancelled.', data: { booking } })
}
