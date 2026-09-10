import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

export const USER_ROLES = ['tenant', 'landlord', 'admin']
export const USER_STATUSES = ['active', 'suspended']

const SALT_ROUNDS = 10

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters.'],
      maxlength: [80, 'Name cannot exceed 80 characters.'],
    },

    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address.'],
    },

    phone: {
      type: String,
      required: [true, 'Phone number is required.'],
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian mobile number.'],
    },

    // Stored hashed, never in plain text, and never returned by default.
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      enum: { values: USER_ROLES, message: '{VALUE} is not a valid role.' },
      default: 'tenant',
      required: true,
    },

    profileImage: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: USER_STATUSES,
      default: 'active',
    },

    // Properties this tenant has saved. Used by the favourites APIs.
    favorites: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
      },
    ],
  },
  { timestamps: true },
)

/**
 * Accepts a plain password, stores only its hash.
 * Keeping the hashing here means no controller can accidentally save a
 * plain-text password.
 */
userSchema.methods.setPassword = async function setPassword(plainPassword) {
  this.passwordHash = await bcrypt.hash(plainPassword, SALT_ROUNDS)
}

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash)
}

/** The safe shape to send to clients — no hash, no internal fields. */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    profileImage: this.profileImage,
    status: this.status,
    createdAt: this.createdAt,
  }
}

// Email already has a unique index from the field definition above.
userSchema.index({ role: 1, status: 1 })

export const User = mongoose.model('User', userSchema)
