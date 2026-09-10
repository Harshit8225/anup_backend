/**
 * Phase 3 + 4 tests: authentication and role authorization.
 *
 * Uses Node's built-in test runner (no extra dependencies) against a
 * separate `staysphere_test` database, which is dropped afterwards.
 *
 * Run with:  npm test      (requires a local MongoDB on 27017)
 */
import test, { after, before, describe } from 'node:test'
import assert from 'node:assert/strict'

// Point the app at a throwaway database BEFORE anything reads the config.
// dotenv does not override variables that are already set, so these win.
process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/staysphere_test'
process.env.JWT_SECRET = 'test-secret-do-not-use-anywhere-else'

const mongoose = (await import('mongoose')).default
const express = (await import('express')).default
const { createApp } = await import('../src/app.js')
const { connectDatabase } = await import('../src/config/db.js')
const { User } = await import('../src/models/User.js')
const { protect } = await import('../src/middleware/authMiddleware.js')
const { authorize } = await import('../src/middleware/roleMiddleware.js')
const { errorHandler } = await import('../src/middleware/errorMiddleware.js')

let baseUrl
let server

/** POST/GET helper that always returns { status, body }. */
async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  return { status: response.status, body: await response.json() }
}

const TENANT = {
  name: 'Arjun Sharma',
  email: 'tenant@test.com',
  phone: '9876543210',
  password: 'Password123',
  role: 'tenant',
}

const LANDLORD = {
  name: 'Ramesh Patel',
  email: 'landlord@test.com',
  phone: '9812345678',
  password: 'Password123',
  role: 'landlord',
}

before(async () => {
  await connectDatabase()
  await mongoose.connection.dropDatabase()

  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await mongoose.connection.dropDatabase()
  await new Promise((resolve) => server.close(resolve))
  await mongoose.disconnect()
})

describe('Phase 1 — foundation', () => {
  test('health endpoint reports a live database', async () => {
    const { status, body } = await call('/health')

    assert.equal(status, 200)
    assert.equal(body.status, 'ok')
    assert.equal(body.database, 'connected')
  })

  test('unknown routes return JSON, not HTML', async () => {
    const { status, body } = await call('/api/does-not-exist')

    assert.equal(status, 404)
    assert.equal(body.success, false)
    assert.match(body.message, /Route not found/)
  })
})

describe('Phase 3 — registration', () => {
  test('registers a tenant and returns a token', async () => {
    const { status, body } = await call('/api/auth/register', { method: 'POST', body: TENANT })

    assert.equal(status, 201)
    assert.equal(body.success, true)
    assert.equal(body.data.user.role, 'tenant')
    assert.equal(body.data.user.email, TENANT.email)
    assert.ok(body.data.token, 'expected a JWT')
    // The password must never come back in any form.
    assert.equal(body.data.user.password, undefined)
    assert.equal(body.data.user.passwordHash, undefined)
  })

  test('stores the password as a bcrypt hash, not plain text', async () => {
    const stored = await User.findOne({ email: TENANT.email }).select('+passwordHash')

    assert.ok(stored.passwordHash)
    assert.notEqual(stored.passwordHash, TENANT.password)
    assert.match(stored.passwordHash, /^\$2[aby]\$/)
  })

  test('rejects a duplicate email', async () => {
    const { status, body } = await call('/api/auth/register', { method: 'POST', body: TENANT })

    assert.equal(status, 409)
    assert.match(body.message, /already exists/i)
  })

  test('rejects a weak password with a per-field error', async () => {
    const { status, body } = await call('/api/auth/register', {
      method: 'POST',
      body: { ...TENANT, email: 'weak@test.com', password: 'short' },
    })

    assert.equal(status, 400)
    assert.ok(body.errors.password, 'expected a password field error')
  })

  test('rejects an invalid phone number', async () => {
    const { status, body } = await call('/api/auth/register', {
      method: 'POST',
      body: { ...TENANT, email: 'badphone@test.com', phone: '12345' },
    })

    assert.equal(status, 400)
    assert.ok(body.errors.phone)
  })

  test('refuses to create an admin through the public form', async () => {
    const { status } = await call('/api/auth/register', {
      method: 'POST',
      body: { ...TENANT, email: 'sneaky@test.com', role: 'admin' },
    })

    // Blocked by the validator (400) before it can even reach the service.
    assert.equal(status, 400)

    const created = await User.findOne({ email: 'sneaky@test.com' })
    assert.equal(created, null, 'no admin account should have been created')
  })

  test('registers a landlord', async () => {
    const { status, body } = await call('/api/auth/register', { method: 'POST', body: LANDLORD })

    assert.equal(status, 201)
    assert.equal(body.data.user.role, 'landlord')
  })
})

