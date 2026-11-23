// Feature: mobile-remove-auth, Property 1: UUID v4 formatting
// **Validates: Requirements 3.1**
import fc from 'fast-check';
import { formatUuidV4, isUuidV4, UUID_V4_RE } from './deviceId';

const bytes16 = fc.uint8Array({ minLength: 16, maxLength: 16 });

describe('Property 1: UUID v4 formatting', () => {
  test('any 16 bytes format to a valid lowercase UUID v4 that keeps the non-version/variant bits', () => {
    fc.assert(
      fc.property(bytes16, (bytes) => {
        const before = Array.from(bytes);
        const id = formatUuidV4(bytes);

        // Shape: 36 chars, lowercase, matches the v4 regex, accepted by isUuidV4.
        expect(id).toHaveLength(36);
        expect(id).toBe(id.toLowerCase());
        expect(id).toMatch(UUID_V4_RE);
        expect(isUuidV4(id)).toBe(true);

        // Input array is not mutated.
        expect(Array.from(bytes)).toEqual(before);

        // Decode the hex back to bytes and compare against the input.
        const hex = id.replace(/-/g, '');
        const out = [];
        for (let i = 0; i < 16; i++) out.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));

        for (let i = 0; i < 16; i++) {
          if (i === 6) {
            expect(out[6] >> 4).toBe(0x4); // version nibble
            expect(out[6] & 0x0f).toBe(before[6] & 0x0f);
          } else if (i === 8) {
            expect(out[8] >> 6).toBe(0b10); // variant bits
            expect(out[8] & 0x3f).toBe(before[8] & 0x3f);
          } else {
            expect(out[i]).toBe(before[i]);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
