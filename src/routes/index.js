import { Router } from 'express'
import authRoutes from './authRoutes.js'

/**
 * Single place where API modules are mounted. As later phases add
 * properties, bookings, payments, landlord and admin routes, they get
 * registered here and nowhere else.
 */
const router = Router()

router.use('/auth', authRoutes)

export default router
