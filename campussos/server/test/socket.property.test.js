// Feature: mobile-remove-auth, Property 11: Socket room assignment
// **Validates: Requirements 6.2, 6.4, 6.5, 7.5, 7.6**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { resolveSocketRooms, attachSocketAuth } from '../src/socket.js';

const VALID_TOKEN = 'valid-token-marker';

// Verifier stub: returns the generated user for the marked valid token, throws otherwise.
const makeVerifier = (user) => (token) => {
  if (token === VALID_TOKEN) return user;
  throw new Error('invalid token');
};

// Independent model of the Device_ID rule: string, 1..128 chars after trim.
const expectedDeviceId = (value) => {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length >= 1 && t.length <= 128 ? t : null;
};

const ws = fc.constantFrom(' ', '\t', '\n', '  ');

const deviceIdArb = fc.oneof(
  fc.uuid({ version: 4 }),
  fc.string({ minLength: 1, maxLength: 128 }),
  // valid id with surrounding whitespace
  fc.tuple(ws, fc.uuid({ version: 4 }), ws).map(([a, d, b]) => a + d + b),
  // whitespace-only / empty
  fc.constantFrom('', ' ', '   ', '\t\n'),
  // longer than 128 after trim
  fc.string({ minLength: 129, maxLength: 300 }).filter((s) => s.trim().length > 128),
  // non-strings
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant({ $ne: null }),
  fc.object(),
  fc.array(fc.string()),
);

const userArb = fc.record({
  id: fc.oneof(fc.stringMatching(/^[0-9a-f]{24}$/), fc.string({ minLength: 1, maxLength: 30 })),
  role: fc.oneof(fc.constantFrom('user', 'responder', 'admin'), fc.string()),
});

// Token variants: valid marker, invalid string, non-string junk, null, absent.
const tokenArb = fc.oneof(
  fc.constant({ kind: 'valid', present: true, value: VALID_TOKEN }),
  fc.string().filter((s) => s !== VALID_TOKEN).map((s) => ({ kind: 'invalid', present: true, value: s })),
  fc.oneof(fc.integer(), fc.object()).map((v) => ({ kind: 'invalid', present: true, value: v })),
  fc.constant({ kind: 'invalid', present: true, value: null }),
  fc.constant({ kind: 'absent', present: false }),
);

// Whole auth object: undefined, null, or a record with optional token/deviceId.
const authArb = fc.oneof(
  { weight: 1, arbitrary: fc.constant({ shape: 'undefined' }) },
  { weight: 1, arbitrary: fc.constant({ shape: 'null' }) },
  {
    weight: 10,
    arbitrary: fc.record({
      shape: fc.constant('object'),
      token: tokenArb,
      hasDeviceId: fc.boolean(),
      deviceId: deviceIdArb,
    }),
  },
);

const buildAuth = (a) => {
  if (a.shape === 'undefined') return undefined;
  if (a.shape === 'null') return null;
  const auth = {};
  if (a.token.present) auth.token = a.token.value;
  if (a.hasDeviceId) auth.deviceId = a.deviceId;
  return auth;
};

const expectedRooms = (a, user) => {
  if (a.shape === 'object' && a.token.kind === 'valid') {
    const rooms = [`user:${user.id}`];
    if (user.role === 'responder' || user.role === 'admin') rooms.push('responders');
    return rooms;
  }
  const d = a.shape === 'object' && a.hasDeviceId ? expectedDeviceId(a.deviceId) : null;
  return d === null ? null : [`device:${d}`];
};

// Tiny fake io: captures the middleware and connection handler.
const fakeIo = () => {
  const io = { middleware: null, onConnection: null };
  io.use = (fn) => { io.middleware = fn; };
  io.on = (event, fn) => { if (event === 'connection') io.onConnection = fn; };
  return io;
};

const fakeSocket = (auth) => {
  const joined = [];
  return { handshake: { auth }, data: {}, joined, join: (room) => joined.push(room) };
};

test('Property 11: Socket room assignment', () => {
  fc.assert(
    fc.property(authArb, userArb, (a, user) => {
      const auth = buildAuth(a);
      const verify = makeVerifier(user);
      const expected = expectedRooms(a, user);

      // Pure resolver
      const result = resolveSocketRooms(auth, verify);
      if (expected === null) {
        assert.equal(result, null);
      } else {
        assert.ok(result);
        assert.deepEqual(result.rooms, expected);
        if (a.shape === 'object' && a.token.kind === 'valid') {
          assert.equal(result.kind, 'user');
        } else {
          assert.equal(result.kind, 'device');
          assert.ok(!result.rooms.includes('responders'));
          assert.ok(!result.rooms.some((r) => r.startsWith('user:')));
        }
      }

      // Middleware + connection via a fake io
      const io = fakeIo();
      attachSocketAuth(io, verify);
      assert.equal(typeof io.middleware, 'function');
      const socket = fakeSocket(auth);
      let nextArg = 'not-called';
      io.middleware(socket, (err) => { nextArg = err; });

      if (expected === null) {
        assert.ok(nextArg instanceof Error);
        assert.equal(nextArg.message, 'unauthorized');
        // A rejected socket never reaches 'connection'; it has no rooms to join.
        assert.equal(socket.data.rooms, undefined);
        assert.deepEqual(socket.joined, []);
      } else {
        assert.equal(nextArg, undefined);
        io.onConnection(socket);
        assert.deepEqual(socket.joined, expected);
      }
    }),
    { numRuns: 300 },
  );
});
