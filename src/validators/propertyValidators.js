import { body, param, query } from 'express-validator'
import {
  AMENITIES_LIST,
  FURNISHING_TYPES,
  GENDER_PREFS,
  OCCUPANCY_TYPES,
  PROPERTY_TYPES,
} from '../models/Property.js'

/**
 * Shape rules for the property endpoints.
 *
 * Note what is deliberately absent: landlord, verificationStatus,
 * featured and availabilityStatus. Those are never accepted from a
 * client — ownership comes from the token, moderation from an admin, and
 * availability from the booking workflow.
 */

export const objectIdParam = [
  param('id').isMongoId().withMessage('That property id is not valid.'),
]

/** Rent is an object keyed by occupancy: { single: 9500, double: 6800 }. */
const rentRules = [
  body('rent')
    .exists().withMessage('Rent is required.')
    .isObject().withMessage('Rent must be an object keyed by occupancy, e.g. { "single": 9500 }.'),

  ...OCCUPANCY_TYPES.map((tier) =>
    body(`rent.${tier.toLowerCase()}`)
      .optional()
      .isFloat({ min: 0, max: 1000000 })
      .withMessage(`${tier} rent must be a positive number.`),
  ),

  body('rent').custom((rent) => {
    const hasAny = OCCUPANCY_TYPES.some((tier) => typeof rent?.[tier.toLowerCase()] === 'number')
    if (!hasAny) {
      throw new Error('Set rent for at least one occupancy type.')
    }
    return true
  }),
]

const locationRules = [
  body('location').exists().withMessage('Location is required.').isObject(),
  body('location.address').trim().notEmpty().withMessage('Street address is required.')
    .isLength({ max: 200 }).withMessage('Address is too long.'),
  body('location.city').trim().notEmpty().withMessage('City is required.'),
  body('location.state').trim().notEmpty().withMessage('State is required.'),
  body('location.pincode').trim().matches(/^\d{6}$/).withMessage('Pincode must be 6 digits.'),
  body('location.lat').isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90.'),
  body('location.lng').isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180.'),
]

const sharedDetailRules = [
  body('type').isIn(PROPERTY_TYPES).withMessage(`Type must be one of: ${PROPERTY_TYPES.join(', ')}.`),

  body('gender').optional().isIn(GENDER_PREFS)
    .withMessage(`Gender preference must be one of: ${GENDER_PREFS.join(', ')}.`),

  body('occupancy')
    .isArray({ min: 1 }).withMessage('Select at least one occupancy type.')
    .custom((list) => {
      const invalid = list.filter((item) => !OCCUPANCY_TYPES.includes(item))
      if (invalid.length) {
        throw new Error(`Invalid occupancy: ${invalid.join(', ')}.`)
      }
      return true
    }),

  body('deposit').optional().isFloat({ min: 0 }).withMessage('Deposit cannot be negative.'),

  body('totalRooms').isInt({ min: 1 }).withMessage('Total rooms must be at least 1.'),
  body('availableRooms').isInt({ min: 0 }).withMessage('Available rooms cannot be negative.'),

  body('furnishing').optional().isIn(FURNISHING_TYPES)
    .withMessage(`Furnishing must be one of: ${FURNISHING_TYPES.join(', ')}.`),

  body('area').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Area cannot be negative.'),

  body('amenities').optional().isArray().withMessage('Amenities must be an array.')
    .custom((list) => {
      const invalid = list.filter((item) => !AMENITIES_LIST.includes(item))
      if (invalid.length) {
        throw new Error(`Unknown amenities: ${invalid.join(', ')}.`)
      }
      return true
    }),

  body('landmarks').optional().isArray({ max: 10 }).withMessage('At most 10 landmarks.'),

  body('images').optional().isArray({ max: 12 }).withMessage('At most 12 images.')
    .custom((list) => {
      const invalid = list.filter((url) => typeof url !== 'string' || !/^https?:\/\//i.test(url))
      if (invalid.length) {
        throw new Error('Every image must be an http(s) URL.')
      }
      return true
    }),

  // Cannot exceed the total; checked here so the message names the field.
  body('availableRooms').custom((available, { req }) => {
    if (req.body.totalRooms !== undefined && Number(available) > Number(req.body.totalRooms)) {
      throw new Error('Available rooms cannot exceed total rooms.')
    }
    return true
  }),
]

export const createPropertyRules = [
  body('title').trim().isLength({ min: 10, max: 120 })
    .withMessage('Title must be between 10 and 120 characters.'),
  body('description').trim().isLength({ min: 30, max: 3000 })
    .withMessage('Description must be between 30 and 3000 characters.'),
  ...sharedDetailRules,
  ...rentRules,
  ...locationRules,
]

/** Update accepts a partial body — only validate what was sent. */
export const updatePropertyRules = [
  ...objectIdParam,

  body('title').optional().trim().isLength({ min: 10, max: 120 })
    .withMessage('Title must be between 10 and 120 characters.'),
  body('description').optional().trim().isLength({ min: 30, max: 3000 })
    .withMessage('Description must be between 30 and 3000 characters.'),

  body('type').optional().isIn(PROPERTY_TYPES),
  body('gender').optional().isIn(GENDER_PREFS),
  body('occupancy').optional().isArray({ min: 1 }),
  body('deposit').optional().isFloat({ min: 0 }),
  body('totalRooms').optional().isInt({ min: 1 }),
  body('availableRooms').optional().isInt({ min: 0 }),
  body('furnishing').optional().isIn(FURNISHING_TYPES),
  body('area').optional({ nullable: true }).isFloat({ min: 0 }),
  body('amenities').optional().isArray(),
  body('landmarks').optional().isArray({ max: 10 }),
  body('images').optional().isArray({ max: 12 }),

  body('rent').optional().isObject(),
  body('location').optional().isObject(),
  body('location.lat').optional().isFloat({ min: -90, max: 90 }),
  body('location.lng').optional().isFloat({ min: -180, max: 180 }),
  body('location.pincode').optional().matches(/^\d{6}$/).withMessage('Pincode must be 6 digits.'),
]

export const searchPropertyRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be 1 or more.'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50.'),
  query('minRent').optional().isFloat({ min: 0 }).withMessage('minRent must be a positive number.'),
  query('maxRent').optional().isFloat({ min: 0 }).withMessage('maxRent must be a positive number.'),
  query('sort').optional().isIn(['default', 'price-asc', 'price-desc', 'rating', 'newest', 'rooms'])
    .withMessage('Unknown sort option.'),
]

export const nearbyPropertyRules = [
  query('lat').exists().withMessage('lat is required.')
    .isFloat({ min: -90, max: 90 }).withMessage('lat must be between -90 and 90.'),
  query('lng').exists().withMessage('lng is required.')
    .isFloat({ min: -180, max: 180 }).withMessage('lng must be between -180 and 180.'),
  query('radiusKm').optional().isFloat({ min: 0.1, max: 100 })
    .withMessage('radiusKm must be between 0.1 and 100.'),
  query('limit').optional().isInt({ min: 1, max: 50 }),
]
