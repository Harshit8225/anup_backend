import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

/**
 * Signs a JWT for a user.
 *
 * The token carries only the user id and role — never the email, name or
 * anything else that can go stale. Everything else is loaded from the
 * database on each request by the auth middleware.
 */
export function generateToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  )
}

/** Verifies a token and returns its payload, or throws. */
export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret)
}
