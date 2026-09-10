import { forbidden, unauthorized } from '../utils/AppError.js'

/**
 * Answers "what are you allowed to do?".
 *
 * Deliberately separate from `protect`, so authentication and
 * authorization stay two distinct, independently testable steps:
 *
 *   router.get('/dashboard', protect, authorize('admin'), handler)
 *
 * The role is read from req.user (the database), never from the request
 * body or a query parameter.
 */
export function authorize(...allowedRoles) {
  return function checkRole(req, _res, next) {
    if (!req.user) {
      return next(unauthorized('Not authenticated.'))
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        forbidden(
          `This action is restricted to: ${allowedRoles.join(', ')}. Your role is ${req.user.role}.`,
        ),
      )
    }

    return next()
  }
}
