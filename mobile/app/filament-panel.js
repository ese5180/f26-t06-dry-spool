"use client";

import { useId, useState } from 'react';
import { materials } from '../lib/filament.mjs';
import { storageGuidance, storageSource } from '../lib/storage.mjs';
import { api } from './client-api';

export default function FilamentPanel({box, connected, reload}) {
  const materialId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const incoming = box.spool;
  const profile = saved && (!incoming?.updatedMs || saved.updatedMs > incoming.updatedMs) ? saved : incoming;
  const manual = profile?.source === 'manual' && profile?.version === 1;
  const spool = manual || connected ? profile : null;
  const guidance = storageGuidance(spool?.material, connected ? box.humidity : null);
  const custom = draft && !materials.includes(draft.material);

  function edit() {
    setDraft({material: spool?.material || 'PLA', color: spool?.color || '',
      colorHex: spool?.colorHex || '', brand: spool?.brand || ''});
    setError('');
    setMessage('');
    setEditing(true);
  }
  function field(name, value) {setDraft(previous => ({...previous, [name]: value}));}
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const {payload} = await api('/api/devices/' + encodeURIComponent(box.serial) + '/filament',
        {profile: draft}, undefined, 'PUT');
      setSaved(payload.profile);
      setEditing(false);
      setMessage('Filament profile saved.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="box spool-panel" aria-label="Filament information">
    <div className="section-title"><h3>Filament</h3>
      {!editing && !box.preview && <button type="button" className="edit-profile" onClick={edit}>Edit filament</button>}
    </div>
    {editing ? <form className="stack filament-editor" aria-label="Edit filament" onSubmit={save}>
      <p className="supporting">Set the filament in {box.label}. These details are saved to this box’s profile.</p>
      <div className="material-field"><label htmlFor={materialId}>Material</label><select id={materialId} autoFocus value={custom ? 'custom' : draft.material}
        disabled={saving} onChange={event => field('material', event.target.value === 'custom' ? '' : event.target.value)}>
        {materials.map(material => <option key={material}>{material}</option>)}
        <option value="custom">Other material</option>
      </select></div>
      {custom && <label>Material name<input value={draft.material} maxLength={40} required disabled={saving}
        placeholder="e.g. PA11-CF" onChange={event => field('material', event.target.value)} /></label>}
      <label>Color name<input value={draft.color} maxLength={80} required disabled={saving}
        placeholder="e.g. Orange, Galaxy Black" onChange={event => field('color', event.target.value)} /></label>
      <div className="color-choice">
        <label>Color swatch <span className="field-hint">Optional</span>
          <input type="color" aria-label="Color swatch" value={draft.colorHex || '#FF823B'} disabled={saving}
            onChange={event => field('colorHex', event.target.value)} />
        </label>
        <span>{draft.colorHex || 'Not set'}</span>
        {draft.colorHex && <button type="button" className="textbutton" disabled={saving}
          onClick={() => field('colorHex', '')}>Remove swatch</button>}
      </div>
      <label>Brand <span className="field-hint">Optional</span><input value={draft.brand} maxLength={80} disabled={saving}
        placeholder="e.g. Prusament" onChange={event => field('brand', event.target.value)} /></label>
      <p className="source-note">Manual profile only. NFC tag reading and writing will be available after reader integration.</p>
      {error && <p className="profile-error" role="alert">{error}</p>}
      <div className="actions"><button className="primary-action" disabled={saving}>{saving ? 'Saving…' : 'Save filament'}</button>
        <button type="button" className="textbutton" disabled={saving} onClick={() => {setEditing(false); setError('');}}>Cancel</button></div>
    </form> : <>
      <p className="profile-source">{spool?.source === 'openprinttag' ? 'OpenPrintTag' : spool ? 'Manual profile' : 'No profile'}</p>
      {spool ? <>
        <div className="filament-profile"><strong>{spool.material || 'Material unknown'}</strong>
          <span className="filament-color">{spool.colorHex && <i className="color-swatch" style={{backgroundColor: spool.colorHex}} />}{spool.color || 'Color not set'}</span>
          {spool.brand && <span>{spool.brand}</span>}</div>
        {guidance ? <div className={'storage-advice' + (guidance.above ? ' alert' : '')}>
          <strong>Storage guide: below {guidance.max}% RH</strong>
          <span>{guidance.above === null ? 'Waiting for a fresh humidity reading.' : guidance.above ? 'Above the recommended limit.' : 'Within the recommended limit.'} {guidance.note || ''}</span>
        </div> : <p className="supporting">No verified storage limit for this material yet.</p>}
      </> : <p className="supporting">{box.preview ? 'This preview uses simulated readings.' : 'Add your filament’s material and color to keep track of this spool.'}</p>}
      {guidance && <p className="source-note">Storage guidance from <a href={storageSource} target="_blank" rel="noopener noreferrer">Prusa ↗</a></p>}
      {manual && <p className="source-note">Set manually · not read from or written to a tag.</p>}
      {message && <p className="profile-saved" role="status">{message}</p>}
    </>}
  </section>;
}
