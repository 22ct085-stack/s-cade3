import axios from 'axios';
import { env } from '../config/env';
import type { BusinessCategory } from '../models/LocalBusiness';

export type ExternalBusiness = {
  id: string; name: string; category: BusinessCategory; address: string; latitude: number; longitude: number;
  phone?: string; website?: string; openingHours?: string[]; openNow?: boolean; rating?: number;
  userRatingCount?: number; googleMapsUri?: string; priceLevel?: string; businessStatus?: string; source: 'google';
};

const googleTypeByCategory: Record<BusinessCategory, string[]> = {
  restaurant: ['restaurant'], cafe: ['cafe'], bakery: ['bakery'], hotel: ['hotel', 'lodging'],
  homestay: ['lodging'], handicrafts: ['gift_shop'], local_store: ['store'], tourism_service: ['tourist_information_center'],
};
const categoryForTypes = (types: string[] = []): BusinessCategory => {
  if (types.includes('bakery')) return 'bakery';
  if (types.includes('cafe')) return 'cafe';
  if (types.includes('restaurant')) return 'restaurant';
  if (types.includes('hotel')) return 'hotel';
  if (types.includes('lodging')) return 'homestay';
  if (types.includes('tourist_information_center')) return 'tourism_service';
  if (types.includes('gift_shop') || types.includes('craft_store')) return 'handicrafts';
  return 'local_store';
};

export async function findNearbyGoogleBusinesses(latitude: number, longitude: number, radius: number, category?: BusinessCategory): Promise<ExternalBusiness[]> {
  if (!env.googlePlacesApiKey) throw new Error('Google Places is not configured. Add GOOGLE_PLACES_API_KEY to the server environment.');
  const includedTypes = category ? googleTypeByCategory[category] : ['restaurant', 'cafe', 'bakery', 'hotel', 'lodging', 'store', 'gift_shop', 'tourist_information_center'];
  try {
    const response = await axios.post('https://places.googleapis.com/v1/places:searchNearby', {
      includedTypes, maxResultCount: 20,
      locationRestriction: { circle: { center: { latitude, longitude }, radius } }, rankPreference: 'DISTANCE',
    }, { headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.googlePlacesApiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.rating,places.userRatingCount,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours.weekdayDescriptions,places.currentOpeningHours.openNow,places.businessStatus,places.priceLevel' }, timeout: 12000 });
    return (response.data.places ?? []).flatMap((place: any): ExternalBusiness[] => {
      const lat = Number(place.location?.latitude); const lon = Number(place.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || place.businessStatus === 'CLOSED_PERMANENTLY') return [];
      return [{
        id: String(place.id), name: String(place.displayName?.text ?? 'Local business'), category: categoryForTypes(place.types),
        address: String(place.formattedAddress ?? 'Address unavailable'), latitude: lat, longitude: lon,
        phone: place.nationalPhoneNumber, website: place.websiteUri, openingHours: place.regularOpeningHours?.weekdayDescriptions,
        openNow: place.currentOpeningHours?.openNow, rating: Number.isFinite(place.rating) ? place.rating : undefined,
        userRatingCount: Number.isFinite(place.userRatingCount) ? place.userRatingCount : undefined,
        googleMapsUri: place.googleMapsUri, priceLevel: place.priceLevel, businessStatus: place.businessStatus, source: 'google',
      }];
    });
  } catch (cause) {
    if (axios.isAxiosError(cause)) {
      const message = cause.response?.status === 403
        ? 'Google Places rejected the business search. Check billing, Places API (New), and key restrictions.'
        : 'Google Places business search is temporarily unavailable.';
      throw Object.assign(new Error(message), { statusCode: 502 });
    }
    throw cause;
  }
}
