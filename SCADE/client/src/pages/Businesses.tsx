import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, BadgeCheck, Building2, Clock3, Compass, ExternalLink, Leaf, LoaderCircle, MapPin, Phone, Plus, Search, ShieldCheck, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import LocationForm from '../components/LocationForm';
import { getNearbyBusinesses, readableError, submitBusinessListing } from '../services/api';
import { readLocation, readPreferences, saveLocation } from '../services/preferences';
import type { BusinessCategory, BusinessListingInput, Coordinates, LocalBusiness } from '../types';
import './businesses.css';

const categories: { value: BusinessCategory | ''; label: string }[] = [
  { value: '', label: 'All businesses' }, { value: 'restaurant', label: 'Restaurants' }, { value: 'cafe', label: 'Cafés' },
  { value: 'bakery', label: 'Bakeries' }, { value: 'hotel', label: 'Hotels' }, { value: 'homestay', label: 'Homestays' },
  { value: 'handicrafts', label: 'Handicrafts' }, { value: 'local_store', label: 'Local stores' }, { value: 'tourism_service', label: 'Tourism services' },
];
const labelFor = (category: string) => categories.find((item) => item.value === category)?.label ?? 'Local business';

export default function Businesses() {
  const [coords, setCoords] = useState<Coordinates | null>(readLocation);
  const [category, setCategory] = useState<BusinessCategory | ''>('');
  const [radius, setRadius] = useState(5000);
  const [businesses, setBusinesses] = useState<LocalBusiness[]>([]);
  const [sources, setSources] = useState<{ googlePlaces: boolean; localDatabase: boolean } | null>(null);
  const [externalError, setExternalError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const preferences = readPreferences();

  const load = useCallback(async () => {
    if (!coords) { setError('Choose a location to discover businesses nearby.'); return; }
    setLoading(true); setError(''); setExternalError(''); setNotice('');
    try {
      const result = await getNearbyBusinesses(coords, { radius, category: category || undefined, sustainabilityPreference: preferences.sustainabilityPreference });
      setBusinesses(result.businesses); setSources(result.sources); setExternalError(result.externalError ?? '');
      if (!result.businesses.length) setNotice(result.message ?? 'No businesses found nearby.');
    } catch (problem) { setBusinesses([]); setError(readableError(problem)); }
    finally { setLoading(false); }
  }, [coords, radius, category, preferences.sustainabilityPreference]);

  useEffect(() => { if (coords) void load(); }, [coords, category, radius, load]);
  const chooseLocation = (value: Coordinates) => { saveLocation(value); setCoords(value); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true); setNotice(''); setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const lat = Number(data.get('latitude')); const lon = Number(data.get('longitude'));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) { setError('Enter valid coordinates for the business.'); setSubmitting(false); return; }
    const listing: BusinessListingInput = {
      name: String(data.get('name') ?? '').trim(), category: String(data.get('category') ?? 'restaurant') as BusinessCategory,
      address: String(data.get('address') ?? '').trim(), latitude: lat, longitude: lon,
      phone: String(data.get('phone') ?? '').trim(), website: String(data.get('website') ?? '').trim(),
      submittedBy: String(data.get('submittedBy') ?? '').trim(),
      productsAndServices: String(data.get('productsAndServices') ?? '').split(',').map((part) => part.trim()).filter(Boolean),
      openingHours: String(data.get('openingHours') ?? '').split('\n').map((part) => part.trim()).filter(Boolean),
      sustainabilityClaim: String(data.get('sustainabilityClaim') ?? '').trim(), sustainabilityEvidence: String(data.get('sustainabilityEvidence') ?? '').trim(),
    };
    try { const result = await submitBusinessListing(listing); setNotice(result.message); form.reset(); }
    catch (problem) { setError(readableError(problem)); }
    finally { setSubmitting(false); }
  };

  return <><Navbar/><main className="business-page">
    <header className="business-hero"><div className="business-hero-copy"><span className="eyebrow">MEET THE PEOPLE BEHIND THE PLACE</span><h1>Discover <em>local.</em></h1><p>Find neighborhood cafés, family-run stays, makers and helpful local services around your trip.</p><div className="business-hero-points"><span><MapPin size={15}/>Nearby places</span><span><ShieldCheck size={15}/>Verified community listings</span><span><Leaf size={15}/>Evidence-aware sustainability</span></div></div><div className="business-hero-mark"><Building2 size={44}/><span>Keep your<br/>trip local.</span></div></header>

    <div className="business-layout"><section className="business-results">
      <div className="business-search-head"><div><span className="eyebrow">LOCAL FINDS, RANKED FOR YOU</span><h2>Good places, close by</h2></div><button className="business-reload" onClick={() => void load()} disabled={loading}><Search size={15}/>{loading ? 'Searching…' : 'Refresh'}</button></div>
      <div className="business-filters"><label>Business type<select value={category} onChange={(event) => setCategory(event.target.value as BusinessCategory | '')}>{categories.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select></label><label className="radius-filter">Search radius <strong>{(radius / 1000).toFixed(0)} km</strong><input type="range" min="1000" max="15000" step="1000" value={radius} onChange={(event) => setRadius(Number(event.target.value))}/></label></div>
      {coords && <p className="business-location"><MapPin size={14}/>{coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)} <span>·</span> Ranked by relevance, distance, availability, visitor ratings and verified details</p>}
      {sources && <div className="business-source-line"><span className={sources.googlePlaces ? 'source-live' : 'source-muted'}><i/>{sources.googlePlaces ? 'Google Places connected' : 'Google Places unavailable'}</span><span className={sources.localDatabase ? 'source-live' : 'source-muted'}><i/>{sources.localDatabase ? 'Community directory connected' : 'Local directory unavailable'}</span></div>}
      {loading ? <div className="business-state"><LoaderCircle className="business-spin"/><strong>Finding local businesses…</strong><span>Checking nearby listings and verified community records.</span></div> : error ? <div className="business-state business-error" role="alert"><strong>Couldn’t load nearby businesses</strong><span>{error}</span><button onClick={() => void load()}>Try again</button></div> : businesses.length ? <div className="business-card-grid">{businesses.map((item) => <BusinessCard key={`${item.source}:${item.id}`} item={item}/>)}</div> : <div className="business-state"><Building2 size={25}/><strong>{coords ? 'No businesses found yet' : 'Choose a starting location'}</strong><span>{externalError || notice || 'Use GPS, enter coordinates, or search for a town to see businesses around it.'}</span>{coords && <button onClick={() => void load()}>Try again</button>}</div>}
      {externalError && businesses.length > 0 && <p className="business-note">Google Places could not be reached. Showing available local directory records only.</p>}
      <details className="business-submit"><summary><span><Plus size={17}/>Suggest a local business</span><small>Community listings are checked before they appear in discovery.</small></summary><form className="business-submit-form" onSubmit={submit}>
        <div className="business-form-grid"><label>Business name<input name="name" required maxLength={120} placeholder="e.g. Mountain View Bakery"/></label><label>Category<select name="category" defaultValue="restaurant">{categories.filter((item) => item.value).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="business-wide">Address<input name="address" required maxLength={300} placeholder="Street, town, postal code"/></label><label>Latitude<input name="latitude" required type="number" step="any" defaultValue={coords?.latitude ?? ''}/></label><label>Longitude<input name="longitude" required type="number" step="any" defaultValue={coords?.longitude ?? ''}/></label><label>Phone<input name="phone" maxLength={40} placeholder="Optional"/></label><label>Website<input name="website" type="url" maxLength={300} placeholder="https://… (optional)"/></label><label className="business-wide">Products or services<input name="productsAndServices" placeholder="Tea, handmade crafts, guided tours…"/></label><label className="business-wide">Opening hours <small>One line per day, if known</small><textarea name="openingHours" rows={3} placeholder="Mon–Sat: 9:00–18:00"/></label><label>Submitted by<input name="submittedBy" maxLength={120} placeholder="Name (optional)"/></label><label className="business-wide">Sustainability claim <small>Only add a claim if you can include evidence. It remains unverified until reviewed.</small><textarea name="sustainabilityClaim" rows={2} maxLength={500}/></label><label className="business-wide">Evidence or source URL<input name="sustainabilityEvidence" maxLength={500} placeholder="A public source or verification note"/></label></div>
        <button className="button button-primary" disabled={submitting}>{submitting ? 'Sending…' : 'Submit for review'}</button>
      </form></details>
      {(notice || externalError && !businesses.length) && <p className={notice.startsWith('Thanks') ? 'business-success-message' : 'business-note'} role="status">{notice || externalError}</p>}
    </section><aside className="business-sidebar"><section className="business-side-card"><span className="business-side-icon"><MapPin size={17}/></span><h3>Search around a place</h3><p>Use your device location or pick a town, landmark or coordinates.</p><LocationForm compact onLocation={chooseLocation}/></section><section className="business-side-card business-trust-card"><span className="business-side-icon"><BadgeCheck size={17}/></span><h3>Listings with context</h3><p>Google provides nearby public listings. Community-submitted businesses stay hidden until verified by an admin.</p><p>Sustainability details are shown only when supporting evidence has been reviewed. Otherwise, the score is neutral and no environmental claim is made.</p><Link to="/businesses/admin">Business admin <ArrowUpRight size={14}/></Link></section></aside></div>
  </main><footer className="site-footer inner-footer"><span>© 2026 S-CADE</span><span>Support your local journey.</span></footer></>;
}

