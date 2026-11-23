// Feature: mobile-remove-auth, Property 6: Invalid category or location is rejected with the existing messages
// **Validates: Requirements 4.5**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { CATEGORIES } from '../src/models/Incident.js';
import { buildAppIncident } from '../src/lib/incidentInput.js';

// Valid Device_ID: non-blank string, 1..128 chars after trimming, optionally padded.
const deviceIdArb = fc
  .tuple(
    fc.oneof(fc.uuid({ version: 4 }), fc.string({ minLength: 1, maxLength: 128 }).filter((s) => {
      const t = s.trim();
      return t.length >= 1 && t.length <= 128;
    })),
    fc.constantFrom('', ' ', '  ', '\t'),
  )
  .map(([id, pad]) => pad + id + pad);

const numArb = fc.double({ noNaN: true });
const validLocationArb = fc.record({ lat: numArb, lng: numArb });

const nonNumberArb = fc.oneof(
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.object(),
  fc.array(fc.integer()),
  numArb.map((n) => String(n)),
);

// Category outside CATEGORIES: arbitrary strings plus non-string values.
const badCategoryArb = fc.oneof(
  fc.string().filter((s) => !CATEGORIES.includes(s)),
  fc.constantFrom(...CATEGORIES).map((c) => c.toLowerCase()).filter((c) => !CATEGORIES.includes(c)),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
  fc.object(),
);

// Invalid location: missing, non-object, or with a non-numeric lat and/or lng.
const badLocationArb = fc.oneof(
  fc.constant({ omit: true }),
  fc.oneof(fc.constant(null), fc.string(), fc.integer(), fc.array(numArb)).map((v) => ({ value: v })),
  fc.record({ lat: nonNumberArb, lng: numArb }).map((v) => ({ value: v })),
  fc.record({ lat: numArb, lng: nonNumberArb }).map((v) => ({ value: v })),
  fc.record({ lat: nonNumberArb, lng: nonNumberArb }).map((v) => ({ value: v })),
  fc.record({ description: fc.string() }).map((v) => ({ value: v })),
);

const extrasArb = fc.record(
  {
    forSelf: fc.boolean(),
    patient: fc.record({ name: fc.string(), sex: fc.constantFrom('M', 'F', 'OTHER', 'UNKNOWN'), age: fc.nat(120) }, { requiredKeys: [] }),
    nature: fc.string(),
    patientStatus: fc.string(),
  },
  { requiredKeys: [] },
);

test('Property 6: invalid category is rejected with "Choose an alert category"', () => {
  fc.assert(
    fc.property(deviceIdArb, badCategoryArb, fc.option(validLocationArb, { nil: undefined }), extrasArb, (deviceId, category, location, extras) => {
      const body = { ...extras, deviceId, category };
      if (location !== undefined) body.location = location;
      assert.deepEqual(buildAppIncident(body), { ok: false, error: 'Choose an alert category' });
    }),
    { numRuns: 200 },
  );
});

test('Property 6: valid category with invalid location is rejected with "Location is required"', () => {
  fc.assert(
    fc.property(deviceIdArb, fc.constantFrom(...CATEGORIES), badLocationArb, extrasArb, (deviceId, category, loc, extras) => {
      const body = { ...extras, deviceId, category };
      if (!loc.omit) body.location = loc.value;
      assert.deepEqual(buildAppIncident(body), { ok: false, error: 'Location is required' });
    }),
    { numRuns: 200 },
  );
});
