import mongoose from 'mongoose'
import { env } from './env.js'

/**
 * Opens the single MongoDB connection the app uses.
 * Called once from server.js before the HTTP server starts listening,
 * so the API never accepts traffic it cannot serve.
 */
export async function connectDatabase() {
  mongoose.set('strictQuery', true)

  const connection = await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
  })

  console.log(`MongoDB connected: ${connection.connection.host}/${connection.connection.name}`)

  return connection
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
  console.log('MongoDB disconnected')
}
