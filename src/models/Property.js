import mongoose from 'mongoose'

/**
 * Property
 *
 * Two vocabularies meet in this file, on purpose:
 *
 *   Storage  follows the project specification — GeoJSON coordinates with
 *            a 2dsphere index, plus separate verificationStatus and
 *            availabilityStatus enums.
 *   Output   follows what the React app already consumes (location.lat /
 *            location.lng, a `status` field, a `verified` boolean, a
 *            landlord object), so the existing UI keeps working without a
 *            rewrite.
 *
 * toPublicJSON() below is the single place that translation happens.
 */

export const PROPERTY_TYPES = ['PG', 'Flat', 'Hostel', 'Room', 'Studio']
export const OCCUPANCY_TYPES = ['Single', 'Double', 'Triple', 'Shared']
export const GENDER_PREFS = ['Any', 'Male', 'Female']
export const FURNISHING_TYPES = ['Unfurnished', 'Semi-furnished', 'Fully-furnished']

export const AMENITIES_LIST = [
  'WiFi', 'AC', 'Laundry', 'Parking', 'CCTV', 'Gym',
  'Mess/Food', 'Power Backup', 'Water 24/7', 'Lift',
  'Housekeeping', 'TV', 'Geyser', 'Security Guard',
]

export const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected', 'suspended']
export const AVAILABILITY_STATUSES = ['available', 'booked', 'occupied', 'inactive']

/** Statuses a property must have to appear in public search results. */
export const PUBLIC_VERIFICATION_STATUSES = ['verified']
export const PUBLIC_AVAILABILITY_STATUSES = ['available', 'booked', 'occupied']

/**
 * Rent is priced per occupancy — a single room and a double room in the
 * same PG cost different amounts, and the booking form already lets a
 * tenant choose. At least one tier must be set.
 */
const rentSchema = new mongoose.Schema(
  {
    single: { type: Number, min: 0 },
    double: { type: Number, min: 0 },
    triple: { type: Number, min: 0 },
    shared: { type: Number, min: 0 },
  },
  { _id: false },
)

const locationSchema = new mongoose.Schema(
  {
    address: { type: String, required: true, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 60 },
    state: { type: String, required: true, trim: true, maxlength: 60 },
    pincode: { type: String, required: true, match: [/^\d{6}$/, 'Pincode must be 6 digits.'] },

    /**
     * GeoJSON point. Coordinates are [longitude, latitude] — that order
     * is what MongoDB expects, and reversing it is the classic
     * geospatial bug. The API exposes lat/lng separately to avoid it.
     */
    geo: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (value) =>
            Array.isArray(value) &&
            value.length === 2 &&
            value[0] >= -180 && value[0] <= 180 &&
            value[1] >= -90 && value[1] <= 90,
          message: 'Coordinates must be [longitude, latitude] within valid ranges.',
        },
      },
    },
  },
  { _id: false },
)

