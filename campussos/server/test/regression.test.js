// Regression tests for behavior that must stay unchanged by mobile-remove-auth:
// auth routes, legacy incidents on responder endpoints, the SMS webhook, and stored data.
// _Requirements: 7.1, 8.1, 8.2, 8.3, 8.4, 8.5_
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'regression-test-secret';
process.env.SMS_WEBHOOK_SECRET = 'regression-sms-secret';

const { createApp } = await import('../src/app.js');
const { default: Incident } = await import('../src/models/Incident.js');
const { default: User } = await import('../src/models/User.js');
const { signToken } = await import('../src/middleware/auth.js');

let mongod;
let app;
let server;
let io;
let port;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ({ app, server, io } = createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => io.close(() => resolve()));
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Incident.deleteMany({});
  await User.deleteMany({});
});

async function makeUser({ name = 'Test User', email, password = 'password123', phone, role = 'user', active = true }) {
  return User.create({ name, email, phone, role, active, password: await bcrypt.hash(password, 10) });
}

const bearer = (user) => `Bearer ${signToken(user)}`;

// ---------------------------------------------------------------- Auth (7.1)
describe('auth routes (Requirement 7.1)', () => {
  test('login with matching email and password returns a 7-day JWT and the public user', async () => {
    const u = await makeUser({ name: 'Nurse Joy', email: 'joy@campus.edu', phone: '+639170000001', role: 'responder' });
    const res = await request(app).post('/api/auth/login').send({ email: 'JOY@campus.edu', password: 'password123' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.user, {
      id: u._id.toString(), name: 'Nurse Joy', email: 'joy@campus.edu', phone: '+639170000001', role: 'responder',
    });
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    assert.equal(payload.id, u._id.toString());
    assert.equal(payload.role, 'responder');
    assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);
  });

  test('login with a wrong password or unknown email returns 401', async () => {
    await makeUser({ email: 'a@campus.edu' });
    const wrongPw = await request(app).post('/api/auth/login').send({ email: 'a@campus.edu', password: 'nope-nope' });
    assert.equal(wrongPw.status, 401);
    assert.equal(wrongPw.body.error, 'Wrong email or password');
    const wrongEmail = await request(app).post('/api/auth/login').send({ email: 'b@campus.edu', password: 'password123' });
    assert.equal(wrongEmail.status, 401);
    assert.equal(wrongEmail.body.error, 'Wrong email or password');
  });

  test('register always creates a normal user, even if a role is requested', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Student', email: 'stud@campus.edu', password: 'password123', phone: '+639170000002', role: 'admin',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'user');
    assert.ok(res.body.token);
    const stored = await User.findOne({ email: 'stud@campus.edu' });
    assert.equal(stored.role, 'user');
  });

  test('/me returns the current user for a valid JWT', async () => {
    const u = await makeUser({ name: 'Me', email: 'me@campus.edu', phone: '123' });
    const res = await request(app).get('/api/auth/me').set('Authorization', bearer(u));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.user, { id: u._id.toString(), name: 'Me', email: 'me@campus.edu', phone: '123', role: 'user' });
  });
});

