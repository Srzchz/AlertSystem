// Integration tests for incident routes and Socket.IO rooms (task 5.5).
// _Requirements: 4.2, 4.3, 4.4, 4.5, 4.10, 6.2, 6.3, 6.6, 7.2, 7.3, 7.4, 7.8_
//
// Runs createApp() on an ephemeral port against an in-memory MongoDB, with
// supertest for HTTP and socket.io-client (websocket transport) for sockets.
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'integration-test-secret';

const { createApp } = await import('../src/app.js');
const { default: Incident } = await import('../src/models/Incident.js');
const { default: User } = await import('../src/models/User.js');

const QUIET_MS = 300;
const DEVICE_ID = '3f2b8c1e-9a4d-4c7e-b2f1-0d6e5a7c9b13';
const OTHER_DEVICE_ID = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

let mongod;
let app;
let server;
let io;
let baseUrl;
let responder;
let responderToken;
let plainUser;
let plainToken;
let inactiveResponder;
let inactiveToken;
const openSockets = new Set();

const sign = (user, opts = { expiresIn: '7d' }) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, opts);

const validBody = (overrides = {}) => ({
  deviceId: DEVICE_ID,
  forSelf: true,
  patient: { sex: 'F', age: 19 },
  nature: 'Fell on the stairs',
  category: 'INJURY',
  patientStatus: 'IN_PAIN',
  location: { lat: 14.6, lng: 121.0, accuracy: 8, description: 'Gym entrance' },
  ...overrides,
});

// Connects a client socket; resolves on connect, rejects with the connect_error.
function connect(auth) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    openSockets.add(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => reject(err));
  });
}

// Records every payload of `event` so tests can wait for one or assert none arrived.
function record(socket, event) {
  const events = [];
  const waiters = [];
  socket.on(event, (payload) => {
    events.push(payload);
    for (const w of waiters.splice(0)) w(payload);
  });
  return {
    events,
    next(ms = 2000) {
      if (events.length) return Promise.resolve(events[0]);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms);
        waiters.push((p) => { clearTimeout(t); resolve(p); });
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app, server, io } = createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  responder = await User.create({ name: 'Nurse Joy', email: 'joy@example.com', password: 'x', phone: '09170000001', role: 'responder' });
  plainUser = await User.create({ name: 'Student Sam', email: 'sam@example.com', password: 'x', phone: '09170000002', role: 'user' });
  inactiveResponder = await User.create({ name: 'Former Nurse', email: 'former@example.com', password: 'x', role: 'responder', active: false });
  responderToken = sign(responder);
  plainToken = sign(plainUser);
  inactiveToken = sign(inactiveResponder);
});

afterEach(() => {
  for (const s of openSockets) s.disconnect();
  openSockets.clear();
});

