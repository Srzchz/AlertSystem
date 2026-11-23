// Feature: mobile-remove-auth, Property 4: Valid app submissions build an anonymous APP incident
// **Validates: Requirements 4.2, 4.6**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildAppIncident } from '../src/lib/incidentInput.js';
import { CATEGORIES } from '../src/models/Incident.js';

// Valid Device_ID: a 1-128 char core with no leading/trailing whitespace,
// optionally wrapped in whitespace that the server must trim.
const coreId = fc.oneof(
  fc.uuid({ version: 4 }),
  fc.string({ minLength: 1, maxLength: 128 }).filter((s) => s.length > 0 && s.trim() === s),
);
const padding = fc.stringMatching(/^[ \t\n\r]{0,5}$/);
const deviceIdArb = fc.tuple(padding, coreId, padding).map(([pre, core, post]) => ({
  raw: `${pre}${core}${post}`,
  expected: core,
}));

const coordArb = fc.double({ noNaN: true });

const locationArb = fc.record(
  {
    lat: coordArb,
    lng: coordArb,
    accuracy: fc.double({ noNaN: true, min: 0, max: 10000 }),
    description: fc.string(),
    extra: fc.string(), // not an allowed location field
  },
  { requiredKeys: ['lat', 'lng'] },
);

// Patient details: any subset of name/sex/age, plus a disallowed key.
const patientArb = fc.option(
  fc.record(
    {
      name: fc.string(),
      sex: fc.constantFrom('M', 'F', 'OTHER', 'UNKNOWN'),
      age: fc.integer({ min: 0, max: 120 }),
      phone: fc.string(), // not an allowed patient field
    },
    { requiredKeys: [] },
  ),
  { nil: undefined },
);

const forSelfArb = fc.constantFrom(true, false, undefined);

// Fields a client must not be able to set.
const extrasArb = fc.record(
  {
    status: fc.constantFrom('ACKNOWLEDGED', 'RESOLVED', 'CANCELLED', 'EN_ROUTE'),
    reporter: fc.oneof(fc.stringMatching(/^[0-9a-f]{24}$/), fc.record({ _id: fc.string(), name: fc.string() })),
    handledBy: fc.stringMatching(/^[0-9a-f]{24}$/),
    source: fc.constantFrom('SMS', 'WEB', 'APP'),
    createdAt: fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
    updatedAt: fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
    acknowledgedAt: fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
    resolvedAt: fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
  },
  { requiredKeys: [] },
);

test('Property 4: Valid app submissions build an anonymous APP incident', () => {
  fc.assert(
    fc.property(
      deviceIdArb,
      fc.constantFrom(...CATEGORIES),
      locationArb,
      patientArb,
      forSelfArb,
      fc.option(fc.string(), { nil: undefined }),
      fc.option(fc.string(), { nil: undefined }),
      extrasArb,
      (dev, category, location, patient, forSelf, nature, patientStatus, extras) => {
        const body = { ...extras, deviceId: dev.raw, category, location };
        if (patient !== undefined) body.patient = patient;
        if (forSelf !== undefined) body.forSelf = forSelf;
        if (nature !== undefined) body.nature = nature;
        if (patientStatus !== undefined) body.patientStatus = patientStatus;

        const result = buildAppIncident(body);

        assert.equal(result.ok, true);
        const { doc } = result;
        assert.equal(doc.source, 'APP');
        assert.equal(doc.status, 'PENDING');
        assert.equal(doc.deviceId, dev.expected);
        assert.equal(doc.forSelf, body.forSelf !== false);
        assert.equal(doc.category, category);

        // No reporter, handler, or timestamps copied from the client.
        for (const key of ['reporter', 'handledBy', 'createdAt', 'updatedAt', 'acknowledgedAt', 'resolvedAt']) {
          assert.equal(Object.prototype.hasOwnProperty.call(doc, key), false, `doc must not have ${key}`);
        }

        // Patient contains exactly the provided name/sex/age fields.
        const expectedPatient = {};
        for (const key of ['name', 'sex', 'age']) {
          if (patient && Object.prototype.hasOwnProperty.call(patient, key)) expectedPatient[key] = patient[key];
        }
        assert.deepEqual(doc.patient, expectedPatient);

        // Location keeps only allowed fields.
        assert.equal(doc.location.lat, location.lat);
        assert.equal(doc.location.lng, location.lng);
        assert.equal(Object.prototype.hasOwnProperty.call(doc.location, 'extra'), false);
      },
    ),
    { numRuns: 200 },
  );
});
