import axios from 'axios';
import type { BusinessCategory, BusinessListingInput, Coordinates, LocalBusiness, Preferences, Recommendation, Weather, WalkingRoute } from '../types';

const apiBaseUrl = import.meta.env.VITE_API_URL || '/api';
const api = axios.create({ baseURL: apiBaseUrl, timeout: 18000 });
export function readableError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (typeof error.response?.data?.error === 'string') return error.response.data.error;
    if (error.code === 'ECONNABORTED') return 'The request took too long. Please try again.';
    if (error.response) return `S-CADE API returned HTTP ${error.response.status}. Check the backend deployment and API URL.`;
    if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) return 'The API URL is not configured for this deployed site. Set VITE_API_URL to your public backend URL ending in /api, then rebuild the frontend.';
    return 'Could not reach the S-CADE API. Make sure the backend is deployed and the API URL is correct.';
  }
  return 'Something went wrong. Please try again.';
}
export async function getRecommendations(coords: Coordinates, prefs: Preferences) {
  const { data } = await api.get<{ success: boolean; recommendations: Recommendation[]; weather: Weather | null; message?: string }>('/recommendations', { params: { ...coords, ...prefs, walking: String(prefs.walking) } });
  return data;
}
export async function searchLocations(query: string) {
  const { data } = await api.get<{ locations: (Coordinates & { name: string; address: string })[] }>('/places/search', { params: { query } });
  return data.locations;
}
export async function getWalkingRoute(origin: Coordinates, destination: Coordinates) {
  const { data } = await api.get<{ success: boolean; route: WalkingRoute }>('/routes/walking', { params: { originLatitude: origin.latitude, originLongitude: origin.longitude, destinationLatitude: destination.latitude, destinationLongitude: destination.longitude } });
  return data.route;
}
export async function getNearbyBusinesses(coords: Coordinates, options: { radius: number; category?: BusinessCategory; sustainabilityPreference: number }) {
  const { data } = await api.get<{ success: boolean; businesses: LocalBusiness[]; sources: { googlePlaces: boolean; localDatabase: boolean }; externalError?: string; localDatabaseUnavailable: boolean; message?: string }>('/businesses/nearby', { params: { ...coords, ...options } });
  return data;
}
export async function submitBusinessListing(listing: BusinessListingInput) {
  const { data } = await api.post<{ success: boolean; message: string; verificationStatus: string }>('/businesses/submissions', listing);
  return data;
}
export async function getPendingBusinesses(adminToken: string) {
  const { data } = await api.get<{ success: boolean; submissions: (BusinessListingInput & { _id: string; latitude: number; longitude: number })[] }>('/businesses/admin/pending', { headers: { 'x-admin-token': adminToken } });
  return data.submissions;
}
export async function addVerifiedBusiness(listing: BusinessListingInput & { sustainabilityScore?: number }, adminToken: string) {
  const { data } = await api.post<{ success: boolean }>('/businesses/admin', listing, { headers: { 'x-admin-token': adminToken } });
  return data;
}
export async function verifyBusinessSubmission(id: string, adminToken: string, sustainability?: { verifySustainability: true; sustainabilityScore: number }) {
  const { data } = await api.patch<{ success: boolean; verificationStatus: string }>(`/businesses/admin/${encodeURIComponent(id)}/verify`, sustainability ?? {}, { headers: { 'x-admin-token': adminToken } });
  return data;
}
