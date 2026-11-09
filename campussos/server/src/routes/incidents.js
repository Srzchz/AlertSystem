import { Router } from 'express';
import Incident, { CATEGORIES } from '../models/Incident.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export default function incidentRoutes(io) {
  const router = Router();
  router.use(requireAuth);

  // User sends an SOS
  router.post('/', wrap(async (req, res) => {
    const { forSelf, patient, nature, category, patientStatus, location } = req.body || {};
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose an alert category' });
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number')
      return res.status(400).json({ error: 'Location is required' });

    const incident = await Incident.create({
      reporter: req.user._id,
      forSelf: forSelf !== false,
      patient: forSelf === false ? patient : { ...(patient || {}), name: req.user.name },
      nature, category, patientStatus, location, source: 'APP',
    });
    const full = await incident.populate('reporter', 'name phone email');
    io.to('responders').emit('incident:new', full);
    res.status(201).json(full);
  }));

  // The current user's own incident log
  router.get('/mine', wrap(async (req, res) => {
    const items = await Incident.find({ reporter: req.user._id }).sort({ createdAt: -1 }).limit(100);
    res.json(items);
  }));

  // Responders: all records with optional filters
  router.get('/', requireRole('responder', 'admin'), wrap(async (req, res) => {
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
  router.patch('/:id', requireRole('responder', 'admin'), wrap(async (req, res) => {
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
    io.to('responders').emit('incident:update', full);
    if (incident.reporter) io.to(`user:${full.reporter._id}`).emit('incident:update', full);
    res.json(full);
  }));

  return router;
}
