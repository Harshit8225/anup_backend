import { Notification } from '../models/Notification.js'
import { forbidden, notFound } from '../utils/AppError.js'

/**
 * Creating a notification must never break the business action that
 * triggered it — a failed insert here should not roll back an approved
 * booking. So this logs and swallows instead of throwing.
 */
export async function notify({ user, type, title, body, relatedEntity }) {
  try {
    const notification = await Notification.create({ user, type, title, body, relatedEntity })
    return notification
  } catch (error) {
    console.error('Could not create notification:', error.message)
    return null
  }
}

/** A user's own feed, newest first, with their unread count. */
export async function listNotifications(user, query = {}) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(Math.max(1, Number(query.limit) || 20), 50)
  const filter = { user: user._id }

  if (query.unread === 'true') filter.readAt = null

  const [documents, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: user._id, readAt: null }),
  ])

  return {
    notifications: documents.map((n) => n.toPublicJSON()),
    unreadCount: unread,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: (page - 1) * limit + documents.length < total,
    },
  }
}

/** Marks one notification read. Only its owner may do so. */
export async function markNotificationRead(id, user) {
  const notification = await Notification.findById(id)

  if (!notification) {
    throw notFound('Notification not found.')
  }

  if (String(notification.user) !== String(user._id)) {
    throw forbidden('That notification belongs to someone else.', 'NOT_OWNER')
  }

  if (!notification.readAt) {
    notification.readAt = new Date()
    await notification.save()
  }

  return notification.toPublicJSON()
}

export async function markAllNotificationsRead(user) {
  const result = await Notification.updateMany(
    { user: user._id, readAt: null },
    { readAt: new Date() },
  )

  return { updated: result.modifiedCount ?? 0 }
}
