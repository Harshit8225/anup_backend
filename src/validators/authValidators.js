import { body } from 'express-validator'

/**
 * Request-shape rules for the auth endpoints.
 *
 * These only check the shape of the input. Rules that need the database
 * (is this email taken? is this password correct?) belong in the service
 * layer, not here.
 */

export const registerRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Full name is required.')
    .isLength({ min: 2, max: 80 }).withMessage('Name must be between 2 and 80 characters.'),

  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Enter a valid email address.')
    .normalizeEmail(),

  body('phone')
    .trim()
    .notEmpty().withMessage('Phone number is required.')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number.'),

  body('password')
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Za-z]/).withMessage('Password must contain at least one letter.')
    .matches(/\d/).withMessage('Password must contain at least one number.'),

  // Optional: defaults to tenant. Admin is rejected by the service.
  body('role')
    .optional()
    .isIn(['tenant', 'landlord']).withMessage('Role must be either tenant or landlord.'),
]

export const loginRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Enter a valid email address.')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required.'),
]
