/**
 * An error we raised on purpose, with an HTTP status attached.
 *
 * Controllers and services throw this; the central error middleware
 * turns it into a clean JSON response. Anything that is NOT an AppError
 * is treated as an unexpected bug and reported as a generic 500.
 *
 * `code` is a stable, machine-readable identifier (INVALID_BOOKING_STATE,
 * NOT_OWNER, ...). The frontend can branch on it without matching on
 * human-readable message text, which is free to change.
 */
export class AppError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code ?? defaultCodeFor(statusCode)
    this.details = details
    this.isOperational = true
  }
}

function defaultCodeFor(statusCode) {
  switch (statusCode) {
    case 400: return 'BAD_REQUEST'
    case 401: return 'UNAUTHENTICATED'
    case 403: return 'FORBIDDEN'
    case 404: return 'NOT_FOUND'
    case 409: return 'CONFLICT'
    case 422: return 'UNPROCESSABLE'
    default: return 'INTERNAL_ERROR'
  }
}

export const badRequest = (message, details, code) =>
  new AppError(400, message, { code: code ?? 'VALIDATION_FAILED', details })

export const unauthorized = (message = 'Not authenticated.', code) =>
  new AppError(401, message, { code })

export const forbidden = (message = 'You do not have permission to do that.', code) =>
  new AppError(403, message, { code })

export const notFound = (message = 'Resource not found.', code) =>
  new AppError(404, message, { code })

export const conflict = (message, code) =>
  new AppError(409, message, { code })
