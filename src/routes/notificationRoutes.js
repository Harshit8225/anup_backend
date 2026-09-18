import { Router } from 'express'
import { param } from 'express-validator'
import {
  getNotifications,
  readAllNotifications,
  readNotification,
} from '../controllers/notificationController.js'
import { handleValidation } from '../middleware/validationMiddleware.js'
import { protect } from '../middleware/authMiddleware.js'

const router = Router()

router.use(protect)

router.get('/', getNotifications)
router.patch('/read-all', readAllNotifications)
router.patch(
  '/:id/read',
  param('id').isMongoId().withMessage('That notification id is not valid.'),
  handleValidation,
  readNotification,
)

export default router
