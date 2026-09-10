import {
  OCCUPANCY_TYPES,
  Property,
  PUBLIC_AVAILABILITY_STATUSES,
  PUBLIC_VERIFICATION_STATUSES,
} from '../models/Property.js'
import { badRequest, forbidden, notFound } from '../utils/AppError.js'

const DEFAULT_LIMIT = 9
const MAX_LIMIT = 50

/** Accepts "PG,Flat" or ["PG","Flat"] and returns a clean array. */
function toArray(value) {
  if (value === undefined || value === null || value === '') return []
  const list = Array.isArray(value) ? value : String(value).split(',')
  return list.map((item) => String(item).trim()).filter(Boolean)
}

/**
 * Turns query parameters into a MongoDB filter.
 *
 * `viewer` decides what is even visible:
 *   - nobody / a tenant  -> only verified, non-inactive listings
 *   - a landlord         -> the above, plus every listing they own
 *   - an admin           -> everything
 *
 * That is what makes a suspended listing disappear from public results
 * without deleting it.
 */
function buildFilter(query, viewer) {
  const filter = {}
  const and = []

  // ── Visibility ─────────────────────────────────────────────────────
  const publicOnly = {
    verificationStatus: { $in: PUBLIC_VERIFICATION_STATUSES },
    availabilityStatus: { $in: PUBLIC_AVAILABILITY_STATUSES },
  }

  if (viewer?.role === 'admin') {
    // No visibility restriction: admins moderate what others cannot see.
  } else if (viewer?.role === 'landlord') {
    and.push({ $or: [publicOnly, { landlord: viewer._id }] })
  } else {
    Object.assign(filter, publicOnly)
  }

  // ── Text search ────────────────────────────────────────────────────
  // Regex rather than $text so partial words ("kora") still match, which
  // is what a search-as-you-type box needs.
  const searchTerm = query.q?.trim()
  if (searchTerm) {
    const pattern = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    and.push({
      $or: [
        { title: pattern },
        { 'location.city': pattern },
        { 'location.address': pattern },
        { type: pattern },
      ],
    })
  }

  // ── Plain field filters ────────────────────────────────────────────
  if (query.city) filter['location.city'] = new RegExp(`^${String(query.city).trim()}$`, 'i')

  const types = toArray(query.type ?? query.types)
  if (types.length) filter.type = { $in: types }

  const genders = toArray(query.gender ?? query.genders)
  if (genders.length) {
    // A listing open to anyone should match a gender-specific search too.
    and.push({ $or: [{ gender: { $in: genders } }, { gender: 'Any' }] })
  }

  const occupancy = toArray(query.occupancy)
  if (occupancy.length) filter.occupancy = { $in: occupancy }

  if (query.furnishing) filter.furnishing = query.furnishing

  // Every requested amenity must be present, not just one.
  const amenities = toArray(query.amenities)
  if (amenities.length) filter.amenities = { $all: amenities }

  if (query.status) filter.availabilityStatus = query.status
  if (query.verified === 'true') filter.verificationStatus = 'verified'

  // ── Rent range ─────────────────────────────────────────────────────
  // A property matches when any of its occupancy prices falls in range,
  // which is exactly what [rentMin, rentMax] overlapping the window means.
  const minRent = query.minRent === undefined ? undefined : Number(query.minRent)
  const maxRent = query.maxRent === undefined ? undefined : Number(query.maxRent)

  if (minRent !== undefined && Number.isNaN(minRent)) throw badRequest('minRent must be a number.')
  if (maxRent !== undefined && Number.isNaN(maxRent)) throw badRequest('maxRent must be a number.')

  if (maxRent !== undefined) and.push({ rentMin: { $lte: maxRent } })
  if (minRent !== undefined) and.push({ rentMax: { $gte: minRent } })

  if (and.length) filter.$and = and

  return filter
}

const SORT_OPTIONS = {
  'price-asc': { rentMin: 1 },
  'price-desc': { rentMin: -1 },
  rating: { rating: -1 },
  newest: { createdAt: -1 },
  rooms: { availableRooms: -1 },
  // Featured first, then newest — the default "relevance" ordering.
  default: { featured: -1, createdAt: -1 },
}

function buildPagination(query) {
  const page = Math.max(1, Number(query.page) || 1)
  const requested = Number(query.limit) || DEFAULT_LIMIT
  const limit = Math.min(Math.max(1, requested), MAX_LIMIT)

  return { page, limit, skip: (page - 1) * limit }
}

/**
 * Search, filter, sort and paginate properties.
 * Returns the page of results plus the totals the UI needs to render
 * "N properties found" and its pager.
 */
export async function searchProperties(query, viewer) {
  const filter = buildFilter(query, viewer)
  const { page, limit, skip } = buildPagination(query)
  const sort = SORT_OPTIONS[query.sort] ?? SORT_OPTIONS.default

  const [documents, total] = await Promise.all([
    Property.find(filter)
      .populate('landlord', 'name phone profileImage')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Property.countDocuments(filter),
  ])

  return {
    properties: documents.map((property) => property.toPublicJSON()),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + documents.length < total,
    },
  }
}

/**
 * Properties within `radiusKm` of a coordinate, nearest first.
 *
 * $geoNear needs to be the first stage of an aggregation, so this cannot
 * reuse searchProperties. It returns the distance alongside each result.
 */
