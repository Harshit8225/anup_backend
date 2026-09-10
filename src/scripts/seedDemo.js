import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { User } from '../models/User.js'

/**
 * Creates the three demo accounts the frontend's login screen advertises,
 * one per role, so the app can be demonstrated end to end against a real
 * database.
 *
 * Safe to re-run: existing accounts are updated rather than duplicated.
 *
 * Run with:  npm run seed:demo
 */
const DEMO_PASSWORD = 'Password123'

const DEMO_ACCOUNTS = [
  { name: 'Arjun Sharma', email: 'user@test.com', phone: '9876543210', role: 'tenant' },
  { name: 'Ramesh Patel', email: 'landlord@test.com', phone: '9812345678', role: 'landlord' },
  { name: 'Platform Admin', email: 'admin@test.com', phone: '9000000000', role: 'admin' },
]

async function seedDemo() {
  await connectDatabase()

  for (const account of DEMO_ACCOUNTS) {
    const existing = await User.findOne({ email: account.email })
    const user = existing ?? new User({ email: account.email })

    user.name = account.name
    user.phone = account.phone
    user.role = account.role
    user.status = 'active'
    await user.setPassword(DEMO_PASSWORD)
    await user.save()

    console.log(`${existing ? 'Updated' : 'Created'}: ${account.email} (${account.role})`)
  }

  console.log(`\nAll demo accounts use the password: ${DEMO_PASSWORD}`)
  console.log('These are development fixtures — do not seed them in production.')

  await disconnectDatabase()
}

seedDemo().catch(async (error) => {
  console.error('Demo seeding failed:', error.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
