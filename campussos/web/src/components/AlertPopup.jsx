import React from 'react';
import { CATEGORY_LABELS, PATIENT_STATUS_LABELS, fmtTime } from '../labels.js';

export default function AlertPopup({ incident, onAcknowledge, onDismiss }) {
  const p = incident.patient || {};
  const loc = incident.location || {};
  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="alert-title">
      <div className="popup">
        <h2 id="alert-title">Emergency alert: {CATEGORY_LABELS[incident.category]}</h2>
        <div className="meta">{fmtTime(incident.createdAt)} via {incident.source === 'SMS' ? 'SMS' : 'app'}</div>
        <dl>
          <dt>Patient status</dt><dd>{PATIENT_STATUS_LABELS[incident.patientStatus]}</dd>
          <dt>Patient</dt><dd>{[p.name, p.sex !== 'UNKNOWN' && p.sex, p.age && `${p.age} yrs`].filter(Boolean).join(', ') || 'Unknown'}</dd>
          <dt>Nature</dt><dd>{incident.nature || '-'}</dd>
          <dt>Reported by</dt><dd>{incident.reporter?.name || 'Unregistered number'}{incident.forSelf === false && ' (for someone else)'}</dd>
          <dt>Contact</dt><dd>{incident.reporter?.phone || '-'}</dd>
          <dt>Location</dt><dd>{loc.description || (loc.lat != null ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'No location')}</dd>
        </dl>
        <div className="actions">
          <button className="btn" onClick={onDismiss}>Silence alarm</button>
          <button className="btn danger" onClick={onAcknowledge}>Acknowledge and respond</button>
        </div>
      </div>
    </div>
  );
}
