import { User } from '../models/User.js'
import { generateToken } from '../utils/generateToken.js'
import { conflict, forbidden, unauthorized } from '../utils/AppError.js'

// Public sign-up may only create these roles. Admin accounts come from
// the seed script (npm run seed:admin), never from a public form.
const PUBLIC_ROLES = ['tenant', 'landlord']

/**
 * Creates an account and returns it with a fresh token.
 * Throws 409 if the email is taken, 403 if someone tries to self-register
 * as an admin.
 */
export async function registerUser({ name, email, phone, password, role }) {
  const requestedRole = role ?? 'tenant'

  if (!PUBLIC_ROLES.includes(requestedRole)) {
    throw forbidden('You cannot register with that role.')
  }

  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing) {
    throw conflict('An account with this email already exists.')
  }

  const user = new User({ name, email, phone, role: requestedRole })
  await user.setPassword(password)
  await user.save()

  return { user: user.toPublicJSON(), token: generateToken(user) }
}

/**
 * Verifies credentials and returns the user with a fresh token.
 *
 * The same message is returned whether the email is unknown or the
 * password is wrong, so the endpoint cannot be used to discover which
 * emails are registered.
 */
export async function loginUser({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash')

  if (!user) {
    throw unauthorized('Invalid email or password.')
  }

  const passwordMatches = await user.comparePassword(password)
  if (!passwordMatches) {
    throw unauthorized('Invalid email or password.')
  }

  if (user.status === 'suspended') {
    throw forbidden('This account has been suspended. Please contact support.')
  }

  return { user: user.toPublicJSON(), token: generateToken(user) }
}
