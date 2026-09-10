import dotenv from 'dotenv'

dotenv.config()

/**
 * Reads an environment variable, falling back to a default.
 * Throws when a variable is required but missing, so the server fails
 * loudly at startup instead of misbehaving later.
 */
function read(name, { fallback = undefined, required = false } = {}) {
  const value = process.env[name]

  if (value === undefined || value === '') {
    if (required) {
      throw new Error(`Missing required environment variable: ${name}`)
    }
    return fallback
  }

  return value
}

export const env = {
  nodeEnv: read('NODE_ENV', { fallback: 'development' }),
  port: Number(read('PORT', { fallback: 5000 })),
  mongoUri: read('MONGODB_URI', { required: true }),
  jwtSecret: read('JWT_SECRET', { required: true }),
  jwtExpiresIn: read('JWT_EXPIRES_IN', { fallback: '7d' }),

  // The browser origins allowed to call this API.
  clientOrigins: read('CLIENT_ORIGINS', { fallback: 'http://localhost:5173' })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}

export const isProduction = env.nodeEnv === 'production'
