// Feature: mobile-remove-auth, Property 12: Update emit targets
// **Validates: Requirements 6.3, 6.6, 7.8**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import mongoose from 'mongoose';
import { updateTargets } from '../src/lib/rooms.js';

const hexId = fc.stringMatching(/^[0-9a-f]{24}$/);

// Reporter variants: populated doc, ObjectId, string id, null, absent.
// Each yields { present, value, expectedId }.
const reporterArb = fc.oneof(
  hexId.map((h) => ({ present: true, value: { _id: new mongoose.Types.ObjectId(h), name: 'R' }, expectedId: h })),
  hexId.map((h) => ({ present: true, value: new mongoose.Types.ObjectId(h), expectedId: h })),
  hexId.map((h) => ({ present: true, value: h, expectedId: h })),
  fc.constant({ present: true, value: null, expectedId: null }),
  fc.constant({ present: false, expectedId: null }),
);

// Device_ID variants: stored string, null, absent.
const deviceArb = fc.oneof(
  fc.oneof(fc.uuid({ version: 4 }), fc.string({ minLength: 1, maxLength: 128 })).map((d) => ({ present: true, value: d, expected: d })),
  fc.constant({ present: true, value: null, expected: null }),
  fc.constant({ present: false, expected: null }),
);

test('Property 12: Update emit targets', () => {
  fc.assert(
    fc.property(reporterArb, deviceArb, fc.constantFrom('APP', 'SMS'), (rep, dev, source) => {
      const incident = { _id: new mongoose.Types.ObjectId(), source, status: 'ACKNOWLEDGED' };
      if (rep.present) incident.reporter = rep.value;
      if (dev.present) incident.deviceId = dev.value;

      const targets = updateTargets(incident);

      const expected = ['responders'];
      if (rep.expectedId) expected.push(`user:${rep.expectedId}`);
      if (dev.expected) expected.push(`device:${dev.expected}`);

      assert.ok(targets.includes('responders'));
      assert.equal(targets.some((t) => t.startsWith('user:')), rep.expectedId !== null);
      assert.equal(targets.some((t) => t.startsWith('device:')), dev.expected !== null);
      assert.deepEqual([...targets].sort(), [...expected].sort());
    }),
    { numRuns: 200 },
  );
});
