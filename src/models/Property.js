import mongoose from 'mongoose'

export const PROPERTY_TYPES = ['single-room', 'shared-room', 'pg', 'hostel', 'flat']
export const ROOM_TYPES = ['private', 'shared', 'entire-place']
export const FURNISHING_TYPES = ['unfurnished', 'semi-furnished', 'fully-furnished']
export const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected']
export const AVAILABILITY_STATUSES = ['available', 'booked', 'occupied', 'suspended']

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, required: true, trim: true, maxlength: 160 },
    locality: { type: String, required: true, trim: true, maxlength: 80 },
    city: { type: String, required: true, trim: true, maxlength: 60 },
    state: { type: String, required: true, trim: true, maxlength: 60 },
    pincode: {
      type: String,
      required: true,
      match: [/^\d{6}$/, 'Pincode must be 6 digits.'],
    },
  },
  { _id: false },
)

/**
 * GeoJSON Point. Stored as [longitude, latitude] — that order is what
 * MongoDB expects, and mixing it up is the classic geospatial bug.
 * The 2dsphere index below is what makes the "nearby" search possible.
 */
const locationSchema = new mongoose.Schema(
  {
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
  { _id: false },
)

const propertySchema = new mongoose.Schema(
  {
    // Set from the authenticated user, never from the request body.
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

    propertyType: {
      type: String,
      enum: { values: PROPERTY_TYPES, message: '{VALUE} is not a valid property type.' },
      required: true,
    },

    roomType: {
      type: String,
      enum: { values: ROOM_TYPES, message: '{VALUE} is not a valid room type.' },
      required: true,
    },

    rent: {
      type: Number,
      required: [true, 'Monthly rent is required.'],
      min: [500, 'Rent looks too low to be real.'],
      max: [1000000, 'Rent looks too high to be real.'],
    },

    securityDeposit: {
      type: Number,
      default: 0,
      min: [0, 'Security deposit cannot be negative.'],
    },

    // Carpet area in square feet.
    area: {
      type: Number,
      required: true,
      min: [50, 'Area must be at least 50 sq.ft.'],
    },

    bedrooms: { type: Number, default: 1, min: 0 },
    bathrooms: { type: Number, default: 1, min: 0 },

    // How many people the room is let to.
    occupancy: {
      type: Number,
      required: true,
      min: [1, 'Occupancy must be at least 1.'],
      max: [20, 'Occupancy looks unrealistic.'],
    },

    furnishing: {
      type: String,
      enum: { values: FURNISHING_TYPES, message: '{VALUE} is not a valid furnishing type.' },
      required: true,
    },

    amenities: {
      type: [String],
      default: [],
      validate: {
        validator: (list) => list.length <= 30,
        message: 'A property cannot list more than 30 amenities.',
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

    address: { type: addressSchema, required: true },
    location: { type: locationSchema, required: true },

    // Set by admins during moderation, not by the landlord.
    verificationStatus: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: 'pending',
    },

    // Driven by the booking workflow, not written directly by clients.
    availabilityStatus: {
      type: String,
      enum: AVAILABILITY_STATUSES,
      default: 'available',
    },
  },
  { timestamps: true },
)

// Geospatial index — required for the /properties/nearby radius search.
propertySchema.index({ location: '2dsphere' })

// The common search path: city + type + rent, filtered to live listings.
propertySchema.index({ 'address.city': 1, propertyType: 1, rent: 1 })
propertySchema.index({ availabilityStatus: 1, verificationStatus: 1 })

// Free-text search across the fields a tenant would actually type into.
propertySchema.index({ title: 'text', description: 'text', 'address.locality': 'text' })

export const Property = mongoose.model('Property', propertySchema)