// ------------------------------------------------ Legacy incidents (8.1, 8.3)
describe('legacy incidents on responder endpoints (Requirements 8.1, 8.3)', () => {
  let responder;
  let reporter;

  beforeEach(async () => {
    responder = await makeUser({ name: 'Resp', email: 'resp@campus.edu', role: 'responder' });
    reporter = await makeUser({ name: 'Old Reporter', email: 'old@campus.edu', phone: '+639171111111' });
  });

  // Legacy docs are written through the raw collection, as they existed before the change (no deviceId).
  const legacyDoc = (overrides = {}) => ({
    reporter: reporter._id,
    forSelf: true,
    patient: { name: 'Old Reporter', sex: 'F', age: 20 },
    category: 'INJURY',
    patientStatus: 'IN_PAIN',
    location: { lat: 14.6, lng: 121.0, accuracy: 5, description: 'Library' },
    source: 'APP',
    status: 'RESOLVED',
    responseTimeSec: 42,
    outcome: 'Treated',
    notes: 'Ice pack',
    __v: 0,
    ...overrides,
  });

  test('returns legacy incidents newest first with stored fields and a populated reporter', async () => {
    const base = Date.parse('2024-01-01T00:00:00Z');
    const docs = [0, 1, 2].map((i) => legacyDoc({
      createdAt: new Date(base + i * 60000),
      updatedAt: new Date(base + i * 60000 + 1000),
      acknowledgedAt: new Date(base + i * 60000 + 42000),
      notes: `note ${i}`,
    }));
    await Incident.collection.insertMany(docs);
    const stored = await Incident.collection.find({}).sort({ createdAt: -1 }).toArray();

    const res = await request(app).get('/api/incidents').set('Authorization', bearer(responder));
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
    assert.deepEqual(res.body.map((i) => i._id), stored.map((d) => d._id.toString()));

    for (const [idx, item] of res.body.entries()) {
      const s = stored[idx];
      assert.equal(item.category, s.category);
      assert.equal(item.patientStatus, s.patientStatus);
      assert.equal(item.status, s.status);
      assert.deepEqual(item.location, s.location);
      assert.equal(item.source, s.source);
      assert.equal(item.createdAt, s.createdAt.toISOString());
      assert.equal(item.updatedAt, s.updatedAt.toISOString());
      assert.equal(item.acknowledgedAt, s.acknowledgedAt.toISOString());
      assert.equal(item.responseTimeSec, s.responseTimeSec);
      assert.equal(item.outcome, s.outcome);
      assert.equal(item.notes, s.notes);
      assert.deepEqual(item.reporter, {
        _id: reporter._id.toString(), name: 'Old Reporter', phone: '+639171111111', email: 'old@campus.edu',
      });
      assert.equal(item.deviceId, null);
    }
  });

  test('applies status, category, and date-range filters', async () => {
    await Incident.collection.insertMany([
      legacyDoc({ status: 'RESOLVED', category: 'INJURY', createdAt: new Date('2024-01-10T00:00:00Z') }),
      legacyDoc({ status: 'PENDING', category: 'INJURY', createdAt: new Date('2024-02-10T00:00:00Z') }),
      legacyDoc({ status: 'RESOLVED', category: 'FAINTING', createdAt: new Date('2024-03-10T00:00:00Z') }),
    ]);
    const auth = bearer(responder);

    const byStatus = await request(app).get('/api/incidents?status=RESOLVED').set('Authorization', auth);
    assert.equal(byStatus.body.length, 2);
    assert.ok(byStatus.body.every((i) => i.status === 'RESOLVED'));

    const byCategory = await request(app).get('/api/incidents?category=FAINTING').set('Authorization', auth);
    assert.equal(byCategory.body.length, 1);
    assert.equal(byCategory.body[0].category, 'FAINTING');

    const byRange = await request(app)
      .get('/api/incidents?from=2024-02-01T00:00:00Z&to=2024-02-28T00:00:00Z')
      .set('Authorization', auth);
    assert.equal(byRange.body.length, 1);
    assert.equal(byRange.body[0].createdAt, '2024-02-10T00:00:00.000Z');
  });

  test('caps the response at the 500 newest incidents', async () => {
    const base = Date.parse('2024-01-01T00:00:00Z');
    await Incident.collection.insertMany(
      Array.from({ length: 505 }, (_, i) => legacyDoc({ createdAt: new Date(base + i * 1000) })),
    );
    const res = await request(app).get('/api/incidents').set('Authorization', bearer(responder));
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 500);
    assert.equal(res.body[0].createdAt, new Date(base + 504 * 1000).toISOString());
    assert.equal(res.body[499].createdAt, new Date(base + 5 * 1000).toISOString());
  });

  test('incidents with no reporter or a deleted reporter return reporter: null without error', async () => {
    const gone = await makeUser({ email: 'gone@campus.edu' });
    const noReporter = legacyDoc({ source: 'SMS', createdAt: new Date('2024-01-01T00:00:00Z') });
    delete noReporter.reporter;
    await Incident.collection.insertMany([
      legacyDoc({ reporter: gone._id, createdAt: new Date('2024-01-02T00:00:00Z') }),
      noReporter,
    ]);
    await User.deleteOne({ _id: gone._id });

    const res = await request(app).get('/api/incidents').set('Authorization', bearer(responder));
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    for (const item of res.body) assert.equal(item.reporter, null);
  });
});

