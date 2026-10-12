import mongoose from 'mongoose';
import LocalBusiness, { type BusinessCategory } from '../models/LocalBusiness';
import { calculateDistanceKm, clamp } from '../utils';
import { findNearbyGoogleBusinesses, type ExternalBusiness } from './googleBusinessService';

type LocalRecord = {
  _id: unknown; name: string; category: BusinessCategory; address: string; location: { coordinates: number[] };
  phone?: string; website?: string; openingHours?: string[]; openNow?: boolean; businessStatus?: string; rating?: number; userRatingCount?: number;
  productsAndServices?: string[]; sustainabilityClaim?: string; sustainabilityEvidence?: string; sustainabilityScore?: number;
  sustainabilityVerified?: boolean; googlePlaceId?: string;
};
export type BusinessResult = {
  id: string; name: string; category: BusinessCategory; address: string; latitude: number; longitude: number;
  phone?: string; website?: string; openingHours?: string[]; openNow?: boolean; businessStatus?: string; rating?: number; userRatingCount?: number;
  productsAndServices: string[]; sustainability?: { description: string; evidence: string; verified: true };
  googleMapsUri: string; source: 'google' | 'local' | 'google+local'; localVerified: boolean;
  distanceKm: number; score: number; explanation: string[]; scores: Record<string, number>; weights: Record<string, number>;
};

const norm = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
type Candidate = ExternalBusiness | (Omit<ReturnType<typeof toLocalResult>, 'source'> & { source: 'local' | 'google+local' });
const toLocalResult = (row: LocalRecord) => {
  const [longitude, latitude] = row.location.coordinates;
  const sustainability = row.sustainabilityVerified && row.sustainabilityClaim && row.sustainabilityEvidence
    ? { description: row.sustainabilityClaim, evidence: row.sustainabilityEvidence, verified: true as const } : undefined;
  return {
    id: String(row.googlePlaceId || row._id), name: row.name, category: row.category, address: row.address,
    latitude, longitude, phone: row.phone, website: row.website, openingHours: row.openingHours, openNow: row.openNow, businessStatus: row.businessStatus,
    rating: row.rating, userRatingCount: row.userRatingCount, productsAndServices: row.productsAndServices ?? [],
    sustainability, googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    source: 'local' as const, localVerified: true, sustainabilityScore: sustainability ? row.sustainabilityScore : undefined,
    googlePlaceId: row.googlePlaceId,
  };
};

function scoreBusiness(item: Candidate, user: { latitude: number; longitude: number; category?: BusinessCategory; radius: number; sustainabilityPreference: number }): BusinessResult {
  const distanceKm = calculateDistanceKm(user.latitude, user.longitude, item.latitude, item.longitude);
  const isLocal = 'localVerified' in item;
  const local = isLocal;
  const localSustainabilityScore = local ? item.sustainabilityScore : undefined;
  const sustainabilityScore = localSustainabilityScore ?? 50;
  const preferenceScore = user.category ? (item.category === user.category ? 100 : 35) : 75;
  const distanceScore = clamp(100 * (1 - distanceKm / (user.radius / 1000)));
  const availabilityScore = item.businessStatus === 'CLOSED_TEMPORARILY' ? 25 : item.openNow === true ? 100 : item.openNow === false ? 35 : 65;
  const rating = item.rating;
  const ratingScore = rating ? clamp((rating / 5) * 85 + Math.min(15, Math.log10((item.userRatingCount ?? 0) + 1) * 4)) : 50;
  const localRelevanceScore = isLocal ? 100 : 60;
  const sustainabilityWeight = 5 + user.sustainabilityPreference * 15;
  const remainingWeight = 100 - sustainabilityWeight;
  const others = { preference: 30, distance: 25, availability: 15, rating: 15, localRelevance: 10 };
  const baseTotal = Object.values(others).reduce((sum, value) => sum + value, 0);
  const weights = Object.fromEntries(Object.entries(others).map(([key, value]) => [key, Math.round(value * remainingWeight / baseTotal * 100) / 100]));
  weights.sustainability = sustainabilityWeight;
  const scores = { preferenceMatch: Math.round(preferenceScore), distance: Math.round(distanceScore), availability: Math.round(availabilityScore), rating: Math.round(ratingScore), localRelevance: Math.round(localRelevanceScore), sustainability: Math.round(sustainabilityScore) };
  const finalScore = (scores.preferenceMatch * weights.preference + scores.distance * weights.distance + scores.availability * weights.availability + scores.rating * weights.rating + scores.localRelevance * weights.localRelevance + scores.sustainability * weights.sustainability) / 100;
  const explanation: string[] = [];
  if (user.category && item.category === user.category) explanation.push(`Matches your ${item.category.replace(/_/g, ' ')} filter`);
  explanation.push(distanceKm < 2 ? 'Close to your selected location' : `${distanceKm.toFixed(1)} km from your selected location`);
  if (item.openNow === true) explanation.push('Listed as open now');
  if (rating && rating >= 4.3) explanation.push(`Rated ${rating.toFixed(1)} by visitors`);
  if (isLocal) explanation.push('Verified local business listing');
  if (localSustainabilityScore !== undefined) explanation.push('Sustainability details verified from the evidence shown');
  else explanation.push('No verified sustainability details available; neutral score used');
  const { sustainability: _sustainability, sustainabilityScore: _score, googlePlaceId: _placeId, ...publicItem } = item as ReturnType<typeof toLocalResult>;
  return {
    ...publicItem,
    ...(item.source === 'google' ? { productsAndServices: [] } : {}),
    ...(local && item.sustainability ? { sustainability: item.sustainability } : {}),
    source: item.source, localVerified: isLocal, distanceKm: Math.round(distanceKm * 10) / 10,
    score: Math.round(finalScore * 10) / 10, explanation, scores, weights,
  } as BusinessResult;
}