function BusinessCard({ item }: { item: LocalBusiness }) {
  const websiteUrl = (() => { try { const url = new URL(item.website ?? ''); return ['https:', 'http:'].includes(url.protocol) ? url.toString() : ''; } catch { return ''; } })();
  const evidenceUrl = (() => { try { const url = new URL(item.sustainability?.evidence ?? ''); return ['https:', 'http:'].includes(url.protocol) ? url.toString() : ''; } catch { return ''; } })();
  return <article className="business-card"><div className="business-card-top"><span className="business-category">{labelFor(item.category)}</span><span className="business-score"><strong>{Math.round(item.score)}</strong><small>match</small></span></div><h3>{item.name}</h3><div className="business-card-tags">{item.source === 'google+local' ? <><span className="google-tag">Google Places</span><span className="verified-tag"><BadgeCheck size={13}/>Verified local</span></> : <span className={item.localVerified ? 'verified-tag' : 'google-tag'}>{item.localVerified ? <><BadgeCheck size={13}/>Verified local</> : 'Google Places'}</span>}{item.openNow !== undefined && <span className={item.openNow ? 'open-tag' : 'closed-tag'}><i/>{item.openNow ? 'Open now' : 'Reported closed'}</span>}</div><p className="business-address"><MapPin size={14}/>{item.address}</p><div className="business-stats">{item.rating !== undefined && <span><Star size={14} fill="currentColor"/>{item.rating.toFixed(1)} <small>({(item.userRatingCount ?? 0).toLocaleString()})</small></span>}<span><Compass size={14}/>{item.distanceKm.toFixed(1)} km</span></div>
    {item.productsAndServices.length > 0 && <p className="business-services"><strong>Known for</strong> {item.productsAndServices.join(' · ')}</p>}
    <div className="business-reasons"><small>WHY THIS MATCH</small>{item.explanation.slice(0, 3).map((reason) => <span key={reason}>✓ {reason}</span>)}</div>
    {item.sustainability ? <div className="business-sustainability"><Leaf size={15}/><span><strong>Verified sustainability detail</strong>{item.sustainability.description}{evidenceUrl ? <a href={evidenceUrl} target="_blank" rel="noreferrer">Review evidence <ExternalLink size={12}/></a> : <small>Reviewed evidence: {item.sustainability.evidence}</small>}</span></div> : <div className="business-neutral"><Leaf size={14}/> Sustainability information is unavailable or unverified; neutral scoring used.</div>}
    {item.openingHours?.length ? <details className="business-hours"><summary><Clock3 size={14}/>Opening hours</summary><div>{item.openingHours.map((line) => <span key={line}>{line}</span>)}</div></details> : null}
    <div className="business-actions">{item.phone && <a href={`tel:${item.phone}`} aria-label={`Call ${item.name}`}><Phone size={14}/>Call</a>}{websiteUrl && <a href={websiteUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/>Website</a>}<a href={item.googleMapsUri} target="_blank" rel="noreferrer"><MapPin size={14}/>Map</a><Link to={`/navigate?latitude=${item.latitude}&longitude=${item.longitude}&name=${encodeURIComponent(item.name)}&address=${encodeURIComponent(item.address)}`}><Compass size={14}/>Walk there <ArrowUpRight size={13}/></Link></div>
  </article>;
}
