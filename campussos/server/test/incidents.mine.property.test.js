// Feature: mobile-remove-auth, Property 9: Incident log returns only that device's incidents
// **Validates: Requirements 5.2**
//
// DB-backed property: runs against createApp() with a self-contained
// mongodb-memory-server. 30 runs to keep runtime reasonable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import Incident, { CATEGORIES, STATUSES } from '../src/models/Incident.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

let mongod;
let app;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Incident.init(); // build indexes, including { deviceId: 1, createdAt: -1 }
  ({ app } = createApp());
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

// Pool includes values that differ only in letter case.
const POOL = [
  'device-abc',
  'DEVICE-ABC',
  'Device-Abc',
  '3f2b8c1e-9a4d-4c7e-b2f1-0d6e5a7c9b13',
  '3F2B8C1E-9A4D-4C7E-B2F1-0D6E5A7C9B13',
];
const poolArb = fc.constantFrom(...POOL);

// undefined = SMS / legacy incident with no deviceId
const storedDeviceArb = fc.option(poolArb, { nil: undefined, freq: 4 });

const itemArb = (devArb) =>
  fc.record({
    deviceId: devArb,
    t: fc.integer({ min: 0, max: 10_000_000 }), // seconds offset; unique per run
    category: fc.constantFrom(...CATEGORIES),
    status: fc.constantFrom(...STATUSES),
  });

// Small mixed sets, plus large sets (>100) concentrated on one device so the
// 100-item cap is exercised.
const itemsArb = fc.oneof(
  fc.uniqueArray(itemArb(storedDeviceArb), { selector: (i) => i.t, maxLength: 60 }),
  fc.uniqueArray(
    itemArb(fc.oneof({ weight: 6, arbitrary: fc.constant(POOL[0]) }, { weight: 1, arbitrary: storedDeviceArb })),
    { selector: (i) => i.t, minLength: 110, maxLength: 180 },
  ),
);

// Query value: from the pool (biased to the heavy device) or one never stored.
const queryArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant(POOL[0]) },
  { weight: 3, arbitrary: poolArb },
  { weight: 1, arbitrary: fc.constant('never-stored-device') },
);

const BASE = Date.UTC(2024, 0, 1);

test('Property 9: Incident log returns only that device\'s incidents', async () => {
  await fc.assert(
    fc.asyncProperty(itemsArb, queryArb, async (items, d) => {
      await Incident.deleteMany({});

      const docs = items.map((it) => {
        const createdAt = new Date(BASE + it.t * 1000);
        const doc = {
          _id: new mongoose.Types.ObjectId(),
          category: it.category,
          status: it.status,
          source: it.deviceId === undefined ? 'SMS' : 'APP',
          forSelf: true,
          location: { lat: 14.6, lng: 121.0 },
          createdAt,
          updatedAt: createdAt,
        };
        if (it.deviceId !== undefined) doc.deviceId = it.deviceId;
        return doc;
      });
      // Raw collection insert so the explicit createdAt values are kept as-is.
      if (docs.length) await Incident.collection.insertMany(docs);

      const expected = docs
        .filter((doc) => doc.deviceId === d)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 100)
        .map((doc) => String(doc._id));

      const res = await request(app).get('/api/incidents/mine').set('X-Device-Id', d);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length <= 100);

      for (const inc of res.body) assert.equal(inc.deviceId, d); // case-sensitive match only
      assert.deepEqual(res.body.map((inc) => String(inc._id)), expected);

      const times = res.body.map((inc) => Date.parse(inc.createdAt));
      for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] > times[i], 'newest first');
    }),
    { numRuns: 30 },
  );
});
