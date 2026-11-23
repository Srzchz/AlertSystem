// Feature: mobile-remove-auth, Property 8: SMS fallback body round trip
import fc from 'fast-check';
import { buildSosSmsBody } from './sms';
import { CATEGORIES, PATIENT_STATUSES, SEXES } from './data/options';
// Copied from campussos/server/src/routes/sms.js (see the note in the fixture).
import { parseSosSms } from '../test/fixtures/parseSosSms';

const values = (list) => list.map((o) => o.value);

// Free text as typed in the "What happened?" and "Where are you?" fields. Includes '|',
// ',' and newlines, which the server keeps because the note is the joined tail segments.
// Trailing whitespace is removed: the server trims the whole message, so trailing
// whitespace in the note is not preserved (reported as a finding, not part of Property 8).
const freeText = fc
  .oneof(
    fc.string(),
    fc.string({ unit: fc.constantFrom('a', 'Z', '1', ' ', '|', ',', '\n', 'é') }),
  )
  .map((s) => s.trimEnd());

const details = fc.record({
  category: fc.constantFrom(...values(CATEGORIES)),
  patientStatus: fc.constantFrom(...values(PATIENT_STATUSES)),
  sex: fc.constantFrom(...values(SEXES)),
  // The age input is a number-pad text field with maxLength 3.
  age: fc.oneof(fc.constant(''), fc.stringMatching(/^[0-9]{1,3}$/)),
  coords: fc.option(
    fc.record({
      lat: fc.double({ min: -90, max: 90, noNaN: true }),
      lng: fc.double({ min: -180, max: 180, noNaN: true }),
    }),
    { nil: null },
  ),
  place: freeText,
  nature: freeText,
});

describe('Property 8: SMS fallback body round trip', () => {
  it('parseSosSms(buildSosSmsBody(details)) preserves the SOS details', () => {
    // **Validates: Requirements 4.8**
    fc.assert(
      fc.property(details, (d) => {
        const parsed = parseSosSms(buildSosSmsBody(d));
        expect(parsed).not.toBeNull();
        expect(parsed.category).toBe(d.category);
        expect(parsed.patientStatus).toBe(d.patientStatus);
        expect(parsed.sex).toBe(d.sex);
        // Same rule the app uses for patient.age: blank or 0 means "not given".
        expect(parsed.age).toBe(Number(d.age) || undefined);
        if (d.coords) {
          expect(parsed.lat).toBe(Number(d.coords.lat.toFixed(5)));
          expect(parsed.lng).toBe(Number(d.coords.lng.toFixed(5)));
        } else {
          expect(parsed.lat).toBeUndefined();
          expect(parsed.lng).toBeUndefined();
        }
        expect(parsed.note).toBe(d.place || d.nature);
      }),
      { numRuns: 200 },
    );
  });
});
