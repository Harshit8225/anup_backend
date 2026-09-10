import mongoose from 'mongoose'

/**
 * The booking lifecycle, exactly as described in the project brief:
 *
 *   pending ──accept──> payment_pending ──pay──> paid ──> booked ──> occupied
 *      └─────reject────> rejected
 *      └─────cancel────> cancelled
 *
 * BOOKING_TRANSITIONS is the single source of truth for what may follow
 * what. The service layer checks it on every status change so a client
 * can never post an arbitrary status.
 */
export const BOOKING_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'payment_pending',
  'paid',
  'booked',
  'occupied',
  'cancelled',
]

export const BOOKING_TRANSITIONS = {
  pending: ['payment_pending', 'rejected', 'cancelled'],
  accepted: ['payment_pending', 'cancelled'],
  payment_pending: ['paid', 'cancelled'],
  paid: ['booked'],
  booked: ['occupied'],
  occupied: [],
  rejected: [],
  cancelled: [],
}

export const PAYMENT_STATUSES = ['not_required', 'pending', 'paid', 'failed']

// Statuses that mean the request is still alive — used to stop a tenant
// from opening two requests on the same property.
export const ACTIVE_BOOKING_STATUSES = [
  'pending',
  'accepted',
  'payment_pending',
  'paid',
  'booked',
  'occupied',
]

const bookingSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Copied from the property when the request is created, so landlord
    // queries stay a single indexed lookup.
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: { values: BOOKING_STATUSES, message: '{VALUE} is not a valid booking status.' },
      default: 'pending',
    },

    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: 'not_required',
    },

    // Rent captured at request time, so a later rent edit cannot change
    // what the tenant agreed to pay.
    monthlyRent: { type: Number, required: true, min: 0 },
    securityDeposit: { type: Number, default: 0, min: 0 },

    moveInDate: { type: Date, required: true },

    // Optional note from the tenant to the landlord.
    message: { type: String, trim: true, maxlength: 500 },

    requestDate: { type: Date, default: Date.now },
    approvalDate: { type: Date, default: null },
    bookingDate: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 300, default: null },
  },
  { timestamps: true },
)

bookingSchema.index({ tenant: 1, status: 1 })
bookingSchema.index({ landlord: 1, status: 1 })
bookingSchema.index({ property: 1, status: 1 })

/** True when `next` is a legal move from the booking's current status. */
bookingSchema.methods.canTransitionTo = function canTransitionTo(next) {
  return (BOOKING_TRANSITIONS[this.status] ?? []).includes(next)
}

export const Booking = mongoose.model('Booking', bookingSchema)