export async function findNearbyProperties({ lat, lng, radiusKm = 5, limit = 12 }, viewer) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  const radius = Number(radiusKm)

  if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
    throw badRequest('lat must be a number between -90 and 90.')
  }
  if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
    throw badRequest('lng must be a number between -180 and 180.')
  }
  if (Number.isNaN(radius) || radius <= 0 || radius > 100) {
    throw badRequest('radiusKm must be a number between 0 and 100.')
  }

  const visibility =
    viewer?.role === 'admin'
      ? {}
      : {
          verificationStatus: { $in: PUBLIC_VERIFICATION_STATUSES },
          availabilityStatus: { $in: PUBLIC_AVAILABILITY_STATUSES },
        }

  const results = await Property.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distanceMeters',
        maxDistance: radius * 1000,
        spherical: true,
        query: visibility,
      },
    },
    { $limit: Math.min(Math.max(1, Number(limit) || 12), MAX_LIMIT) },
    {
      $lookup: {
        from: 'users',
        localField: 'landlord',
        foreignField: '_id',
        as: 'landlordDoc',
      },
    },
    { $unwind: { path: '$landlordDoc', preserveNullAndEmptyArrays: true } },
  ])

  // Rehydrate as documents so the single serializer stays in charge of
  // the response shape, then attach the distance the aggregation found.
  return results.map((raw) => {
    const document = Property.hydrate({ ...raw, landlord: raw.landlordDoc ?? raw.landlord })
    const json = document.toPublicJSON()

    return {
      ...json,
      landlord: raw.landlordDoc
        ? {
            id: raw.landlordDoc._id,
            name: raw.landlordDoc.name,
            phone: raw.landlordDoc.phone,
            avatar: raw.landlordDoc.profileImage ?? null,
          }
        : { id: raw.landlord },
      distanceKm: Math.round((raw.distanceMeters / 1000) * 100) / 100,
    }
  })
}

/** One property by id, respecting the same visibility rules as search. */
export async function getPropertyById(id, viewer) {
  const property = await Property.findById(id).populate('landlord', 'name phone profileImage')

  if (!property) {
    throw notFound('Property not found.')
  }

  const isOwner = viewer && String(property.landlord?._id ?? property.landlord) === String(viewer._id)
  const isAdmin = viewer?.role === 'admin'
  const isPubliclyVisible =
    PUBLIC_VERIFICATION_STATUSES.includes(property.verificationStatus) &&
    PUBLIC_AVAILABILITY_STATUSES.includes(property.availabilityStatus)

  if (!isPubliclyVisible && !isOwner && !isAdmin) {
    // Same answer as a missing id, so a hidden listing cannot be probed.
    throw notFound('Property not found.')
  }

  return property.toPublicJSON()
}

/** Fields a landlord is allowed to set. Anything else is ignored. */
const LANDLORD_EDITABLE = [
  'title', 'description', 'type', 'gender', 'occupancy', 'rent', 'deposit',
  'totalRooms', 'availableRooms', 'furnishing', 'area', 'amenities',
  'landmarks', 'images',
]

function pickEditable(body) {
  const patch = {}
  for (const field of LANDLORD_EDITABLE) {
    if (body[field] !== undefined) patch[field] = body[field]
  }
  return patch
}

/** Converts the API's lat/lng input into the stored GeoJSON point. */
function buildLocation(input) {
  return {
    address: input.address,
    city: input.city,
    state: input.state,
    pincode: input.pincode,
    geo: { type: 'Point', coordinates: [Number(input.lng), Number(input.lat)] },
  }
}

/**
 * Creates a listing owned by the authenticated landlord.
 *
 * The landlord is taken from the token, and verification/featured state
 * is left at its default — a landlord cannot verify or promote their own
 * listing, only an admin can.
 */
export async function createProperty(body, landlordUser) {
  const property = new Property({
    ...pickEditable(body),
    location: buildLocation(body.location),
    landlord: landlordUser._id,
  })

  await property.save()
  await property.populate('landlord', 'name phone profileImage')

  return property.toPublicJSON()
}

async function loadOwnedProperty(id, landlordUser) {
  const property = await Property.findById(id)

  if (!property) {
    throw notFound('Property not found.')
  }

  if (String(property.landlord) !== String(landlordUser._id)) {
    throw forbidden('This property belongs to another landlord.')
  }

  return property
}

export async function updateProperty(id, body, landlordUser) {
  const property = await loadOwnedProperty(id, landlordUser)

  Object.assign(property, pickEditable(body))

  if (body.location) {
    property.location = buildLocation(body.location)
  }

  // Editing a listing sends it back for re-approval, so a verified page
  // cannot be quietly swapped for different content after the fact.
  if (property.verificationStatus === 'verified') {
    property.verificationStatus = 'pending'
  }

  await property.save()
  await property.populate('landlord', 'name phone profileImage')

  return property.toPublicJSON()
}

export async function deleteProperty(id, landlordUser) {
  const property = await loadOwnedProperty(id, landlordUser)
  await property.deleteOne()

  return { id }
}

/** Every listing owned by the caller, whatever its state. */
export async function getMyProperties(query, landlordUser) {
  const { page, limit, skip } = buildPagination(query)

  const filter = { landlord: landlordUser._id }
  if (query.status) filter.availabilityStatus = query.status

  const [documents, total] = await Promise.all([
    Property.find(filter)
      .populate('landlord', 'name phone profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Property.countDocuments(filter),
  ])

  return {
    properties: documents.map((property) => property.toPublicJSON()),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + documents.length < total,
    },
  }
}

export { OCCUPANCY_TYPES }