// ----------------------------------------------------- SMS webhook (8.2, 8.4)
describe('SMS webhook (Requirements 8.2, 8.4)', () => {
  const sms = (body, secret = process.env.SMS_WEBHOOK_SECRET) => {
    const r = request(app).post('/api/sms/inbound');
    if (secret !== null) r.set('x-webhook-secret', secret);
    return r.send(body);
  };

  test('matching phone links the reporter, creates one SMS incident, and broadcasts to responders', async () => {
    const reporter = await makeUser({ name: 'Texter', email: 'tx@campus.edu', phone: '+639172222222' });
    const responder = await makeUser({ name: 'Resp', email: 'resp2@campus.edu', role: 'responder' });

    const socket = ioClient(`http://localhost:${port}`, {
      auth: { token: signToken(responder) }, transports: ['websocket'], forceNew: true,
    });
    await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
    const received = new Promise((resolve) => socket.once('incident:new', resolve));

    try {
      const res = await sms({ from: '+639172222222', message: 'SOS|FAINTING|CONFUSED|F|21|14.65,121.07|Near gym' });
      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.id);

      assert.equal(await Incident.countDocuments(), 1);
      const doc = await Incident.findById(res.body.id).lean();
      assert.equal(doc.source, 'SMS');
      assert.equal(doc.reporter.toString(), reporter._id.toString());
      assert.equal(doc.category, 'FAINTING');
      assert.equal(doc.patientStatus, 'CONFUSED');
      assert.equal(doc.patient.sex, 'F');
      assert.equal(doc.patient.age, 21);
      assert.equal(doc.location.lat, 14.65);
      assert.equal(doc.location.lng, 121.07);
      assert.equal(doc.location.description, 'Near gym');

      const event = await received;
      assert.equal(event._id, res.body.id);
      assert.equal(event.reporter.name, 'Texter');
    } finally {
      socket.close();
    }
  });

  test('unmatched phone leaves reporter empty and maps unknown values to OTHER/UNKNOWN/UNKNOWN', async () => {
    const res = await sms({ from: '+639179999999', message: 'sos|NOPE|WHAT|X|abc|14.6,121.0|' });
    assert.equal(res.status, 201);
    const doc = await Incident.findById(res.body.id).lean();
    assert.equal(doc.reporter, undefined);
    assert.equal(doc.category, 'OTHER');
    assert.equal(doc.patientStatus, 'UNKNOWN');
    assert.equal(doc.patient.sex, 'UNKNOWN');
    assert.equal(doc.location.description, 'SMS from +639179999999');
  });

  test('message without GPS stores lat/lng as undefined', async () => {
    const res = await sms({ from: '+639179999998', message: 'SOS|INJURY|IN_PAIN|M|30||Cafeteria' });
    assert.equal(res.status, 201);
    const doc = await Incident.findById(res.body.id).lean();
    assert.equal(doc.location.lat, undefined);
    assert.equal(doc.location.lng, undefined);
    assert.equal(doc.location.description, 'Cafeteria');
  });

  test('missing or wrong secret is rejected with 401 and creates nothing', async () => {
    const msg = { from: '+639170000000', message: 'SOS|INJURY|IN_PAIN|M|30|14.6,121.0|x' };
    const missing = await sms(msg, null);
    assert.equal(missing.status, 401);
    assert.equal(missing.body.error, 'Bad secret');
    const wrong = await sms(msg, 'not-the-secret');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'Bad secret');
    assert.equal(await Incident.countDocuments(), 0);
  });

  test('non-SOS prefix is rejected with 400 and creates nothing', async () => {
    const res = await sms({ from: '+639170000000', message: 'HELP|INJURY|IN_PAIN|M|30|14.6,121.0|x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Not an SOS message');
    assert.equal(await Incident.countDocuments(), 0);
  });
});

// ------------------------------------------------------- Stored data smoke (8.5)
describe('stored incidents are unchanged by the new schema/index (Requirement 8.5)', () => {
  test('building the deviceId index leaves legacy documents and count identical', async () => {
    const u1 = new mongoose.Types.ObjectId();
    const u2 = new mongoose.Types.ObjectId();
    await Incident.collection.dropIndexes().catch(() => {});
    await Incident.collection.insertMany([
      {
        reporter: u1, forSelf: true, patient: { name: 'A', sex: 'M', age: 19 }, category: 'INJURY',
        patientStatus: 'BLEEDING', location: { lat: 1, lng: 2, description: 'Field' }, source: 'APP',
        status: 'RESOLVED', responseTimeSec: 30, outcome: 'ok', notes: 'n',
        createdAt: new Date('2023-05-01T00:00:00Z'), updatedAt: new Date('2023-05-01T01:00:00Z'), __v: 0,
      },
      {
        reporter: u2, forSelf: false, patient: { sex: 'F' }, category: 'FAINTING', patientStatus: 'UNKNOWN',
        location: { lat: 3, lng: 4 }, source: 'APP', status: 'PENDING',
        createdAt: new Date('2023-06-01T00:00:00Z'), updatedAt: new Date('2023-06-01T00:00:00Z'), __v: 0,
      },
      {
        patient: { sex: 'UNKNOWN' }, category: 'OTHER', patientStatus: 'UNKNOWN',
        location: { description: 'SMS from unknown number' }, source: 'SMS', status: 'CANCELLED',
        createdAt: new Date('2023-07-01T00:00:00Z'), updatedAt: new Date('2023-07-01T00:00:00Z'), __v: 0,
      },
    ]);

    const before = await Incident.collection.find({}).sort({ _id: 1 }).toArray();
    const countBefore = await Incident.collection.countDocuments();

    await Incident.syncIndexes();
    await Incident.init();

    const indexes = await Incident.collection.indexes();
    assert.ok(indexes.some((ix) => ix.key.deviceId === 1 && ix.key.createdAt === -1), 'deviceId index missing');

    const afterDocs = await Incident.collection.find({}).sort({ _id: 1 }).toArray();
    assert.equal(await Incident.collection.countDocuments(), countBefore);
    assert.deepEqual(afterDocs, before);
    for (const d of afterDocs) assert.equal('deviceId' in d, false);
  });
});
