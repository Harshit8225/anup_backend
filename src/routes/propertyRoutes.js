import { Router } from 'express'
import {
  addProperty,
  editProperty,
  getProperty,
  listMyProperties,
  listNearbyProperties,
  listProperties,
  removeProperty,
} from '../controllers/propertyController.js'
import {
  createPropertyRules,
  nearbyPropertyRules,
  objectIdParam,
  searchPropertyRules,
  updatePropertyRules,
} from '../validators/propertyValidators.js'
import { handleValidation } from '../middleware/validationMiddleware.js'
import { optionalAuth, protect } from '../middleware/authMiddleware.js'
import { authorize } from '../middleware/roleMiddleware.js'

const router = Router()

/**
 * Order matters: the literal paths must be registered before "/:id",
 * otherwise Express would read "nearby" and "my-properties" as ids.
 */

// ── Public (results widen if the caller happens to be a landlord/admin) ──
router.get('/', optionalAuth, searchPropertyRules, handleValidation, listProperties)
router.get('/nearby', optionalAuth, nearbyPropertyRules, handleValidation, listNearbyProperties)

// ── Landlord's own listings ─────────────────────────────────────────────
router.get('/my-properties', protect, authorize('landlord'), listMyProperties)

// ── Public detail ───────────────────────────────────────────────────────
router.get('/:id', optionalAuth, objectIdParam, handleValidation, getProperty)

// ── Landlord write operations (ownership enforced in the service) ───────
router.post('/', protect, authorize('landlord'), createPropertyRules, handleValidation, addProperty)
router.put('/:id', protect, authorize('landlord'), updatePropertyRules, handleValidation, editProperty)
router.delete('/:id', protect, authorize('landlord'), objectIdParam, handleValidation, removeProperty)

export default router
