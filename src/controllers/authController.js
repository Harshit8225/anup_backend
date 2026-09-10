import { loginUser, registerUser } from '../services/authService.js'

/**
 * Controllers stay thin on purpose: read the request, call a service,
 * shape the response. All the rules live in the service layer.
 *
 * Express 5 forwards rejected promises to the error middleware on its
 * own, so these handlers need no try/catch wrapper.
 */

// POST /api/auth/register
export async function register(req, res) {
  const { name, email, phone, password, role } = req.body

  const { user, token } = await registerUser({ name, email, phone, password, role })

  res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    data: { user, token },
  })
}

// POST /api/auth/login
export async function login(req, res) {
  const { email, password } = req.body

  const { user, token } = await loginUser({ email, password })

  res.status(200).json({
    success: true,
    message: 'Logged in successfully.',
    data: { user, token },
  })
}

// GET /api/auth/me  (protected)
export async function getMe(req, res) {
  res.status(200).json({
    success: true,
    data: { user: req.user.toPublicJSON() },
  })
}
