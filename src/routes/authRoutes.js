import { Router } from 'express'
import { getMe, login, register } from '../controllers/authController.js'
import { loginRules, registerRules } from '../validators/authValidators.js'
import { handleValidation } from '../middleware/validationMiddleware.js'
import { protect } from '../middleware/authMiddleware.js'
import { authLimiter } from '../middleware/rateLimiter.js'

const router = Router()

// Public
router.post('/register', authLimiter, registerRules, handleValidation, register)
router.post('/login', authLimiter, loginRules, handleValidation, login)

// Requires a valid token
router.get('/me', protect, getMe)

export default router
