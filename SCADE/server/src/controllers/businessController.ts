import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import LocalBusiness, { businessCategories } from '../models/LocalBusiness';
import { discoverBusinesses } from '../services/businessDiscoveryService';

const coordinates = z.object({ latitude: z.coerce.number().finite().min(-90).max(90), longitude: z.coerce.number().finite().min(-180).max(180) });
const listingFields = z.object({
  name: z.string().trim().min(2).max(120), category: z.enum(businessCategories), address: z.string().trim().min(4).max(300),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  phone: z.string().trim().max(40).optional().or(z.literal('')), website: z.string().trim().max(300).optional().or(z.literal('')).refine((value) => !value || /^https?:\/\//i.test(value), 'Website must start with http:// or https://'),
  openingHours: z.array(z.string().trim().max(120)).max(14).optional(), productsAndServices: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  sustainabilityClaim: z.string().trim().max(500).optional().or(z.literal('')), sustainabilityEvidence: z.string().trim().max(500).optional().or(z.literal('')),
  submittedBy: z.string().trim().max(120).optional().or(z.literal('')), rating: z.number().min(0).max(5).optional(), userRatingCount: z.number().int().min(0).max(10000000).optional(),
});
const ready = (res: Response) => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ success: false, error: 'Business records are temporarily unavailable because the database is not connected.' });
  return false;
};
const errorResponse = (res: Response, message = 'Check the business details and try again.') => res.status(400).json({ success: false, error: message });

export async function discover(req: Request, res: Response, next: NextFunction) {
  const parsed = coordinates.extend({ radius: z.coerce.number().min(100).max(50000).default(5000), category: z.enum(businessCategories).optional(), sustainabilityPreference: z.coerce.number().min(0).max(1).default(0.5) }).safeParse(req.query);
  if (!parsed.success) return errorResponse(res, 'Provide valid coordinates, a radius from 100 to 50,000 metres, and a supported category.');
  try {
    const result = await discoverBusinesses(parsed.data);
    return res.json({ success: true, ...result, message: result.businesses.length ? undefined : 'No nearby businesses were found. Try another category or a wider radius.' });
  } catch (error) { return next(error); }
}

export async function submitBusiness(req: Request, res: Response) {
  const parsed = listingFields.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 'Add a valid business name, category, address, and latitude/longitude.');
  if (!ready(res)) return;
  try {
    const data = parsed.data;
    const { rating: _rating, userRatingCount: _ratingCount, ...communityData } = data;
    const business = await LocalBusiness.create({ ...communityData, location: { type: 'Point', coordinates: [data.longitude, data.latitude] }, source: 'community', verificationStatus: 'pending', sustainabilityVerified: false });
    return res.status(201).json({ success: true, message: 'Thanks. Your business suggestion was received and will appear after verification.', id: business.id, verificationStatus: business.verificationStatus });
  } catch { return errorResponse(res); }
}

export async function pendingSubmissions(_req: Request, res: Response) {
  if (!ready(res)) return;
  try { const submissions = await LocalBusiness.find({ verificationStatus: 'pending' }).sort({ createdAt: 1 }).limit(100).lean(); return res.json({ success: true, submissions: submissions.map((item: any) => ({ ...item, latitude: item.location.coordinates[1], longitude: item.location.coordinates[0] })) }); }
  catch { return res.status(503).json({ success: false, error: 'Could not load pending business submissions.' }); }
}

export async function addVerifiedBusiness(req: Request, res: Response) {
  const parsed = listingFields.safeParse(req.body);
  if (!parsed.success) return errorResponse(res, 'Add a valid business name, category, address, and coordinates.');
  if (!ready(res)) return;
  const { sustainabilityClaim, sustainabilityEvidence } = parsed.data;
  const canVerifySustainability = Boolean(sustainabilityClaim && sustainabilityEvidence);
  const sustainabilityScore = z.coerce.number().min(0).max(100).safeParse(req.body.sustainabilityScore);
  if (req.body.sustainabilityScore !== undefined && !sustainabilityScore.success) return errorResponse(res, 'Sustainability score must be from 0 to 100.');
  try {
    const data = parsed.data;
    const business = await LocalBusiness.create({ ...data, location: { type: 'Point', coordinates: [data.longitude, data.latitude] }, source: 'manual', verificationStatus: 'verified', sustainabilityVerified: canVerifySustainability && sustainabilityScore.success, sustainabilityScore: canVerifySustainability && sustainabilityScore.success ? sustainabilityScore.data : undefined });
    return res.status(201).json({ success: true, business: { id: business.id, name: business.name, verificationStatus: business.verificationStatus } });
  } catch { return errorResponse(res, 'Could not save this business. Check whether it already exists and try again.'); }
}

export async function verifySubmission(req: Request, res: Response) {
  if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Invalid business submission ID.');
  if (!ready(res)) return;
  const verifySustainability = req.body?.verifySustainability === true;
  const scoreResult = z.coerce.number().min(0).max(100).safeParse(req.body?.sustainabilityScore);
  try {
    const submission = await LocalBusiness.findOne({ _id: req.params.id, verificationStatus: 'pending' });
    if (!submission) return res.status(404).json({ success: false, error: 'Pending submission not found.' });
    submission.verificationStatus = 'verified';
    if (verifySustainability) {
      if (!submission.sustainabilityClaim || !submission.sustainabilityEvidence || !scoreResult.success) return errorResponse(res, 'To verify sustainability details, review the claim and evidence and provide a score from 0 to 100.');
      submission.sustainabilityVerified = true;
      submission.sustainabilityScore = scoreResult.data;
    }
    await submission.save();
    return res.json({ success: true, verificationStatus: submission.verificationStatus, sustainabilityVerified: submission.sustainabilityVerified });
  } catch { return res.status(503).json({ success: false, error: 'Could not verify this submission.' }); }
}
