import mongoose from 'mongoose'
import { AppError } from '../utils/AppError.js'
import { isProduction } from '../config/env.js'

/** Catch-all for unmatched routes, so clients get JSON instead of HTML. */
export function notFoundHandler(req, _res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`))
}

/**
 * Translates database and library errors into the same response shape the
 * rest of the API uses. Keeping this in one place is what stops stack
 * traces and driver messages from leaking to clients.
 */
function normalizeError(error) {
  if (error instanceof AppError) {
    return error
  }

  // Mongoose schema validation — report per field like our validators do.
  if (error instanceof mongoose.Error.ValidationError) {
    const fieldErrors = {}
    for (const [field, issue] of Object.entries(error.errors)) {
      fieldErrors[field] = issue.message
    }
    return new AppError(400, 'Some fields need your attention.', fieldErrors)
  }

  // A malformed ObjectId in the URL is a client mistake, not a crash.
  if (error instanceof mongoose.Error.CastError) {
    return new AppError(400, `Invalid value for ${error.path}.`)
  }

  // Unique index violation.
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? 'value'
    return new AppError(409, `That ${field} is already in use.`)
  }

  if (error.type === 'entity.parse.failed') {
    return new AppError(400, 'Request body is not valid JSON.')
  }

  return null
}

export function errorHandler(error, _req, res, _next) {
  const known = normalizeError(error)

  if (known) {
    return res.status(known.statusCode).json({
      success: false,
      message: known.message,
      ...(known.details ? { errors: known.details } : {}),
    })
  }

  // Anything reaching here is an unexpected bug: log it in full for us,
  // return something safe and generic to the client.
  console.error('Unhandled error:', error)

  return res.status(500).json({
    success: false,
    message: 'Something went wrong on our side. Please try again.',
    ...(isProduction ? {} : { debug: error.message }),
  })
}
