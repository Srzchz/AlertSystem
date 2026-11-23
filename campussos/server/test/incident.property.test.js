// Feature: mobile-remove-auth, Property 14: Incident payload shape
// **Validates: Requirements 4.3, 7.7, 8.3**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import mongoose from 'mongoose';
import Incident, { CATEGORIES, PATIENT_STATUSES, STATUSES } from '../src/models/Incident.js';
import User from '../src/models/User.js';

// Device_IDs are generated already trimmed so the stored value equals the input
// for both `new Incident(...)` (applies the trim setter) and `Incident.hydrate(...)`.
const deviceIdArb = fc.oneof(
  fc.uuid({ version: 4 }),
  fc
    .string({ minLength: 1, maxLength: 128 })
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

// Device_ID variants: stored string, explicit null, absent.
const deviceArb = fc.oneof(
  deviceIdArb.map((d) => ({ present: true, value: d, expected: d })),
  fc.constant({ present: true, value: null, expected: null }),
  fc.constant({ present: false, expected: null }),
);

// Reporter variants:
// - 'none':      no reporter field (app alerts, unmatched SMS)
// - 'null':      reporter stored as null
// - 'populated': reporter populated with an existing User document
// - 'deleted':   reporter ObjectId whose User no longer exists (populate yields null)
const reporterArb = fc.constantFrom('none', 'null', 'populated', 'deleted');

const baseArb = fc.record({
  source: fc.constantFrom('APP', 'SMS'),
  category: fc.constantFrom(...CATEGORIES),
  patientStatus: fc.constantFrom(...PATIENT_STATUSES),
  status: fc.constantFrom(...STATUSES),
  forSelf: fc.boolean(),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
  hydrated: fc.boolean(), // true: loaded-from-DB document; false: freshly constructed
});

function buildDoc(base, dev, reporterKind) {
  const raw = {
    _id: new mongoose.Types.ObjectId(),
    source: base.source,
    category: base.category,
    patientStatus: base.patientStatus,
    status: base.status,
    forSelf: base.forSelf,
    location: { lat: base.lat, lng: base.lng },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (dev.present) raw.deviceId = dev.value;
  if (reporterKind === 'null') raw.reporter = null;

  const refId = new mongoose.Types.ObjectId();
  if (reporterKind === 'populated' || reporterKind === 'deleted') raw.reporter = refId;

  const doc = base.hydrated ? Incident.hydrate(raw) : new Incident(raw);

  let user = null;
  if (reporterKind === 'populated') {
    user = new User({ _id: refId, name: 'Reporter', email: 'r@example.com', password: 'x', phone: '09170000000' });
    doc.reporter = user; // Mongoose marks the path as populated when assigned a User document
  } else if (reporterKind === 'deleted') {
    // What populate() leaves behind when the referenced User is gone.
    doc.populated('reporter', refId);
    doc.reporter = null;
  }
  return { doc, user };
}

test('Property 14: Incident payload shape', () => {
  fc.assert(
    fc.property(baseArb, deviceArb, reporterArb, (base, dev, reporterKind) => {
      const { doc, user } = buildDoc(base, dev, reporterKind);
      const json = doc.toJSON();

      // deviceId key always present: stored value or null.
      assert.ok(Object.prototype.hasOwnProperty.call(json, 'deviceId'));
      assert.equal(json.deviceId, dev.expected);

      // reporter key always present; null whenever no User is linked.
      assert.ok(Object.prototype.hasOwnProperty.call(json, 'reporter'));
      if (reporterKind === 'populated') {
        assert.notEqual(json.reporter, null);
        assert.equal(String(json.reporter._id), String(user._id));
        assert.equal(json.reporter.name, 'Reporter');
      } else {
        assert.equal(json.reporter, null);
      }

      // Other fields pass through unchanged.
      assert.equal(json.source, base.source);
      assert.equal(json.category, base.category);
      assert.equal(json.status, base.status);

      // Socket.IO serializes via JSON; the shape must survive a JSON round trip.
      const wire = JSON.parse(JSON.stringify(doc));
      assert.ok('deviceId' in wire && 'reporter' in wire);
      assert.equal(wire.deviceId, dev.expected);
      if (reporterKind !== 'populated') assert.equal(wire.reporter, null);
    }),
    { numRuns: 200 },
  );
});
