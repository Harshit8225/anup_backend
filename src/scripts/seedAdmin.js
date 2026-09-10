import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { User } from '../models/User.js'

/**
 * Creates (or updates) the platform admin account.
 *
 * Admins are deliberately not creatable through /api/auth/register — the
 * public form would then be a way to grant yourself admin. This script is
 * the only path, and it reads its values from .env.
 *
 * Run with:  npm run seed:admin
 */
async function seedAdmin() {
  const name = process.env.SEED_ADMIN_NAME
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase()
  const phone = process.env.SEED_ADMIN_PHONE
  const password = process.env.SEED_ADMIN_PASSWORD

  if (!name || !email || !phone || !password) {
    console.error(
      'Missing seed values. Set SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PHONE and SEED_ADMIN_PASSWORD in .env.',
    )
    process.exit(1)
  }

  if (password.length < 8) {
    console.error('SEED_ADMIN_PASSWORD must be at least 8 characters.')
    process.exit(1)
  }

  await connectDatabase()

  const existing = await User.findOne({ email })

  if (existing) {
    existing.name = name
    existing.phone = phone
    existing.role = 'admin'
    existing.status = 'active'
    await existing.setPassword(password)
    await existing.save()

    console.log(`Admin account updated: ${email}`)
  } else {
    const admin = new User({ name, email, phone, role: 'admin' })
    await admin.setPassword(password)
    await admin.save()

    console.log(`Admin account created: ${email}`)
  }

  await disconnectDatabase()
}

seedAdmin().catch(async (error) => {
  console.error('Seeding failed:', error.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
