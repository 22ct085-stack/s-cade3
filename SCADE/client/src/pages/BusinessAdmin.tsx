import { FormEvent, useState } from 'react';
import { ArrowLeft, BadgeCheck, ClipboardCheck, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { addVerifiedBusiness, getPendingBusinesses, readableError, verifyBusinessSubmission } from '../services/api';
import type { BusinessCategory, BusinessListingInput } from '../types';
import './businesses.css';

type PendingBusiness = BusinessListingInput & { _id: string };
const categories: { value: BusinessCategory; label: string }[] = [
  { value: 'restaurant', label: 'Restaurant' }, { value: 'cafe', label: 'Café' }, { value: 'bakery', label: 'Bakery' },
  { value: 'hotel', label: 'Hotel' }, { value: 'homestay', label: 'Homestay' }, { value: 'handicrafts', label: 'Handicrafts' },
  { value: 'local_store', label: 'Local store' }, { value: 'tourism_service', label: 'Tourism service' },
];

export default function BusinessAdmin() {
  const [token, setToken] = useState('');
  const [submissions, setSubmissions] = useState<PendingBusiness[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadSubmissions = async () => {
    setLoading(true); setError(''); setNotice('');
    try { setSubmissions(await getPendingBusinesses(token)); setNotice('Pending community submissions loaded.'); }
    catch (problem) { setError(readableError(problem)); }
    finally { setLoading(false); }
  };
  const approve = async (id: string, form: HTMLFormElement) => {
    setLoading(true); setError(''); setNotice('');
    const data = new FormData(form); const verifySustainability = data.get('verifySustainability') === 'on';
    try {
      await verifyBusinessSubmission(id, token, verifySustainability ? { verifySustainability: true, sustainabilityScore: Number(data.get('sustainabilityScore')) } : undefined);
      setSubmissions((items) => items.filter((item) => item._id !== id)); setNotice('Business listing verified and published.');
    } catch (problem) { setError(readableError(problem)); }
    finally { setLoading(false); }
  };
  const addManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setLoading(true); setError(''); setNotice('');
    const listing: BusinessListingInput & { sustainabilityScore?: number } = {
      name: String(data.get('name') ?? '').trim(), category: String(data.get('category') ?? 'restaurant') as BusinessCategory,
      address: String(data.get('address') ?? '').trim(), latitude: Number(data.get('latitude')), longitude: Number(data.get('longitude')),
      phone: String(data.get('phone') ?? '').trim(), website: String(data.get('website') ?? '').trim(),
      productsAndServices: String(data.get('productsAndServices') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
      openingHours: String(data.get('openingHours') ?? '').split('\n').map((value) => value.trim()).filter(Boolean),
      sustainabilityClaim: String(data.get('sustainabilityClaim') ?? '').trim(), sustainabilityEvidence: String(data.get('sustainabilityEvidence') ?? '').trim(),
      rating: String(data.get('rating') ?? '').trim() ? Number(data.get('rating')) : undefined,
      userRatingCount: String(data.get('userRatingCount') ?? '').trim() ? Number(data.get('userRatingCount')) : undefined,
    };
    const sustainabilityScore = String(data.get('sustainabilityScore') ?? '').trim();
    if (sustainabilityScore) listing.sustainabilityScore = Number(sustainabilityScore);
    try { await addVerifiedBusiness(listing, token); form.reset(); setNotice('Verified business added to the local directory.'); }
    catch (problem) { setError(readableError(problem)); }
    finally { setLoading(false); }
  };

  return <><Navbar/><main className="admin-page"><header className="admin-header"><Link className="back-link" to="/businesses"><ArrowLeft size={14}/> Local businesses</Link><span className="eyebrow">STAFF WORKSPACE</span><h1>Business <em>directory admin.</em></h1><p>Review community suggestions before publishing. Sustainability information is verified separately and requires supporting evidence.</p></header>
    <form className="admin-token" onSubmit={(event) => { event.preventDefault(); void loadSubmissions(); }}><input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Server admin token" aria-label="Server admin token" required/><button disabled={!token || loading}>{loading ? 'Checking…' : 'Unlock admin tools'}</button></form>
    {(notice || error) && <p className={`admin-notice ${error ? 'admin-error' : ''}`} role="status">{error || notice}</p>}
    <div className="admin-columns"><section className="admin-panel"><h2><ClipboardCheck size={17}/> Pending submissions</h2><p>Approve a listing only after checking its name, address and coordinates. Approval doesn’t certify sustainability.</p>{loading && !submissions.length ? <div className="admin-empty"><LoaderCircle className="business-spin"/> Loading…</div> : submissions.length ? <div className="admin-pending-list">{submissions.map((item) => <form key={item._id} className="admin-pending-card" onSubmit={(event) => { event.preventDefault(); void approve(item._id, event.currentTarget); }}><strong>{item.name}</strong><p>{categories.find((category) => category.value === item.category)?.label} · {item.address}<br/>{item.latitude}, {item.longitude}{item.submittedBy ? ` · Submitted by ${item.submittedBy}` : ''}</p>{item.productsAndServices?.length ? <p>Services: {item.productsAndServices.join(', ')}</p> : null}{item.sustainabilityClaim && <p>Claim: “{item.sustainabilityClaim}”<br/>Evidence: {item.sustainabilityEvidence || 'Not supplied'}</p>}
          {item.sustainabilityClaim && item.sustainabilityEvidence && <label className="admin-sustainability-review"><input type="checkbox" name="verifySustainability"/> I reviewed this evidence; set score <input name="sustainabilityScore" type="number" min="0" max="100" defaultValue="50" aria-label="Verified sustainability score"/></label>}
          <button disabled={loading}><BadgeCheck size={13}/> Verify business listing</button></form>)}</div> : <div className="admin-empty">Unlock the admin tools to load pending submissions.</div>}</section>
      <section className="admin-panel"><h2><ShieldCheck size={17}/> Add a known business</h2><p>Manual admin entries appear as verified listings. Sustainability details are marked verified only when evidence and a score are provided.</p><form className="admin-manual-form" onSubmit={addManual}>
        <label>Business name<input name="name" required maxLength={120}/></label><label>Category<select name="category" defaultValue="restaurant">{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
        <label className="admin-wide">Address<input name="address" required maxLength={300}/></label><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required/></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required/></label>
        <label>Phone<input name="phone" maxLength={40}/></label><label>Website<input name="website" type="url" maxLength={300}/></label><label>Rating (0–5)<input name="rating" type="number" min="0" max="5" step="0.1"/></label><label>Review count<input name="userRatingCount" type="number" min="0" step="1"/></label><label className="admin-wide">Products / services<input name="productsAndServices" placeholder="Tea, crafts, guided tours"/></label><label className="admin-wide">Opening hours<textarea name="openingHours" rows={2} placeholder="One line per day"/></label>
        <label className="admin-wide">Sustainability detail<input name="sustainabilityClaim" maxLength={500} placeholder="Optional; leave empty if not verified"/></label><label className="admin-wide">Evidence / source<input name="sustainabilityEvidence" maxLength={500} placeholder="Required to verify the sustainability detail"/></label><label>Sustainability score<input name="sustainabilityScore" type="number" min="0" max="100" placeholder="Optional 0–100"/></label>
        <button className="button button-primary" disabled={loading || !token}>Save verified business</button>
      </form></section></div>
  </main><footer className="site-footer inner-footer"><span>© 2026 S-CADE</span><span>Community listings are reviewed before publication.</span></footer></>;
}