describe('Phase 3 — login and /me', () => {
  test('logs in with correct credentials', async () => {
    const { status, body } = await call('/api/auth/login', {
      method: 'POST',
      body: { email: TENANT.email, password: TENANT.password },
    })

    assert.equal(status, 200)
    assert.ok(body.data.token)
    assert.equal(body.data.user.email, TENANT.email)
  })

  test('rejects a wrong password without revealing which field was wrong', async () => {
    const { status, body } = await call('/api/auth/login', {
      method: 'POST',
      body: { email: TENANT.email, password: 'WrongPassword1' },
    })

    assert.equal(status, 401)
    assert.equal(body.message, 'Invalid email or password.')
  })

  test('gives an unknown email the same message as a wrong password', async () => {
    const { status, body } = await call('/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody@test.com', password: 'Password123' },
    })

    assert.equal(status, 401)
    assert.equal(body.message, 'Invalid email or password.')
  })

  test('/me returns the caller with a valid token', async () => {
    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { email: TENANT.email, password: TENANT.password },
    })

    const { status, body } = await call('/api/auth/me', { token: login.body.data.token })

    assert.equal(status, 200)
    assert.equal(body.data.user.email, TENANT.email)
  })

  test('/me without a token is rejected', async () => {
    const { status, body } = await call('/api/auth/me')

    assert.equal(status, 401)
    assert.match(body.message, /Not authenticated/)
  })

  test('/me with a malformed token is rejected', async () => {
    const { status, body } = await call('/api/auth/me', { token: 'not-a-real-jwt' })

    assert.equal(status, 401)
    assert.match(body.message, /Invalid authentication token/)
  })

  test('a suspended account cannot use its existing token', async () => {
    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { email: LANDLORD.email, password: LANDLORD.password },
    })
    const token = login.body.data.token

    await User.updateOne({ email: LANDLORD.email }, { status: 'suspended' })
    const suspended = await call('/api/auth/me', { token })
    await User.updateOne({ email: LANDLORD.email }, { status: 'active' })

    assert.equal(suspended.status, 403)
    assert.match(suspended.body.message, /suspended/i)
  })
})

describe('Phase 4 — role authorization', () => {
  // A throwaway app that mounts the real middleware on test-only routes,
  // so roles are proven now rather than waiting for Phase 5.
  let roleServer
  let roleUrl

  before(async () => {
    const app = express()
    app.get('/landlord-only', protect, authorize('landlord'), (_req, res) =>
      res.json({ success: true, area: 'landlord' }),
    )
    app.get('/admin-only', protect, authorize('admin'), (_req, res) =>
      res.json({ success: true, area: 'admin' }),
    )
    app.get('/staff-only', protect, authorize('landlord', 'admin'), (_req, res) =>
      res.json({ success: true, area: 'staff' }),
    )
    app.use(errorHandler)

    roleServer = app.listen(0)
    await new Promise((resolve) => roleServer.once('listening', resolve))
    roleUrl = `http://127.0.0.1:${roleServer.address().port}`
  })

  after(async () => {
    await new Promise((resolve) => roleServer.close(resolve))
  })

  async function tokenFor(account) {
    const { body } = await call('/api/auth/login', {
      method: 'POST',
      body: { email: account.email, password: account.password },
    })
    return body.data.token
  }

  async function hit(path, token) {
    const response = await fetch(`${roleUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    return { status: response.status, body: await response.json() }
  }

  test('a tenant is blocked from landlord routes', async () => {
    const { status, body } = await hit('/landlord-only', await tokenFor(TENANT))

    assert.equal(status, 403)
    assert.match(body.message, /restricted to: landlord/)
  })

  test('a tenant is blocked from admin routes', async () => {
    const { status } = await hit('/admin-only', await tokenFor(TENANT))
    assert.equal(status, 403)
  })

  test('a landlord reaches landlord routes', async () => {
    const { status, body } = await hit('/landlord-only', await tokenFor(LANDLORD))

    assert.equal(status, 200)
    assert.equal(body.area, 'landlord')
  })

  test('a landlord is blocked from admin routes', async () => {
    const { status } = await hit('/admin-only', await tokenFor(LANDLORD))
    assert.equal(status, 403)
  })

  test('an admin created by the seed path reaches admin routes', async () => {
    const admin = new User({
      name: 'Platform Admin',
      email: 'admin@test.com',
      phone: '9000000000',
      role: 'admin',
    })
    await admin.setPassword('Password123')
    await admin.save()

    const token = await tokenFor({ email: 'admin@test.com', password: 'Password123' })
    const { status, body } = await hit('/admin-only', token)

    assert.equal(status, 200)
    assert.equal(body.area, 'admin')
  })

  test('a route open to several roles accepts any of them', async () => {
    const landlord = await hit('/staff-only', await tokenFor(LANDLORD))
    const tenant = await hit('/staff-only', await tokenFor(TENANT))

    assert.equal(landlord.status, 200)
    assert.equal(tenant.status, 403)
  })

  test('role routes still require authentication first', async () => {
    const { status } = await hit('/landlord-only')
    assert.equal(status, 401)
  })
})
