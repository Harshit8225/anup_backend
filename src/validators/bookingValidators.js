import { body, param } from 'express-validator'
import { OCCUPANCY_TYPES } from '../models/Property.js'

/**
 * Shape rules for the booking endpoints.
 *
 * Note what is absent: `status`, `monthlyRent`, `landlord` and `tenant`.
 * The status comes from the action taken, the rent from the property and
 * the parties from the token — none of them are accepted from a client.
 */

export const bookingIdParam = [
  param('id').isMongoId().withMessage('That booking id is not valid.'),
]

export const createBookingRules = [
  body('propertyId')
    .exists().withMessage('A property is required.')
    .isMongoId().withMessage('That property id is not valid.'),

  body('occupancyType')
    .exists().withMessage('Choose an occupancy type.')
    .isIn(OCCUPANCY_TYPES).withMessage(`Occupancy must be one of: ${OCCUPANCY_TYPES.join(', ')}.`),

  body('moveInDate')
    .exists().withMessage('A move-in date is required.')
    .isISO8601().withMessage('Enter a valid move-in date.')
    .custom((value) => {
      const moveIn = new Date(value)
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      if (moveIn < today) {
        throw new Error('The move-in date cannot be in the past.')
      }

      const oneYearOut = new Date(today)
      oneYearOut.setFullYear(oneYearOut.getFullYear() + 1)
      if (moveIn > oneYearOut) {
        throw new Error('The move-in date cannot be more than a year away.')
      }

      return true
    }),

  body('durationMonths')
    .optional()
    .isInt({ min: 1, max: 60 }).withMessage('Duration must be between 1 and 60 months.'),

  body('userType')
    .optional({ values: 'falsy' })
    .isIn(['Student', 'Working Professional', 'Other'])
    .withMessage('Choose a valid user type.'),

  body('purpose')
    .optional({ values: 'falsy' })
    .isIn(['Study', 'Work', 'Personal'])
    .withMessage('Choose a valid purpose of stay.'),

  body('message')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Keep your message under 500 characters.'),
]

export const rejectBookingRules = [
  ...bookingIdParam,
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('Keep the reason under 300 characters.'),
]

export const cancelBookingRules = [
  ...bookingIdParam,
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('Keep the reason under 300 characters.'),
]
