// Feature: mobile-remove-auth, Property 13: Tips screen applies only matching updates
// **Validates: Requirements 6.7**
import fc from 'fast-check';
import { applyIncidentUpdate } from './TipsScreen';

const STATUSES = ['PENDING', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SCENE', 'RESOLVED', 'CANCELLED'];
const statusArb = fc.oneof(fc.constantFrom(...STATUSES), fc.string());

// Mongo ObjectId-like hex strings plus arbitrary strings.
const idArb = fc.oneof(
  fc.stringMatching(/^[0-9a-f]{24}$/),
  fc.string({ minLength: 1 }),
);

// An event _id derived from the shown id: equal, or near-equal but different
// (case change, number vs string, padding), or unrelated.
const eventIdArb = (incidentId) =>
  fc.oneof(
    fc.constant(incidentId),
    fc.constant(incidentId.toUpperCase()),
    fc.constant(incidentId.toLowerCase()),
    fc.constant(` ${incidentId}`),
    fc.constant(`${incidentId} `),
    fc.constant(Number(incidentId)),
    fc.constant([incidentId]),
    fc.constant(undefined),
    fc.constant(null),
    idArb,
  );

describe('Property 13: Tips screen applies only matching updates', () => {
  test('returns event.status exactly when event._id === incidentId', () => {
    fc.assert(
      fc.property(
        statusArb,
        idArb.chain((incidentId) =>
          fc.tuple(fc.constant(incidentId), eventIdArb(incidentId), statusArb),
        ),
        (current, [incidentId, eventId, eventStatus]) => {
          const event = { _id: eventId, status: eventStatus };
          const result = applyIncidentUpdate(current, incidentId, event);
          expect(result).toBe(eventId === incidentId ? eventStatus : current);
        },
      ),
      { numRuns: 300 },
    );
  });

  test('numeric ids: a number event id never matches its string form', () => {
    fc.assert(
      fc.property(statusArb, fc.nat(), statusArb, (current, n, eventStatus) => {
        expect(applyIncidentUpdate(current, String(n), { _id: n, status: eventStatus })).toBe(current);
        expect(applyIncidentUpdate(current, n, { _id: String(n), status: eventStatus })).toBe(current);
      }),
      { numRuns: 100 },
    );
  });

  test('non-object events leave the current status unchanged', () => {
    fc.assert(
      fc.property(
        statusArb,
        idArb,
        fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), fc.integer(), fc.boolean()),
        (current, incidentId, event) => {
          expect(applyIncidentUpdate(current, incidentId, event)).toBe(current);
        },
      ),
      { numRuns: 100 },
    );
  });
});
