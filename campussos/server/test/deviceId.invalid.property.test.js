// Feature: mobile-remove-auth, Property 5: Invalid Device_IDs are rejected
// **Validates: Requirements 4.4, 5.4**
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { DEVICE_ID_MAX, normalizeDeviceId } from '../src/lib/deviceId.js';
import { buildAppIncident } from '../src/lib/incidentInput.js';
import Incident from '../src/models/Incident.js';
import { createApp } from '../src/app.js';

process.env.JWT_SECRET ||= 'test-secret';

// HTTP parts run fewer iterations because each run is a real request against MongoDB.
const PURE_RUNS = 300;
const HTTP_RUNS = 50;

// ---------- generators ----------

// Whitespace that String.prototype.trim removes (ASCII and Unicode).
const wsChar = fc.constantFrom(' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u2003', '\u3000', '\ufeff');
const wsOnly = fc.array(wsChar, { minLength: 0, maxLength: 10 }).map((a) => a.join(''));

// Strings whose trimmed length exceeds DEVICE_ID_MAX.
const tooLong = fc
  .tuple(wsOnly, fc.string({ minLength: DEVICE_ID_MAX + 1, maxLength: 400 }), wsOnly)
  .filter(([, s]) => s.trim().length > DEVICE_ID_MAX)
  .map(([a, s, b]) => a + s + b);

const invalidStrings = fc.oneof(wsOnly, tooLong);

// Non-string values a JSON body can carry, including Mongo operator objects.
const jsonNonStrings = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
  fc.constant({ $ne: null }),
  fc.constant({ $gt: '' }),
  fc.object(),
  fc.array(fc.string()),
  fc.uuid({ version: 4 }).map((u) => [u]),
);

const nonStrings = fc.oneof(
  jsonNonStrings,
  fc.constant(undefined),
  fc.anything().filter((v) => typeof v !== 'string'),
);

const invalidAny = fc.oneof(nonStrings, invalidStrings);

// Valid strings: 1..128 chars after trimming, with optional surrounding whitespace.
const validStrings = fc
  .tuple(
    wsOnly,
    fc.oneof(fc.uuid({ version: 4 }), fc.string({ minLength: 1, maxLength: DEVICE_ID_MAX })),
    wsOnly,
  )
  .map(([a, s, b]) => a + s + b)
  .filter((s) => s.trim().length >= 1 && s.trim().length <= DEVICE_ID_MAX);

// Header-safe values (visible ASCII plus space/tab padding).
const headerWs = fc.array(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 6 }).map((a) => a.join(''));
const visibleAscii = fc.integer({ min: 0x21, max: 0x7e }).map((c) => String.fromCharCode(c));
const headerTooLong = fc
  .tuple(headerWs, fc.array(visibleAscii, { minLength: DEVICE_ID_MAX + 1, maxLength: 400 }), headerWs)
  .map(([a, chars, b]) => a + chars.join('') + b);
const invalidHeader = fc.oneof(
  fc.constant({ missing: true }),
  headerWs.map((v) => ({ value: v })), // empty or whitespace-only
  headerTooLong.map((v) => ({ value: v })),
);

// JSON body values for POST: non-strings, blank/too-long strings, or omitted.
const invalidJsonDeviceId = fc.oneof(
  jsonNonStrings.map((v) => ({ value: v })),
  invalidStrings.map((v) => ({ value: v })),
  fc.constant({ missing: true }),
);

const validPostRest = {
  category: 'INJURY',
  patientStatus: 'IN_PAIN',
  forSelf: true,
  patient: { sex: 'F', age: 19 },
  location: { lat: 14.6, lng: 121.0 },
};

// ---------- pure parts ----------

test('Property 5: normalizeDeviceId returns null for invalid values', () => {
  fc.assert(
    fc.property(invalidAny, (v) => {
      assert.equal(normalizeDeviceId(v), null);
    }),
    { numRuns: PURE_RUNS },
  );
});

test('Property 5: normalizeDeviceId returns the trimmed string for valid values', () => {
  fc.assert(
    fc.property(validStrings, (s) => {
      assert.equal(normalizeDeviceId(s), s.trim());
    }),
    { numRuns: PURE_RUNS },
  );
});

test('Property 5: buildAppIncident rejects invalid Device_IDs', () => {
  fc.assert(
    fc.property(fc.oneof(invalidAny.map((v) => ({ value: v })), fc.constant({ missing: true })), (d) => {
      const body = { ...validPostRest };
      if (!d.missing) body.deviceId = d.value;
      assert.deepEqual(buildAppIncident(body), { ok: false, error: 'Device ID is missing or invalid' });
    }),
    { numRuns: PURE_RUNS },
  );
});

// ---------- HTTP parts ----------

let mongod;
let app;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Incident.init();
  ({ app } = createApp());
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('Property 5: GET /api/incidents/mine rejects invalid X-Device-Id with 400', async () => {
  // Seed one incident so a wrongly accepted request could leak data.
  await Incident.deleteMany({});
  await Incident.create({ ...validPostRest, deviceId: 'seed-device', source: 'APP', status: 'PENDING' });

  await fc.assert(
    fc.asyncProperty(invalidHeader, async (h) => {
      let req = request(app).get('/api/incidents/mine');
      if (!h.missing) req = req.set('X-Device-Id', h.value);
      const res = await req;
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: 'Device ID is required' });
    }),
    { numRuns: HTTP_RUNS },
  );
});

test('Property 5: POST /api/incidents rejects invalid deviceId with 400 and creates nothing', async () => {
  await Incident.deleteMany({});

  await fc.assert(
    fc.asyncProperty(invalidJsonDeviceId, async (d) => {
      const body = { ...validPostRest };
      if (!d.missing) body.deviceId = d.value;
      const before = await Incident.countDocuments({});
      const res = await request(app).post('/api/incidents').send(body);
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: 'Device ID is missing or invalid' });
      assert.equal(await Incident.countDocuments({}), before);
    }),
    { numRuns: HTTP_RUNS },
  );

  assert.equal(await Incident.countDocuments({}), 0);
});
