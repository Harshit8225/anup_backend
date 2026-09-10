/**
 * Registers every Mongoose model in one import.
 *
 * server.js imports this at startup so all schemas — and therefore all
 * indexes, including the 2dsphere index used by the nearby search — are
 * created even before the routes that use them exist.
 */
export { User, USER_ROLES, USER_STATUSES } from './User.js'
export {
  Property,
  PROPERTY_TYPES,
  OCCUPANCY_TYPES,
  GENDER_PREFS,
  FURNISHING_TYPES,
  AMENITIES_LIST,
  VERIFICATION_STATUSES,
  AVAILABILITY_STATUSES,
  PUBLIC_VERIFICATION_STATUSES,
  PUBLIC_AVAILABILITY_STATUSES,
} from './Property.js'
export {
  Booking,
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  ACTIVE_BOOKING_STATUSES,
  PAYMENT_STATUSES,
} from './Booking.js'
export { Payment, PAYMENT_RESULTS, PAYMENT_PROVIDERS } from './Payment.js'