const propertySchema = new mongoose.Schema(
  {
    // Always taken from the authenticated landlord, never the request body.
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: [true, 'Title is required.'],
      trim: true,
      minlength: [10, 'Title must be at least 10 characters.'],
      maxlength: [120, 'Title cannot exceed 120 characters.'],
    },

    description: {
      type: String,
      required: [true, 'Description is required.'],
      trim: true,
      minlength: [30, 'Description must be at least 30 characters.'],
      maxlength: [3000, 'Description cannot exceed 3000 characters.'],
    },

    type: {
      type: String,
      enum: { values: PROPERTY_TYPES, message: '{VALUE} is not a valid property type.' },
      required: true,
    },

    gender: {
      type: String,
      enum: { values: GENDER_PREFS, message: '{VALUE} is not a valid gender preference.' },
      default: 'Any',
    },

    occupancy: {
      type: [{ type: String, enum: OCCUPANCY_TYPES }],
      required: true,
      validate: {
        validator: (list) => list.length > 0,
        message: 'Select at least one occupancy type.',
      },
    },

    rent: {
      type: rentSchema,
      required: true,
      validate: {
        validator(value) {
          return OCCUPANCY_TYPES.some((key) => typeof value?.[key.toLowerCase()] === 'number')
        },
        message: 'Set rent for at least one occupancy type.',
      },
    },

    /**
     * Derived from `rent` by the hook below. Storing the range as plain
     * numbers is what makes rent filtering and sorting a simple indexed
     * query instead of an aggregation over a subdocument.
     */
    rentMin: { type: Number, index: true },
    rentMax: { type: Number },

    deposit: { type: Number, default: 0, min: [0, 'Deposit cannot be negative.'] },

    totalRooms: { type: Number, required: true, min: [1, 'A property has at least one room.'] },
    availableRooms: { type: Number, required: true, min: [0, 'Available rooms cannot be negative.'] },

    furnishing: {
      type: String,
      enum: FURNISHING_TYPES,
      default: 'Semi-furnished',
    },

    area: { type: Number, min: [0, 'Area cannot be negative.'], default: null },

    amenities: {
      type: [{ type: String, enum: AMENITIES_LIST }],
      default: [],
    },

    // "200m from Forum Mall" — landlord-written proximity hints, shown on
    // the detail page. Distinct from the geospatial search below.
    landmarks: {
      type: [String],
      default: [],
      validate: {
        validator: (list) => list.length <= 10,
        message: 'A property cannot list more than 10 landmarks.',
      },
    },

    images: {
      type: [String],
      default: [],
      validate: {
        validator: (list) => list.length <= 12,
        message: 'A property cannot have more than 12 images.',
      },
    },

    location: { type: locationSchema, required: true },

    // Admin-controlled. A landlord cannot verify or feature their own listing.
    verificationStatus: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: 'pending',
    },

    featured: { type: Boolean, default: false },

    // Driven by the booking workflow, not written directly by clients.
    availabilityStatus: {
      type: String,
      enum: AVAILABILITY_STATUSES,
      default: 'available',
    },

    /**
     * Seeded from demo fixtures for now. There is no review system yet,
     * so nothing in the API computes these — they are not real
     * aggregates and must not be presented as such.
     */
    rating: { type: Number, min: 0, max: 5, default: 0 },
    reviews: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
)

/** Keeps the indexed rent range in step with the per-occupancy prices. */
propertySchema.pre('save', function syncRentRange(next) {
  if (this.rent) {
    const prices = OCCUPANCY_TYPES
      .map((key) => this.rent[key.toLowerCase()])
      .filter((price) => typeof price === 'number')

    if (prices.length > 0) {
      this.rentMin = Math.min(...prices)
      this.rentMax = Math.max(...prices)
    }
  }
  next()
})

// Geospatial index — required for the /properties/nearby radius search.
propertySchema.index({ 'location.geo': '2dsphere' })

// The common search path: city + type + rent, narrowed to live listings.
propertySchema.index({ 'location.city': 1, type: 1, rentMin: 1 })
propertySchema.index({ verificationStatus: 1, availabilityStatus: 1 })

// Free-text search over the fields a tenant would actually type.
propertySchema.index({
  title: 'text',
  description: 'text',
  'location.city': 'text',
  'location.address': 'text',
})

/**
 * The shape the API returns, and the only place storage names are
 * translated into the names the frontend uses.
 */
propertySchema.methods.toPublicJSON = function toPublicJSON() {
  const landlordIsPopulated = this.populated('landlord') || this.landlord?.name

  return {
    id: this._id,
    title: this.title,
    description: this.description,
    type: this.type,
    gender: this.gender,
    occupancy: this.occupancy,
    rent: {
      ...(typeof this.rent?.single === 'number' ? { single: this.rent.single } : {}),
      ...(typeof this.rent?.double === 'number' ? { double: this.rent.double } : {}),
      ...(typeof this.rent?.triple === 'number' ? { triple: this.rent.triple } : {}),
      ...(typeof this.rent?.shared === 'number' ? { shared: this.rent.shared } : {}),
    },
    deposit: this.deposit,
    totalRooms: this.totalRooms,
    availableRooms: this.availableRooms,
    furnishing: this.furnishing,
    area: this.area,
    amenities: this.amenities,
    landmarks: this.landmarks,
    images: this.images,

    location: {
      address: this.location.address,
      city: this.location.city,
      state: this.location.state,
      pincode: this.location.pincode,
      // Back to human order for the client.
      lng: this.location.geo.coordinates[0],
      lat: this.location.geo.coordinates[1],
    },

    // `status` and `verified` are the names the existing UI reads.
    status: this.availabilityStatus,
    verified: this.verificationStatus === 'verified',
    verificationStatus: this.verificationStatus,
    featured: this.featured,

    rating: this.rating,
    reviews: this.reviews,

    landlord: landlordIsPopulated
      ? {
          id: this.landlord._id,
          name: this.landlord.name,
          phone: this.landlord.phone,
          avatar: this.landlord.profileImage ?? null,
        }
      : { id: this.landlord },

    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  }
}

export const Property = mongoose.model('Property', propertySchema)
