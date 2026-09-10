import { Router } from 'express'
import authRoutes from './authRoutes.js'
import propertyRoutes from './propertyRoutes.js'

/**
 * Single place where API modules are mounted. As later phases add
 * bookings, payments, landlord and admin routes, they get registered
 * here and nowhere else.
 */
const router = Router()

router.use('/auth', authRoutes)
router.use('/properties', propertyRoutes)

export default router
