import { Router } from 'express'
import {
  approve,
  cancel,
  getBooking,
  listLandlordBookings,
  listMyBookings,
  reject,
  requestBooking,
} from '../controllers/bookingController.js'
import {
  bookingIdParam,
  cancelBookingRules,
  createBookingRules,
  rejectBookingRules,
} from '../validators/bookingValidators.js'
import { handleValidation } from '../middleware/validationMiddleware.js'
import { protect } from '../middleware/authMiddleware.js'
import { authorize } from '../middleware/roleMiddleware.js'

const router = Router()

// Every booking route requires a signed-in user.
router.use(protect)

// Literal paths before "/:id", or Express reads them as ids.
router.get('/my-bookings', authorize('tenant'), listMyBookings)
router.get('/landlord', authorize('landlord'), listLandlordBookings)

router.post('/', authorize('tenant'), createBookingRules, handleValidation, requestBooking)

router.get('/:id', bookingIdParam, handleValidation, getBooking)

// Landlord decisions on their own property's requests.
router.patch('/:id/approve', authorize('landlord'), bookingIdParam, handleValidation, approve)
router.patch('/:id/reject', authorize('landlord'), rejectBookingRules, handleValidation, reject)

// A tenant cancels their own request; an admin may cancel any.
router.patch('/:id/cancel', authorize('tenant', 'admin'), cancelBookingRules, handleValidation, cancel)

export default router
