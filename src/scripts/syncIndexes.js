import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import '../models/index.js'

/**
 * Brings the database indexes in line with the current schemas.
 *
 * Mongoose creates new indexes automatically but never removes ones that
 * a schema no longer declares. During development, where a schema can
 * change shape (a field moving from a plain value to a GeoJSON point,
 * say), a leftover index makes every insert fail. syncIndexes() drops
 * what is obsolete and builds what is missing.
 *
 * Run with:  npm run db:sync-indexes
 */
async function syncIndexes() {
  await connectDatabase()

  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name)
    const dropped = await model.syncIndexes()

    console.log(`${name}: indexes synced${dropped.length ? ` (dropped ${dropped.join(', ')})` : ''}`)

    for (const index of await model.collection.getIndexes({ full: true })) {
      console.log(`   ${index.name} => ${JSON.stringify(index.key)}`)
    }
  }

  await disconnectDatabase()
}

syncIndexes().catch(async (error) => {
  console.error('Index sync failed:', error.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
