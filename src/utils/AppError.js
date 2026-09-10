/**
 * An error we raised on purpose, with an HTTP status attached.
 *
 * Controllers and services throw this; the central error middleware
 * turns it into a clean JSON response. Anything that is NOT an AppError
 * is treated as an unexpected bug and reported as a generic 500.
 */
export class AppError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.details = details
    this.isOperational = true
  }
}

export const badRequest = (message, details) => new AppError(400, message, details)
export const unauthorized = (message = 'Not authenticated.') => new AppError(401, message)
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, message)
export const notFound = (message = 'Resource not found.') => new AppError(404, message)
export const conflict = (message) => new AppError(409, message)