export async function discoverBusinesses(input: { latitude: number; longitude: number; radius: number; category?: BusinessCategory; sustainabilityPreference: number }) {
  const dbAvailable = mongoose.connection.readyState === 1;
  const [externalResult, localResult] = await Promise.allSettled([
    findNearbyGoogleBusinesses(input.latitude, input.longitude, input.radius, input.category),
    dbAvailable ? LocalBusiness.find({ verificationStatus: 'verified', ...(input.category ? { category: input.category } : {}), location: { $near: { $geometry: { type: 'Point', coordinates: [input.longitude, input.latitude] }, $maxDistance: input.radius } } }).limit(60).lean() : Promise.resolve([]),
  ]);
  const googleBusinesses = externalResult.status === 'fulfilled' ? externalResult.value : [];
  const localBusinesses = localResult.status === 'fulfilled' ? localResult.value as unknown as LocalRecord[] : [];
  const merged = new Map<string, Candidate>();
  for (const place of googleBusinesses) merged.set(`g:${place.id}`, place);
  for (const row of localBusinesses) {
    const local = toLocalResult(row);
    const duplicate = googleBusinesses.find((place) => (row.googlePlaceId && place.id === row.googlePlaceId) || (norm(place.name) === norm(local.name) && calculateDistanceKm(place.latitude, place.longitude, local.latitude, local.longitude) < 0.15));
    const duplicateLocal = Array.from(merged.entries()).some(([key, item]) => key.startsWith('l:') && norm(item.name) === norm(local.name) && calculateDistanceKm(item.latitude, item.longitude, local.latitude, local.longitude) < 0.15);
    if (duplicate) {
      merged.set(`g:${duplicate.id}`, { ...local, ...duplicate, id: duplicate.id, name: duplicate.name, address: duplicate.address || local.address, phone: duplicate.phone ?? local.phone, website: duplicate.website ?? local.website, rating: duplicate.rating ?? local.rating, userRatingCount: duplicate.userRatingCount ?? local.userRatingCount, openNow: duplicate.openNow ?? local.openNow, businessStatus: duplicate.businessStatus ?? local.businessStatus, openingHours: duplicate.openingHours ?? local.openingHours, googleMapsUri: duplicate.googleMapsUri ?? local.googleMapsUri, productsAndServices: local.productsAndServices, sustainability: local.sustainability, sustainabilityScore: local.sustainabilityScore, localVerified: true, source: 'google+local', googlePlaceId: duplicate.id });
    } else if (!duplicateLocal) merged.set(`l:${String(row._id)}`, local);
  }
  const businesses = Array.from(merged.values()).filter((item) => calculateDistanceKm(input.latitude, input.longitude, item.latitude, item.longitude) <= input.radius / 1000)
    .map((item) => scoreBusiness(item, input)).sort((a, b) => b.score - a.score);
  const externalError = externalResult.status === 'rejected' ? (externalResult.reason instanceof Error ? externalResult.reason.message : 'Google Places is unavailable.') : undefined;
  return { businesses, sources: { googlePlaces: externalResult.status === 'fulfilled', localDatabase: dbAvailable && localResult.status === 'fulfilled' }, externalError, localDatabaseUnavailable: !dbAvailable || localResult.status === 'rejected' };
}
