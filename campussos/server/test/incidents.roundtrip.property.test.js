// Feature: mobile-remove-auth, Property 10: Create/list round trip
// **Validates: Requirements 5.3**
//
// DB-backed property: runs 50 iterations against createApp() with an in-memory MongoDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import Incident, { CATEGORIES, PATIENT_STATUSES } from '../src/models/Incident.js';

process.env.JWT_SECRET ||= 'test-secret';

let mongod;
let app;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app } = createApp());
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

// Device_ID: a 1-128 char core of header-safe printable ASCII (0x21-0x7E),
// optionally padded with spaces/tabs that the server trims on both routes.
const printable = fc.integer({ min: 0x21, max: 0x7e }).map((c) => String.fromCharCode(c));
const coreId = fc.oneof(
  fc.uuid({ version: 4 }),
  fc.array(printable, { minLength: 1, maxLength: 128 }).map((cs) => cs.join('')),
);
const padding = fc.array(fc.constantFrom(' ', '\t'), { maxLength: 3 }).map((cs) => cs.join(''));
const deviceIdArb = fc.tuple(padding, coreId, padding).map(([pre, core, post]) => `${pre}${core}${post}`);

const locationArb = fc.record(
  {
    lat: fc.double({ noNaN: true, min: -90, max: 90 }),
    lng: fc.double({ noNaN: true, min: -180, max: 180 }),
    accuracy: fc.double({ noNaN: true, min: 0, max: 10000 }),
    description: fc.string({ maxLength: 50 }),
  },
  { requiredKeys: ['lat', 'lng'] },
);

const patientArb = fc.record(
  {
    name: fc.string({ maxLength: 40 }),
    sex: fc.constantFrom('M', 'F', 'OTHER', 'UNKNOWN'),
    age: fc.integer({ min: 0, max: 120 }),
  },
  { requiredKeys: [] },
);

const submissionArb = fc.record(
  {
    deviceId: deviceIdArb,
    category: fc.constantFrom(...CATEGORIES),
    location: locationArb,
    forSelf: fc.boolean(),
    patient: patientArb,
    nature: fc.string({ maxLength: 80 }),
    patientStatus: fc.constantFrom(...PATIENT_STATUSES),
  },
  { requiredKeys: ['deviceId', 'category', 'location'] },
);

test('Property 10: Create/list round trip', async () => {
  await fc.assert(
    fc.asyncProperty(submissionArb, async (body) => {
      await Incident.deleteMany({});

      const created = await request(app).post('/api/incidents').send(body);
      assert.equal(created.status, 201, `POST failed: ${JSON.stringify(created.body)}`);

      const listed = await request(app).get('/api/incidents/mine').set('X-Device-Id', body.deviceId);
      assert.equal(listed.status, 200, `GET failed: ${JSON.stringify(listed.body)}`);
      assert.ok(Array.isArray(listed.body));

      const match = listed.body.find((i) => i._id === created.body._id);
      assert.ok(match, 'created incident missing from /mine');
      assert.equal(match.category, created.body.category);
      assert.equal(match.category, body.category);
      assert.equal(match.status, created.body.status);
    }),
    { numRuns: 50 },
  );
});