after(async () => {
  for (const s of openSockets) s.disconnect();
  openSockets.clear();
  if (io) await new Promise((resolve) => io.close(() => resolve()));
  if (server?.listening) await new Promise((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Incident.deleteMany({});
});

describe('POST /api/incidents (anonymous app alert)', () => {
  test('valid submission returns 201 and responders receive incident:new with reporter null and deviceId', async () => {
    const responderSocket = await connect({ token: responderToken });
    const newEvents = record(responderSocket, 'incident:new');

    const res = await request(app).post('/api/incidents').send(validBody());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.source, 'APP');
    assert.equal(res.body.status, 'PENDING');
    assert.equal(res.body.reporter, null);
    assert.equal(res.body.deviceId, DEVICE_ID);
    assert.equal(res.body.forSelf, true);
    assert.equal(res.body.patient.sex, 'F');
    assert.equal(res.body.patient.age, 19);

    const payload = await newEvents.next(2000);
    assert.equal(payload._id, res.body._id);
    assert.ok('reporter' in payload);
    assert.equal(payload.reporter, null);
    assert.equal(payload.deviceId, DEVICE_ID);
    assert.equal(payload.source, 'APP');
    assert.equal(await Incident.countDocuments(), 1);
  });

  test('a device socket does not receive incident:new', async () => {
    const deviceSocket = await connect({ deviceId: DEVICE_ID });
    const deviceNew = record(deviceSocket, 'incident:new');
    const responderSocket = await connect({ token: responderToken });
    const responderNew = record(responderSocket, 'incident:new');

    const res = await request(app).post('/api/incidents').send(validBody());
    assert.equal(res.status, 201);
    await responderNew.next(2000);
    await sleep(QUIET_MS);
    assert.equal(deviceNew.events.length, 0);
  });

  const invalid = [
    ['missing Device_ID', { deviceId: undefined }, 'Device ID is missing or invalid'],
    ['non-string Device_ID', { deviceId: 12345 }, 'Device ID is missing or invalid'],
    ['operator-object Device_ID', { deviceId: { $ne: null } }, 'Device ID is missing or invalid'],
    ['whitespace Device_ID', { deviceId: '   ' }, 'Device ID is missing or invalid'],
    ['Device_ID over 128 chars', { deviceId: 'a'.repeat(129) }, 'Device ID is missing or invalid'],
    ['unknown category', { category: 'ZOMBIES' }, 'Choose an alert category'],
    ['missing location', { location: undefined }, 'Location is required'],
    ['non-numeric lat', { location: { lat: 'north', lng: 121 } }, 'Location is required'],
  ];

  for (const [name, overrides, message] of invalid) {
    test(`${name} returns 400 with "${message}" and creates nothing`, async () => {
      const responderSocket = await connect({ token: responderToken });
      const newEvents = record(responderSocket, 'incident:new');
      const before = await Incident.countDocuments();

      const res = await request(app).post('/api/incidents').send(validBody(overrides));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, message);

      assert.equal(await Incident.countDocuments(), before);
      await sleep(QUIET_MS);
      assert.equal(newEvents.events.length, 0);
    });
  }
});

