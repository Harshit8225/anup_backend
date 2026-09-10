import rateLimit from 'express-rate-limit'
import { isProduction } from '../config/env.js'

/**
 * Rate limits, applied only where they genuinely help.
 *
 * The auth endpoints are the ones worth protecting: they are unauthenticated
 * and are the obvious target for password guessing. Limits are relaxed in
 * development so testing with Postman does not lock you out.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProduction ? 20 : 200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please wait a few minutes and try again.',
  },
})

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isProduction ? 120 : 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
  },
})
