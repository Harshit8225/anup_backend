import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService.js'

// GET /api/notifications
export async function getNotifications(req, res) {
  const data = await listNotifications(req.user, req.query)

  res.status(200).json({ success: true, data })
}

// PATCH /api/notifications/:id/read
export async function readNotification(req, res) {
  const notification = await markNotificationRead(req.params.id, req.user)

  res.status(200).json({ success: true, data: { notification } })
}

// PATCH /api/notifications/read-all
export async function readAllNotifications(req, res) {
  const result = await markAllNotificationsRead(req.user)

  res.status(200).json({ success: true, message: 'All notifications marked read.', data: result })
}