describe('Responder routes keep JWT + role checks', () => {
  const routes = [
    ['GET /api/incidents', (t) => t.get('/api/incidents')],
    ['PATCH /api/incidents/:id', (t, id) => t.patch(`/api/incidents/${id}`).send({ status: 'ACKNOWLEDGED' })],
  ];

  for (const [name, call] of routes) {
    test(`${name}: no token, bad token, expired token, inactive user -> 401; user role -> 403; incidents unchanged`, async () => {
      const inc = await Incident.create(validBody());
      const expired = sign(responder, { expiresIn: -60 });
      const cases = [
        [undefined, 401, 'Not logged in'],
        ['not-a-jwt', 401, 'Session expired. Please log in again.'],
        [jwt.sign({ id: responder._id, role: 'responder' }, 'wrong-secret'), 401, 'Session expired. Please log in again.'],
        [expired, 401, 'Session expired. Please log in again.'],
        [inactiveToken, 401, 'Account unavailable'],
        [plainToken, 403, 'Not allowed'],
      ];
      for (const [token, status, error] of cases) {
        let req = call(request(app), inc._id);
        if (token) req = req.set('Authorization', `Bearer ${token}`);
        const res = await req;
        assert.equal(res.status, status, `token=${String(token).slice(0, 12)}`);
        assert.equal(res.body.error, error);
      }
      const after = await Incident.findById(inc._id).lean();
      assert.equal(after.status, 'PENDING');
      assert.equal(after.acknowledgedAt, undefined);
      assert.equal(after.handledBy, undefined);
    });
  }

  test('GET /api/incidents with responder token returns 200 with populated reporter and handledBy', async () => {
    const legacy = await Incident.create({
      reporter: plainUser._id,
      category: 'FAINTING',
      location: { lat: 1, lng: 2 },
      source: 'APP',
      status: 'ACKNOWLEDGED',
      handledBy: responder._id,
    });
    await sleep(5);
    const app1 = await Incident.create(validBody());

    const res = await request(app).get('/api/incidents').set('Authorization', `Bearer ${responderToken}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.deepEqual(res.body.map((i) => i._id), [String(app1._id), String(legacy._id)]);

    const [anon, withReporter] = res.body;
    assert.equal(anon.reporter, null);
    assert.equal(anon.deviceId, DEVICE_ID);

    assert.deepEqual(withReporter.reporter, {
      _id: String(plainUser._id), name: 'Student Sam', phone: '09170000002', email: 'sam@example.com',
    });
    assert.deepEqual(withReporter.handledBy, { _id: String(responder._id), name: 'Nurse Joy' });
    assert.equal(withReporter.deviceId, null);
    for (const key of ['category', 'patientStatus', 'status', 'location', 'source', 'createdAt', 'updatedAt']) {
      assert.ok(key in withReporter, `missing ${key}`);
    }
  });
});

describe('Sockets and incident:update', () => {
  test('a socket with no token and no deviceId is rejected with unauthorized', async () => {
    await assert.rejects(connect({}), (err) => err.message === 'unauthorized');
    await assert.rejects(connect({ deviceId: '  ' }), (err) => err.message === 'unauthorized');
    await assert.rejects(connect({ token: 'garbage' }), (err) => err.message === 'unauthorized');
  });

  test('PATCH on a Device_ID incident reaches the device socket within 2 s and the responder socket', async () => {
    const created = await request(app).post('/api/incidents').send(validBody());
    assert.equal(created.status, 201);

    const deviceSocket = await connect({ deviceId: DEVICE_ID });
    const otherDevice = await connect({ deviceId: OTHER_DEVICE_ID });
    const responderSocket = await connect({ token: responderToken });
    const deviceUpdates = record(deviceSocket, 'incident:update');
    const otherUpdates = record(otherDevice, 'incident:update');
    const responderUpdates = record(responderSocket, 'incident:update');

    const startedAt = Date.now();
    const res = await request(app)
      .patch(`/api/incidents/${created.body._id}`)
      .set('Authorization', `Bearer ${responderToken}`)
      .send({ status: 'ACKNOWLEDGED', notes: 'On it' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'ACKNOWLEDGED');
    assert.equal(res.body.reporter, null);
    assert.equal(res.body.deviceId, DEVICE_ID);
    assert.equal(res.body.handledBy.name, 'Nurse Joy');

    const devPayload = await deviceUpdates.next(2000);
    assert.ok(Date.now() - startedAt <= 2000);
    assert.equal(devPayload._id, created.body._id);
    assert.equal(devPayload.status, 'ACKNOWLEDGED');
    assert.equal(devPayload.deviceId, DEVICE_ID);

    const respPayload = await responderUpdates.next(2000);
    assert.equal(respPayload._id, created.body._id);
    assert.equal(respPayload.status, 'ACKNOWLEDGED');
    assert.equal(respPayload.reporter, null);

    await sleep(QUIET_MS);
    assert.equal(deviceUpdates.events.length, 1);
    assert.equal(otherUpdates.events.length, 0);
  });

  test('PATCH on an SMS incident without Device_ID emits nothing to device rooms', async () => {
    const sms = await Incident.create({ category: 'OTHER', source: 'SMS', location: { lat: 1, lng: 2 } });
    const deviceSocket = await connect({ deviceId: DEVICE_ID });
    const responderSocket = await connect({ token: responderToken });
    const deviceUpdates = record(deviceSocket, 'incident:update');
    const responderUpdates = record(responderSocket, 'incident:update');

    const res = await request(app)
      .patch(`/api/incidents/${sms._id}`)
      .set('Authorization', `Bearer ${responderToken}`)
      .send({ status: 'EN_ROUTE' });
    assert.equal(res.status, 200);
    assert.equal(res.body.deviceId, null);
    assert.equal(res.body.reporter, null);

    const respPayload = await responderUpdates.next(2000);
    assert.equal(respPayload._id, String(sms._id));
    await sleep(QUIET_MS);
    assert.equal(deviceUpdates.events.length, 0);
  });

  test('PATCH on a missing incident returns 404 and emits nothing', async () => {
    const deviceSocket = await connect({ deviceId: DEVICE_ID });
    const responderSocket = await connect({ token: responderToken });
    const deviceUpdates = record(deviceSocket, 'incident:update');
    const responderUpdates = record(responderSocket, 'incident:update');

    const res = await request(app)
      .patch(`/api/incidents/${new mongoose.Types.ObjectId()}`)
      .set('Authorization', `Bearer ${responderToken}`)
      .send({ status: 'ACKNOWLEDGED' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Incident not found');

    await sleep(QUIET_MS);
    assert.equal(deviceUpdates.events.length, 0);
    assert.equal(responderUpdates.events.length, 0);
  });
});
