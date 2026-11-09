import { Router } from 'express';
import Incident, { CATEGORIES, PATIENT_STATUSES } from '../models/Incident.js';
import User from '../models/User.js';

// Expected message: SOS|CATEGORY|PATIENT_STATUS|SEX|AGE|lat,lng|note
export function parseSosSms(text = '') {
  const [prefix, category, patientStatus, sex, age, coords, ...note] = text.trim().split('|');
  if ((prefix || '').toUpperCase() !== 'SOS') return null;
  const [lat, lng] = (coords || '').split(',').map(Number);
  return {
    category: CATEGORIES.includes(category) ? category : 'OTHER',
    patientStatus: PATIENT_STATUSES.includes(patientStatus) ? patientStatus : 'UNKNOWN',
    sex: ['M', 'F', 'OTHER'].includes(sex) ? sex : 'UNKNOWN',
    age: Number(age) || undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    note: note.join('|'),
  };
}

export default function smsRoutes(io) {
  const router = Router();

  // Point your SMS provider's incoming-message webhook here.
  router.post('/inbound', async (req, res, next) => {
    try {
      if (req.headers['x-webhook-secret'] !== process.env.SMS_WEBHOOK_SECRET)
        return res.status(401).json({ error: 'Bad secret' });
      const { from, message } = req.body || {};
      const sos = parseSosSms(message);
      if (!sos) return res.status(400).json({ error: 'Not an SOS message' });

      const reporter = from ? await User.findOne({ phone: from }) : null;
      const incident = await Incident.create({
        reporter: reporter?._id,
        patient: { sex: sos.sex, age: sos.age },
        category: sos.category,
        patientStatus: sos.patientStatus,
        location: { lat: sos.lat, lng: sos.lng, description: sos.note || `SMS from ${from || 'unknown number'}` },
        source: 'SMS',
      });
      const full = await incident.populate('reporter', 'name phone email');
      io.to('responders').emit('incident:new', full);
      res.status(201).json({ ok: true, id: incident._id });
    } catch (e) { next(e); }
  });

  return router;
}
