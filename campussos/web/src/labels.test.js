import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reporterLabel, ANONYMOUS_REPORTER } from './labels.js';

const SOURCES = ['APP', 'SMS'];

// A reporter that may or may not carry a usable name.
const reporterArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.record(
    {
      name: fc.oneof(
        fc.string({ minLength: 1 }).filter((s) => s !== 'undefined' && s !== 'null'),
        fc.constant(''),
        fc.constant(undefined),
        fc.constant(null),
        fc.integer()
      ),
      phone: fc.option(fc.string()),
      email: fc.option(fc.string()),
    },
    { requiredKeys: [] }
  )
);

const incidentArb = fc.record(
  {
    source: fc.oneof(fc.constantFrom(...SOURCES), fc.string(), fc.constant(undefined)),
    reporter: reporterArb,
    deviceId: fc.option(fc.uuid({ version: 4 })),
  },
  { requiredKeys: [] }
);

describe('reporterLabel', () => {
  // Feature: mobile-remove-auth, Property 15: Web reporter label is never blank
  it('Property 15: returns the reporter name, the anonymous label, or "Unregistered number", never blank', () => {
    fc.assert(
      fc.property(incidentArb, (incident) => {
        const label = reporterLabel(incident);
        const name = incident.reporter?.name;
        const expected =
          typeof name === 'string' && name.length > 0
            ? name
            : incident.source === 'APP'
              ? ANONYMOUS_REPORTER
              : 'Unregistered number';
        expect(label).toBe(expected);
        expect(typeof label).toBe('string');
        expect(label).not.toBe('');
        expect(label).not.toBe('undefined');
        expect(label).not.toBe('null');
      }),
      { numRuns: 200 }
    );
  });

  it('labels an APP incident without a reporter as anonymous', () => {
    expect(reporterLabel({ source: 'APP', reporter: null, deviceId: 'abc' })).toBe('Anonymous mobile reporter');
  });

  it('labels an SMS incident without a reporter as an unregistered number', () => {
    expect(reporterLabel({ source: 'SMS', reporter: null, deviceId: null })).toBe('Unregistered number');
  });

  it('uses the populated reporter name', () => {
    expect(reporterLabel({ source: 'APP', reporter: { name: 'Juan Dela Cruz', phone: '0917' } })).toBe('Juan Dela Cruz');
  });
});
