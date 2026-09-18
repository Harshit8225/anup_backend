import mongoose from 'mongoose'

/**
 * The booking lifecycle, exactly as specified:
 *
 *   pending ─accept─> accepted ─server─> payment_pending ─paid─> paid
 *                                                                 │
 *                                                          server │
 *                                                                 v
 *                                          completed <─ occupied <─ booked
 *      └─reject─> rejected          └─cancel─> cancelled
 *
 * BOOKING_TRANSITIONS is the single source of truth for what may follow
 * what, and the service checks it on every status change. A client can
 * never post a status directly — it calls an action (approve, reject,
 * cancel) and the server decides the resulting state.
 */
export const BOOKING_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'payment_pending',
  'paid',
  'booked',
  'occupied',
  'completed',
  'cancelled',
]

export const BOOKING_TRANSITIONS = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['payment_pending', 'cancelled'],
  payment_pending: ['paid', 'cancelled'],
  paid: ['booked'],
  booked: ['occupied', 'completed', 'cancelled'],
  occupied: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
}

export const PAYMENT_STATUSES = ['not_required', 'pending', 'paid', 'failed']

/**
 * Statuses that mean a request is still alive. Used to stop a tenant
 * opening two requests on one property, and to stop a second tenant
 * taking a property that is already committed.
 */
export const ACTIVE_BOOKING_STATUSES = [
  'pending',
  'accepted',
  'payment_pending',
  'paid',
  'booked',
  'occupied',
]

/** Statuses where the property is effectively taken, not merely requested. */
export const COMMITTED_BOOKING_STATUSES = ['paid', 'booked', 'occupied']

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

    // Which occupancy tier the tenant asked for, and the rent for it
    // captured at request time — so a later rent edit cannot change what
    // was agreed.
    occupancyType: {
      type: String,
      required: true,
    },
    monthlyRent: { type: Number, required: true, min: 0 },
    securityDeposit: { type: Number, default: 0, min: 0 },

    moveInDate: { type: Date, required: true },
    durationMonths: { type: Number, default: 11, min: 1, max: 60 },

    /**
     * Context the tenant gives about themselves. The landlord sees these
     * when reviewing a request, which is the point of collecting them.
     */
    userType: {
      type: String,
      enum: ['Student', 'Working Professional', 'Other'],
      default: null,
    },
    purpose: {
      type: String,
      enum: ['Study', 'Work', 'Personal'],
      default: null,
    },

    // Optional note from the tenant to the landlord.
    message: { type: String, trim: true, maxlength: 500 },

    requestedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    bookedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    rejectionReason: { type: String, trim: true, maxlength: 300, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 300, default: null },

    /**
     * Every status change, appended in order. Makes a booking's history
     * explainable ("who rejected this, when, and why") instead of only
     * showing its current state.
     */
    history: [
      {
        _id: false,
        from: String,
        to: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: String,
      },
    ],
  },
  { timestamps: true },
)

bookingSchema.index({ tenant: 1, status: 1 })
bookingSchema.index({ landlord: 1, status: 1 })
bookingSchema.index({ property: 1, status: 1 })
bookingSchema.index({ createdAt: -1 })

/** True when `next` is a legal move from the booking's current status. */
bookingSchema.methods.canTransitionTo = function canTransitionTo(next) {
  return (BOOKING_TRANSITIONS[this.status] ?? []).includes(next)
}

/**
 * Moves the booking to `next`, recording who did it and why.
 * Throws if the move is not allowed — callers should check
 * canTransitionTo() first to return a friendlier message.
 */
bookingSchema.methods.transitionTo = function transitionTo(next, { by, note } = {}) {
  if (!this.canTransitionTo(next)) {
    throw new Error(`Cannot move a booking from ${this.status} to ${next}.`)
  }

  this.history.push({ from: this.status, to: next, at: new Date(), by, note })
  this.status = next

  return this
}

/** The shape the API returns. */
bookingSchema.methods.toPublicJSON = function toPublicJSON() {
  const populated = (ref) => (ref && typeof ref === 'object' && ref._id ? ref : null)

  const tenant = populated(this.tenant)
  const landlord = populated(this.landlord)
  const property = populated(this.property)

  return {
    id: this._id,
    status: this.status,
    paymentStatus: this.paymentStatus,

    occupancyType: this.occupancyType,
    userType: this.userType,
    purpose: this.purpose,
    monthlyRent: this.monthlyRent,
    securityDeposit: this.securityDeposit,
    moveInDate: this.moveInDate,
    durationMonths: this.durationMonths,
    message: this.message,

    requestedAt: this.requestedAt,
    approvedAt: this.approvedAt,
    rejectedAt: this.rejectedAt,
    bookedAt: this.bookedAt,
    cancelledAt: this.cancelledAt,
    rejectionReason: this.rejectionReason,
    cancellationReason: this.cancellationReason,

    tenant: tenant
      ? { id: tenant._id, name: tenant.name, email: tenant.email, phone: tenant.phone }
      : { id: this.tenant },
    landlord: landlord
      ? { id: landlord._id, name: landlord.name, email: landlord.email, phone: landlord.phone }
      : { id: this.landlord },
    property: property?.toPublicJSON ? property.toPublicJSON() : { id: this.property },

    history: this.history,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  }
}

export const Booking = mongoose.model('Booking', bookingSchema)
