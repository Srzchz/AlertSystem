import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

// Sanity check that the test runner and fast-check are wired up.
test('test tooling is available', () => {
  fc.assert(fc.property(fc.integer(), (n) => n + 0 === n), { numRuns: 100 });
  assert.ok(true);
});
