import { Router } from 'express'
import authRoutes from './authRoutes.js'
import propertyRoutes from './propertyRoutes.js'
import bookingRoutes from './bookingRoutes.js'
import notificationRoutes from './notificationRoutes.js'

/**
 * Single place where API modules are mounted. As later phases add
 * payments, landlord dashboards and admin moderation, they get
 * registered here and nowhere else.
 */
const router = Router()

router.use('/auth', authRoutes)
router.use('/properties', propertyRoutes)
router.use('/bookings', bookingRoutes)
router.use('/notifications', notificationRoutes)

export default router
