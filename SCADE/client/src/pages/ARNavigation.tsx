import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, Camera, Compass, LocateFixed, Map, MapPin, Navigation, RotateCcw, X } from 'lucide-react';
import Navbar from '../components/Navbar';
import RouteMap from '../components/RouteMap';
import type { Coordinates, Place, RouteStep, WalkingRoute } from '../types';
import { getWalkingRoute, readableError } from '../services/api';
import { saveLocation } from '../services/preferences';

type NavState = { place?: Place };
const haversine = (a: Coordinates, b: Coordinates) => { const r = Math.PI / 180; const dLat = (b.latitude - a.latitude) * r; const dLon = (b.longitude - a.longitude) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
const bearing = (a: Coordinates, b: Coordinates) => { const r = Math.PI / 180; const y = Math.sin((b.longitude - a.longitude) * r) * Math.cos(b.latitude * r); const x = Math.cos(a.latitude * r) * Math.sin(b.latitude * r) - Math.sin(a.latitude * r) * Math.cos(b.latitude * r) * Math.cos((b.longitude - a.longitude) * r); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
function decodePolyline(encoded: string): Coordinates[] { let index = 0; let lat = 0; let lng = 0; const points: Coordinates[] = []; while (index < encoded.length) { let result = 0; let shift = 0; let byte: number; do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20); lat += result & 1 ? ~(result >> 1) : result >> 1; result = 0; shift = 0; do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20); lng += result & 1 ? ~(result >> 1) : result >> 1; points.push({ latitude: lat / 1e5, longitude: lng / 1e5 }); } return points; }
const distanceLabel = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(meters / 10) * 10)} m`;
const timeLabel = (seconds: number) => { const mins = Math.max(1, Math.ceil(seconds / 60)); return mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`; };
function locationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return 'Location access was blocked. Allow location for this site in your browser settings, then tap Start walking navigation again.';
  if (error.code === error.POSITION_UNAVAILABLE) return 'Your device could not get a GPS position. Turn on Location Services and try again where the sky is more visible.';
  if (error.code === error.TIMEOUT) return 'Could not get a GPS fix in time. Try again outdoors, or enter your starting coordinates below.';
  return 'Could not read your location. Check Location Services and try again.';
}
function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'Camera access requires HTTPS (or localhost). Open the secure S-CADE address and try again.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Camera access was blocked by your browser or device. In the site settings, change Camera to Allow, then reload S-CADE and tap Camera AR again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found on this device.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The camera could not start. Close other apps using the camera and try again.';
  if (name === 'OverconstrainedError') return 'The rear camera could not be selected. Check your camera and try again.';
  return error instanceof Error ? `Camera could not start: ${error.message}` : 'Camera could not start. Check site and device camera permissions, then try again.';
}

function getFreshGpsFix(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Location is unavailable in this browser. Use HTTPS and allow location access.')); return; }
    let watchId: number | null = null;
    let timer = 0;
    let qualityTimer: number | null = null;
    let best: GeolocationPosition | null = null;
    let settled = false;
    const startedAt = Date.now();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(timer);
      if (qualityTimer !== null) window.clearTimeout(qualityTimer);
      if (error) reject(error);
      else if (best) resolve({ latitude: best.coords.latitude, longitude: best.coords.longitude });
    };
    timer = window.setTimeout(() => {
      if (best && best.coords.accuracy <= 1000) finish();
      else finish(new Error(best
        ? `GPS accuracy is still low (±${Math.round(best.coords.accuracy)} m). Enable precise location and try outdoors, or enter coordinates.`
        : 'GPS did not return a fresh position. Turn on device Location Services, allow location for this site, and try again outdoors.'));
    }, 25000);
    watchId = navigator.geolocation.watchPosition((position) => {
      if (Date.now() - position.timestamp > 30000) return;
      if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
      // Give the device a short chance to improve its first coarse fix. If it
      // does not emit another reading while stationary, use the fresh best fix.
      if (best.coords.accuracy <= 100 && Date.now() - startedAt >= 2500) finish();
      else if (best.coords.accuracy <= 1000 && qualityTimer === null) {
        qualityTimer = window.setTimeout(() => { if (best && best.coords.accuracy <= 1000) finish(); }, 2500);
      }
    }, (error) => {
      if (error.code === error.PERMISSION_DENIED) finish(new Error(locationErrorMessage(error)));
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 });
  });
}

