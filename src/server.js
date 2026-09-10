import { createApp } from './app.js'
import { connectDatabase, disconnectDatabase } from './config/db.js'
import { env } from './config/env.js'

// Registers all schemas (and their indexes) before the server starts.
import './models/index.js'

/**
 * Entry point: connect to MongoDB first, then start listening — so the
 * API never accepts a request it cannot serve.
 */
async function start() {
  try {
    await connectDatabase()
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message)
    process.exit(1)
  }

  const app = createApp()
  const server = app.listen(env.port, () => {
    console.log(`StaySphere API listening on http://localhost:${env.port} (${env.nodeEnv})`)
    console.log(`Allowed origins: ${env.clientOrigins.join(', ')}`)
  })

  /** Finish in-flight requests, close the DB, then exit. */
  async function shutdown(signal) {
    console.log(`\n${signal} received — shutting down.`)
    server.close(async () => {
      await disconnectDatabase()
      process.exit(0)
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason)
  })
}

start()
