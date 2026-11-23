import React, { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import { CATEGORY_LABELS, PATIENT_STATUS_LABELS, STATUS_LABELS, fmtDuration, fmtTime } from '../labels.js';

function Detail({ incident, onSaved }) {
  const [status, setStatus] = useState(incident.status);
  const [outcome, setOutcome] = useState(incident.outcome || '');
  const [notes, setNotes] = useState(incident.notes || '');
  const [msg, setMsg] = useState('');

  async function save() {
    try {
      const updated = await api(`/incidents/${incident._id}`, { method: 'PATCH', body: { status, outcome, notes } });
      onSaved(updated);
      setMsg('Saved');
    } catch (e) { setMsg(e.message); }
  }
  const p = incident.patient || {};
  return (
    <div className="detail">
      <div>
        <label>Patient</label>
        {[p.name, p.sex !== 'UNKNOWN' && p.sex, p.age && `${p.age} yrs`].filter(Boolean).join(', ') || 'Unknown'}
        <br /><label>Nature of accident</label>{incident.nature || '-'}
      </div>
      <div>
        <label htmlFor={`s${incident._id}`}>Status</label>
        <select id={`s${incident._id}`} value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label htmlFor={`o${incident._id}`}>Outcome</label>
        <textarea id={`o${incident._id}`} rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Treated at infirmary, sent home" />
      </div>
      <div>
        <label htmlFor={`n${incident._id}`}>Notes</label>
        <textarea id={`n${incident._id}`} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn primary" onClick={save}>Save changes</button> <span className="meta">{msg}</span>
      </div>
    </div>
  );
}

export default function Records() {
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ status: '', category: '' });
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    api(`/incidents${q ? `?${q}` : ''}`).then(setItems).catch((e) => setError(e.message));
  }, [filters]);

  const replace = (u) => setItems((prev) => prev.map((i) => (i._id === u._id ? u : i)));

  return (
    <div className="page">
      <div className="page-head"><div><h1>Incident and patient records</h1><div className="meta">Click a row to update status, outcome, and notes.</div></div></div>
      <div className="toolbar">
        <select aria-label="Filter by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Filter by category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="meta">{items.length} records</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {items.length === 0 ? (
        <div className="empty">No incidents match these filters.</div>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Patient</th><th>Category</th><th>Patient status</th><th>Response time</th><th>Status</th><th>Outcome</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <Fragment key={i._id}>
                <tr className="clickable" onClick={() => setOpenId(openId === i._id ? null : i._id)}>
                  <td>{fmtTime(i.createdAt)}</td>
                  <td>{i.patient?.name || i.reporter?.name || 'Unknown'}</td>
                  <td>{CATEGORY_LABELS[i.category]}</td>
                  <td>{PATIENT_STATUS_LABELS[i.patientStatus]}</td>
                  <td>{fmtDuration(i.responseTimeSec)}</td>
                  <td><span className={`pill ${i.status}`}>{STATUS_LABELS[i.status]}</span></td>
                  <td>{i.outcome || '-'}</td>
                </tr>
                {openId === i._id && <tr><td colSpan={7}><Detail incident={i} onSaved={replace} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
