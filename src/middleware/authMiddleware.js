import { User } from '../models/User.js'
import { verifyToken } from '../utils/generateToken.js'
import { forbidden, unauthorized } from '../utils/AppError.js'

/**
 * Answers "who are you?".
 *
 * Reads the Bearer token, verifies it, loads the user fresh from the
 * database and puts it on req.user. Loading the user every request costs
 * one indexed lookup and means a suspended or deleted account stops
 * working immediately, instead of staying valid until the token expires.
 */
export async function protect(req, _res, next) {
  const header = req.headers.authorization ?? ''

  if (!header.startsWith('Bearer ')) {
    return next(unauthorized('Not authenticated. Please provide a Bearer token.'))
  }

  const token = header.slice('Bearer '.length).trim()

  let payload
  try {
    payload = verifyToken(token)
  } catch (error) {
    const message =
      error.name === 'TokenExpiredError'
        ? 'Your session has expired. Please log in again.'
        : 'Invalid authentication token.'
    return next(unauthorized(message))
  }

  const user = await User.findById(payload.sub)

  if (!user) {
    return next(unauthorized('The account for this token no longer exists.'))
  }

  if (user.status === 'suspended') {
    return next(forbidden('This account has been suspended. Please contact support.'))
  }

  req.user = user
  return next()
}

/**
 * Same as `protect`, but never rejects.
 *
 * Used on public routes whose *results* depend on who is asking: an
 * anonymous visitor sees only verified listings, while a landlord also
 * sees their own pending ones and an admin sees everything. A missing or
 * bad token simply means "anonymous" here rather than an error.
 */
export async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization ?? ''

  if (!header.startsWith('Bearer ')) {
    return next()
  }

  try {
    const payload = verifyToken(header.slice('Bearer '.length).trim())
    const user = await User.findById(payload.sub)

    if (user && user.status !== 'suspended') {
      req.user = user
    }
  } catch {
    // Ignore a bad token: the caller is treated as anonymous.
  }

  return next()
}
