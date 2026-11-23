import { Router } from 'express';
import Incident from '../models/Incident.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { buildAppIncident } from '../lib/incidentInput.js';
import { normalizeDeviceId } from '../lib/deviceId.js';
import { updateTargets } from '../lib/rooms.js';

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export default function incidentRoutes(io) {
  const router = Router();

  // Mobile app sends an SOS (anonymous, identified by Device_ID)
  router.post('/', wrap(async (req, res) => {
    const result = buildAppIncident(req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });

    const incident = await Incident.create(result.doc);
    const full = await incident.populate('reporter', 'name phone email');
    io.to('responders').emit('incident:new', full);
    res.status(201).json(full);
  }));

  // Incident log for one device (Device_ID sent in the X-Device-Id header)
  router.get('/mine', wrap(async (req, res) => {
    const deviceId = normalizeDeviceId(req.get('X-Device-Id'));
    if (deviceId === null) return res.status(400).json({ error: 'Device ID is required' });
    const items = await Incident.find({ deviceId }).sort({ createdAt: -1 }).limit(100);
    res.json(items);
  }));

  // Responders: all records with optional filters
  router.get('/', requireAuth, requireRole('responder', 'admin'), wrap(async (req, res) => {
    const { status, category, from, to } = req.query;
    const q = {};
    if (status) q.status = status;
    if (category) q.category = category;
    if (from || to) q.createdAt = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(to) }) };
    const items = await Incident.find(q)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('reporter', 'name phone email')
      .populate('handledBy', 'name');
    res.json(items);
  }));

  // Responders: update status / outcome / notes
  router.patch('/:id', requireAuth, requireRole('responder', 'admin'), wrap(async (req, res) => {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    const { status, outcome, notes } = req.body || {};
    if (status) {
      incident.status = status;
      if (status !== 'PENDING' && !incident.acknowledgedAt) {
        incident.acknowledgedAt = new Date();
        incident.responseTimeSec = Math.round((incident.acknowledgedAt - incident.createdAt) / 1000);
        incident.handledBy = req.user._id;
      }
      if (status === 'RESOLVED') incident.resolvedAt = new Date();
    }
    if (outcome !== undefined) incident.outcome = outcome;
    if (notes !== undefined) incident.notes = notes;
    await incident.save();
    const full = await incident.populate([
      { path: 'reporter', select: 'name phone email' },
      { path: 'handledBy', select: 'name' },
    ]);
    // One emit per room, as before (responders, then user:<id>), plus device:<id>
    for (const room of updateTargets(full)) io.to(room).emit('incident:update', full);
    res.json(full);
  }));

  return router;
}
