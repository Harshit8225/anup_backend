import {
  createProperty,
  deleteProperty,
  findNearbyProperties,
  getMyProperties,
  getPropertyById,
  searchProperties,
  updateProperty,
} from '../services/propertyService.js'

/**
 * Property endpoints.
 *
 * `req.user` is present only on routes behind `protect`. On the public
 * search and detail routes it is undefined, and the service treats that
 * as an anonymous viewer — which is what limits results to verified
 * listings.
 */

// GET /api/properties
export async function listProperties(req, res) {
  const { properties, pagination } = await searchProperties(req.query, req.user)

  res.status(200).json({ success: true, data: { properties, pagination } })
}

// GET /api/properties/nearby
export async function listNearbyProperties(req, res) {
  const properties = await findNearbyProperties(req.query, req.user)

  res.status(200).json({
    success: true,
    data: { properties, count: properties.length },
  })
}

// GET /api/properties/my-properties  (landlord)
export async function listMyProperties(req, res) {
  const { properties, pagination } = await getMyProperties(req.query, req.user)

  res.status(200).json({ success: true, data: { properties, pagination } })
}

// GET /api/properties/:id
export async function getProperty(req, res) {
  const property = await getPropertyById(req.params.id, req.user)

  res.status(200).json({ success: true, data: { property } })
}

// POST /api/properties  (landlord)
export async function addProperty(req, res) {
  const property = await createProperty(req.body, req.user)

  res.status(201).json({
    success: true,
    message: 'Property created. It will appear publicly once an admin verifies it.',
    data: { property },
  })
}

// PUT /api/properties/:id  (landlord, own only)
export async function editProperty(req, res) {
  const property = await updateProperty(req.params.id, req.body, req.user)

  res.status(200).json({
    success: true,
    message: 'Property updated. Edited listings are re-checked before going public again.',
    data: { property },
  })
}

// DELETE /api/properties/:id  (landlord, own only)
export async function removeProperty(req, res) {
  const result = await deleteProperty(req.params.id, req.user)

  res.status(200).json({ success: true, message: 'Property deleted.', data: result })
}
