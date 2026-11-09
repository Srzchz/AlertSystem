import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API, api, getToken } from '../api.js';
import { startAlarm, stopAlarm, unlockAlarm } from '../alarm.js';
import { CATEGORY_LABELS, PATIENT_STATUS_LABELS, STATUS_LABELS, fmtTime } from '../labels.js';
import AlertPopup from '../components/AlertPopup.jsx';
import MapView from '../components/MapView.jsx';

const NEXT_STATUS = { PENDING: 'ACKNOWLEDGED', ACKNOWLEDGED: 'EN_ROUTE', EN_ROUTE: 'ON_SCENE', ON_SCENE: 'RESOLVED' };

export default function Dashboard() {
  const [incidents, setIncidents] = useState([]);
  const [popup, setPopup] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [alarmReady, setAlarmReady] = useState(false);
  const [error, setError] = useState('');
  const alarmReadyRef = useRef(false);

  const upsert = useCallback((inc) => {
    setIncidents((prev) => [inc, ...prev.filter((i) => i._id !== inc._id)]);
  }, []);

  useEffect(() => {
    api('/incidents').then(setIncidents).catch((e) => setError(e.message));
    const socket = io(API, { auth: { token: getToken() } });
    socket.on('incident:new', (inc) => {
      upsert(inc);
      setPopup(inc);
      setSelectedId(inc._id);
      if (alarmReadyRef.current) startAlarm();
    });
    socket.on('incident:update', upsert);
    socket.on('connect_error', () => setError('Live connection lost. Reconnecting...'));
    socket.on('connect', () => setError(''));
    return () => { socket.disconnect(); stopAlarm(); };
  }, [upsert]);

  function enableAlarm() {
    const ok = unlockAlarm();
    alarmReadyRef.current = ok;
    setAlarmReady(ok);
  }

  async function setStatus(id, status) {
    try {
      const updated = await api(`/incidents/${id}`, { method: 'PATCH', body: { status } });
      upsert(updated);
    } catch (e) { setError(e.message); }
  }

  async function acknowledge() {
    stopAlarm();
    const id = popup._id;
    setPopup(null);
    await setStatus(id, 'ACKNOWLEDGED');
  }

  const active = incidents.filter((i) => !['RESOLVED', 'CANCELLED'].includes(i.status));

  return (
    <>
      {!alarmReady && (
        <div className="banner">
          Alarm sound is off until you turn it on.
          <button className="btn" onClick={enableAlarm}>Enable alarm sound</button>
        </div>
      )}
      <div className="page">
        <h1>Live alerts ({active.length})</h1>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dash">
          <div className="side">
            {active.length === 0 && <div className="empty">No active alerts. New SOS messages appear here instantly.</div>}
            {active.map((i) => (
              <div key={i._id} className={`card ${i.status === 'PENDING' ? 'pending' : ''} ${selectedId === i._id ? 'selected' : ''}`}
                   onClick={() => setSelectedId(i._id)}>
                <h3>{CATEGORY_LABELS[i.category]} <span className={`pill ${i.status}`}>{STATUS_LABELS[i.status]}</span></h3>
                <div className="meta">{fmtTime(i.createdAt)} | {PATIENT_STATUS_LABELS[i.patientStatus]}</div>
                <div>{i.location?.description || (i.location?.lat != null ? 'Pinned on map' : 'No location')}</div>
                {NEXT_STATUS[i.status] && (
                  <p style={{ margin: '8px 0 0' }}>
                    <button className="btn primary" onClick={(e) => { e.stopPropagation(); setStatus(i._id, NEXT_STATUS[i.status]); }}>
                      Mark {STATUS_LABELS[NEXT_STATUS[i.status]].toLowerCase()}
                    </button>
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="map-wrap">
            <MapView incidents={active} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </div>
      </div>
      {popup && <AlertPopup incident={popup} onAcknowledge={acknowledge} onDismiss={() => { stopAlarm(); setPopup(null); }} />}
    </>
  );
}
