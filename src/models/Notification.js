import mongoose from 'mongoose'

/**
 * An in-app notification.
 *
 * Created by the backend whenever a meaningful booking, payment or
 * moderation event happens — never by the client. Read state is a
 * timestamp rather than a boolean, so history is kept and "mark as read"
 * never deletes anything.
 */
export const NOTIFICATION_TYPES = [
  'booking_requested',
  'booking_accepted',
  'booking_rejected',
  'booking_cancelled',
  'payment_pending',
  'payment_confirmed',
  'property_verified',
  'property_rejected',
  'property_suspended',
  'report_resolved',
]

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    type: {
      type: String,
      enum: { values: NOTIFICATION_TYPES, message: '{VALUE} is not a valid notification type.' },
      required: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 400 },

    // What this notification is about, so the UI can link straight to it.
    relatedEntity: {
      kind: { type: String, enum: ['booking', 'property', 'report', 'payment'], default: null },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
    },

    readAt: { type: Date, default: null },
  },
  { timestamps: true },
)

// The two queries the UI makes: a user's feed, and their unread count.
notificationSchema.index({ user: 1, createdAt: -1 })
notificationSchema.index({ user: 1, readAt: 1 })

notificationSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    type: this.type,
    title: this.title,
    body: this.body,
    relatedEntity: this.relatedEntity?.kind
      ? { kind: this.relatedEntity.kind, id: this.relatedEntity.id }
      : null,
    read: Boolean(this.readAt),
    readAt: this.readAt,
    createdAt: this.createdAt,
  }
}

export const Notification = mongoose.model('Notification', notificationSchema)
