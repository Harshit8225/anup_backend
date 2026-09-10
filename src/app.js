import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { env } from './config/env.js'
import { apiLimiter } from './middleware/rateLimiter.js'
import { errorHandler, notFoundHandler } from './middleware/errorMiddleware.js'
import apiRoutes from './routes/index.js'

/**
 * Builds the Express application.
 *
 * Kept separate from server.js so the app can be imported for testing
 * without opening a port or a database connection.
 */
export function createApp() {
  const app = express()

  // Security headers.
  app.use(helmet())

  // Only the frontend origins we actually use may call this API.
  app.use(
    cors({
      origin(origin, callback) {
        // Requests with no Origin header (Postman, curl, server-to-server)
        // are allowed; browsers always send one.
        if (!origin || env.clientOrigins.includes(origin)) {
          return callback(null, true)
        }
        return callback(new Error(`Origin ${origin} is not allowed by CORS.`))
      },
      credentials: true,
    }),
  )

  // Body parsing, with a cap so a huge payload cannot exhaust memory.
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  // Behind a proxy (deployment), trust it for correct client IPs.
  app.set('trust proxy', 1)

  /**
   * Root route.
   *
   * Nothing in the app calls this — it exists because opening
   * http://localhost:5000 in a browser is the first thing anyone does to
   * check whether the server is up, and a bare 404 there reads as "the
   * backend is broken". This answers with what the API is and where to
   * look instead.
   */
  app.get('/', (_req, res) => {
    res.status(200).json({
      success: true,
      name: 'StaySphere API',
      status: 'running',
      environment: env.nodeEnv,
      health: '/health',
      endpoints: {
        auth: ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me'],
        properties: [
          'GET /api/properties',
          'GET /api/properties/nearby',
          'GET /api/properties/my-properties',
          'GET /api/properties/:id',
          'POST /api/properties',
          'PUT /api/properties/:id',
          'DELETE /api/properties/:id',
        ],
      },
      note: 'Bookings, payments and admin endpoints are not implemented yet.',
    })
  })

  /**
   * Health check — used to confirm the server is up and whether the
   * database connection is live. Intentionally outside /api so it stays
   * usable even if API routing changes.
   */
  app.get('/health', (_req, res) => {
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting']

    res.status(200).json({
      success: true,
      status: 'ok',
      environment: env.nodeEnv,
      database: dbStates[mongoose.connection.readyState] ?? 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    })
  })

  // All business endpoints live under /api.
  app.use('/api', apiLimiter, apiRoutes)

  // Unmatched routes, then the single error responder.
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