export default function ARNavigation() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const statePlace = (location.state as NavState | null)?.place;
  const latitude = Number(searchParams.get('latitude')); const longitude = Number(searchParams.get('longitude'));
  const place = statePlace ?? (Number.isFinite(latitude) && Number.isFinite(longitude) && searchParams.has('latitude') && searchParams.has('longitude') ? { id: 'route-destination', name: searchParams.get('name') || 'Selected destination', address: searchParams.get('address') || '', latitude, longitude } : undefined);
  const navigate = useNavigate();
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [route, setRoute] = useState<WalkingRoute | null>(null);
  const [mode, setMode] = useState<'ar' | 'map'>('map');
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [arrived, setArrived] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [remainingMeters, setRemainingMeters] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [offRoute, setOffRoute] = useState(false);
  const [manualLatitude, setManualLatitude] = useState('');
  const [manualLongitude, setManualLongitude] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastRecalcRef = useRef(0);
  const currentPositionRef = useRef<Coordinates | null>(null);
  const routeRef = useRef<WalkingRoute | null>(null);
  const allPoints = useMemo(() => route ? decodePolyline(route.polyline) : [], [route]);
  const currentStep = route?.steps[Math.min(stepIndex, (route.steps.length || 1) - 1)];
  const nextPoint = currentStep?.endLocation ?? place;
  const direction = position && nextPoint && heading !== null ? ((bearing(position, nextPoint) - heading + 540) % 360) - 180 : 0;
  const remainingTime = route && route.distanceMeters > 0 ? route.durationSeconds * Math.min(1, remainingMeters / route.distanceMeters) : route?.durationSeconds ?? 0;

  const refreshRoute = useCallback(async (origin: Coordinates, quiet = false) => {
    if (!place) return;
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const result = await getWalkingRoute(origin, { latitude: place.latitude, longitude: place.longitude });
      routeRef.current = result; setRoute(result); setRemainingMeters(result.distanceMeters); setStepIndex(0); setOffRoute(false); setArrived(false); lastRecalcRef.current = Date.now();
    } catch (problem) { if (!quiet) { setError(readableError(problem)); throw problem; } setError(readableError(problem)); setOffRoute(false); }
    finally { if (!quiet) setLoading(false); }
  }, [place]);

  useEffect(() => { if (mode === 'ar' && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current; }, [mode, active]);
  useEffect(() => () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); streamRef.current?.getTracks().forEach((track) => track.stop()); window.removeEventListener('deviceorientation', onOrientation); }, []);

  const onOrientation = (event: DeviceOrientationEvent) => {
    const webkit = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
    const value = typeof webkit.webkitCompassHeading === 'number' ? webkit.webkitCompassHeading : typeof event.alpha === 'number' ? (360 - event.alpha) % 360 : null;
    if (value !== null) setHeading(value);
  };

  const handlePosition = useCallback((lat: number, lon: number) => {
    const current = { latitude: lat, longitude: lon };
    currentPositionRef.current = current; setPosition(current); saveLocation(current);
    const activeRoute = routeRef.current;
    if (!place) return;
    const toDestination = haversine(current, { latitude: place.latitude, longitude: place.longitude });
    if (toDestination < 22) { setArrived(true); setRemainingMeters(0); return; }
    if (activeRoute) {
      const points = decodePolyline(activeRoute.polyline);
      let nearest = Infinity; let nearestIndex = 0;
      points.forEach((point, i) => { const d = haversine(current, point); if (d < nearest) { nearest = d; nearestIndex = i; } });
      const fraction = points.length > 1 ? nearestIndex / (points.length - 1) : 0;
      setRemainingMeters(Math.max(toDestination, activeRoute.distanceMeters * (1 - fraction)));
      const step = activeRoute.steps.findIndex((item) => haversine(current, item.endLocation) > 20);
      setStepIndex(step < 0 ? Math.max(0, activeRoute.steps.length - 1) : step);
      if (nearest > 55 && Date.now() - lastRecalcRef.current > 12000) { setOffRoute(true); void refreshRoute(current, true); }
    }
  }, [place, refreshRoute]);

  const startNavigation = async (manualOrigin?: Coordinates) => {
    if (!place) return;
    setError(''); setLoading(true);
    try {
      let initial: Coordinates;
      if (manualOrigin) {
        initial = manualOrigin;
      } else {
        initial = await getFreshGpsFix();
      }
      setPosition(initial); currentPositionRef.current = initial; saveLocation(initial);
      await refreshRoute(initial);
      watchRef.current = navigator.geolocation.watchPosition((p) => { handlePosition(p.coords.latitude, p.coords.longitude); if (p.coords.heading !== null && Number.isFinite(p.coords.heading)) setHeading(p.coords.heading); }, (geoError) => setError(locationErrorMessage(geoError)), { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
      setMode('map'); setActive(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not start AR navigation.');
    } finally { setLoading(false); }
  };

  // Request location only after a tap; mobile browsers handle permission prompts more reliably from a user gesture.

  const showAR = async () => {
    setError('');
    try {
      const media = await navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!media) throw new Error('Camera access is unavailable. Open this page on a phone using HTTPS or localhost.');
      streamRef.current = media;
      const orientation = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
      if (orientation.requestPermission) { try { await orientation.requestPermission(); } catch { /* GPS guidance remains available without compass access. */ } }
      window.addEventListener('deviceorientation', onOrientation);
      setMode('ar');
    } catch (problem) { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setError(cameraErrorMessage(problem)); }
  };

  const showMap = () => { window.removeEventListener('deviceorientation', onOrientation); streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setMode('map'); };

  const exit = () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; window.removeEventListener('deviceorientation', onOrientation); navigate('/recommendations'); };

  if (!place) return <><Navbar/><main className="nav-page"><div className="nav-error-state"><MapPin size={28}/><h1>Choose a destination first</h1><p>Select <strong>Show walking route</strong> on a recommendation to view its route here.</p><Link className="button button-primary" to="/recommendations">View recommendations</Link></div></main></>;
  return <><Navbar/><main className="nav-page"><header className="nav-page-header"><Link to="/recommendations" className="back-link"><ArrowLeft size={15}/> Recommendations</Link><div className="nav-destination-head"><span className="nav-destination-icon"><Navigation size={17}/></span><div><span className="eyebrow">LIVE WALKING NAVIGATION</span><h1>{place.name}</h1><p>{place.address}</p></div></div></header>
    <section className={`navigation-shell ${active ? 'is-active' : ''}`}>
      {!active ? <div className="nav-start-screen"><div className="nav-start-visual"><div className="nav-start-rings"><Navigation size={36}/></div><span>LIVE WALKING DIRECTIONS</span></div><h2>Ready to find your way?</h2><p>Show the walking route to {place.name} directly on this page. You can turn on camera guidance after the route loads.</p><button className="button button-primary nav-start-button" onClick={() => void startNavigation()} disabled={loading}>{loading ? <><span className="nav-spinner"/>Getting your route…</> : <><Map size={17}/>Start walking navigation</>}</button><small>Navigation requires a fresh precise location and will not reuse a saved town or old GPS fix. Camera access is only requested if you switch to Camera AR.</small><form className="nav-manual-location" onSubmit={(event) => { event.preventDefault(); const lat = Number(manualLatitude); const lon = Number(manualLongitude); if (!manualLatitude || !manualLongitude || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { setError('Enter a valid latitude (−90 to 90) and longitude (−180 to 180).'); return; } void startNavigation({ latitude: lat, longitude: lon }); }}><span>GPS not responding? Start from coordinates</span><div><input aria-label="Starting latitude" inputMode="decimal" placeholder="Latitude" value={manualLatitude} onChange={(event) => setManualLatitude(event.target.value)}/><input aria-label="Starting longitude" inputMode="decimal" placeholder="Longitude" value={manualLongitude} onChange={(event) => setManualLongitude(event.target.value)}/><button className="button button-dark" type="submit" disabled={loading}>Use coordinates</button></div></form></div> : <>
        <div className={`nav-view ${mode === 'ar' ? 'camera-view' : 'map-view'}`}>
          {mode === 'ar' ? <><video ref={videoRef} autoPlay muted playsInline className="nav-camera"/><div className="nav-camera-shade"/><div className="nav-compass-hud"><Compass size={14}/>{heading === null ? 'Compass unavailable' : `${Math.round(heading)}°`}</div><div className="nav-ar-path"><div className="nav-ar-dash dash-a"/><div className="nav-ar-dash dash-b"/><div className="nav-ar-dash dash-c"/><div className="nav-ar-arrow" style={{ transform: `translateX(-50%) rotate(${direction}deg)` }}><ArrowUp size={38}/></div><span>FOLLOW AR DIRECTION</span></div><div className="nav-camera-destination"><MapPin size={15}/><span>{place.name}</span></div></> : <RouteMap path={allPoints} current={position} destination={{ latitude: place.latitude, longitude: place.longitude }}/ >}
          <div className="nav-top-controls"><button aria-label={mode === 'ar' ? 'Switch to map route' : 'Switch to camera AR view'} onClick={() => mode === 'ar' ? showMap() : void showAR()}>{mode === 'ar' ? <><Map size={15}/>Map route</> : <><Camera size={15}/>Camera AR</>}</button><button className="nav-exit" onClick={exit}><X size={16}/>Exit</button></div>
          {offRoute && !arrived && <div className="nav-rerouting"><RotateCcw size={14}/>Updating route…</div>}
          {arrived && <div className="nav-arrived"><span>✓</span><strong>You have arrived</strong><small>{place.name}</small></div>}
          <div className="nav-guidance-card"><div className="nav-next-turn"><span className="nav-turn-icon"><ArrowUp size={23}/></span><div><strong>{arrived ? 'Destination reached' : currentStep?.instruction ?? 'Follow the route'}</strong><small>{arrived ? place.name : `In ${distanceLabel(currentStep ? haversine(position ?? currentStep.startLocation, currentStep.endLocation) : remainingMeters)}`}</small></div></div><div className="nav-progress-track"><span style={{ width: `${route ? Math.max(4, Math.min(100, 100 * (1 - remainingMeters / Math.max(1, route.distanceMeters)))) : 0}%` }}/></div><div className="nav-trip-stats"><span><strong>{distanceLabel(remainingMeters)}</strong><small>remaining</small></span><i/><span><strong>{timeLabel(remainingTime)}</strong><small>walking</small></span><i/><span><strong>{route?.steps.length ? Math.min(stepIndex + 1, route.steps.length) : '—'}</strong><small>step</small></span></div></div>
        </div><div className="nav-lower-bar"><span><LocateFixed size={15}/>{position ? 'Live GPS connected' : 'Waiting for GPS'}</span><button onClick={() => position && void refreshRoute(position)} disabled={loading}><RotateCcw size={14}/> Recalculate</button></div>
      </>}
      {error && <div className="nav-error" role="alert">{error}{route && position && <button onClick={() => void refreshRoute(position)}>Try again</button>}</div>}
    </section><p className="nav-disclaimer">Walking routes may not show clear sidewalks or pedestrian paths. Follow local signs, use crossings, and stay aware of traffic and surroundings. The route remains in S-CADE; AR guidance is a compass-aligned on-screen overlay.</p>
  </main><footer className="site-footer inner-footer"><span>© 2026 S-CADE</span><span>Walk thoughtfully.</span></footer></>;
}
