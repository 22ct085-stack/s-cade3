import mongoose, { Schema } from 'mongoose';

export const businessCategories = ['restaurant', 'cafe', 'bakery', 'hotel', 'homestay', 'handicrafts', 'local_store', 'tourism_service'] as const;
export type BusinessCategory = typeof businessCategories[number];

const LocalBusinessSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, enum: businessCategories, required: true, index: true },
  address: { type: String, required: true, trim: true, maxlength: 300 },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: { type: [Number], required: true }, // GeoJSON order: longitude, latitude
  },
  phone: { type: String, trim: true, maxlength: 40 },
  website: { type: String, trim: true, maxlength: 300 },
  openingHours: [{ type: String, trim: true, maxlength: 120 }],
  openNow: Boolean, businessStatus: { type: String, trim: true, maxlength: 40 },
  rating: { type: Number, min: 0, max: 5 },
  userRatingCount: { type: Number, min: 0 },
  productsAndServices: [{ type: String, trim: true, maxlength: 80 }],
  sustainabilityClaim: { type: String, trim: true, maxlength: 500 },
  sustainabilityEvidence: { type: String, trim: true, maxlength: 500 },
  sustainabilityScore: { type: Number, min: 0, max: 100 },
  sustainabilityVerified: { type: Boolean, default: false },
  googlePlaceId: { type: String, trim: true, sparse: true, index: true },
  submittedBy: { type: String, trim: true, maxlength: 120 },
  verificationStatus: { type: String, enum: ['pending', 'verified'], default: 'pending', index: true },
  source: { type: String, enum: ['manual', 'community'], default: 'community' },
}, { timestamps: true });

LocalBusinessSchema.index({ location: '2dsphere' });

export default mongoose.models.LocalBusiness || mongoose.model('LocalBusiness', LocalBusinessSchema);
