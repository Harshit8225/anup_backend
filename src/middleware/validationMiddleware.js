import { validationResult } from 'express-validator'
import { badRequest } from '../utils/AppError.js'

/**
 * Runs after a route's express-validator rules and turns any collected
 * problems into a single 400 with a field-by-field breakdown, which is
 * what the frontend forms need to show inline errors.
 */
export function handleValidation(req, _res, next) {
  const result = validationResult(req)

  if (result.isEmpty()) {
    return next()
  }

  const fieldErrors = {}
  for (const error of result.array()) {
    // Keep the first message per field — forms show one error at a time.
    if (!fieldErrors[error.path]) {
      fieldErrors[error.path] = error.msg
    }
  }

  return next(badRequest('Some fields need your attention.', fieldErrors))
}
