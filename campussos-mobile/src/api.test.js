import fc from 'fast-check';
import { api, isDeliveryFailure } from './api';

describe('isDeliveryFailure', () => {
  // Feature: mobile-remove-auth, Property 7: Delivery-failure classification
  // **Validates: Requirements 4.8**
  it('is true exactly for network, timeout, or http >= 500', () => {
    const status = fc.oneof(fc.integer({ min: 100, max: 599 }), fc.integer(), fc.constant(undefined));
    const errArb = fc.record(
      {
        kind: fc.oneof(
          fc.constantFrom('network', 'timeout', 'http'),
          fc.string(),
          fc.constant(undefined),
        ),
        status,
        message: fc.string(),
      },
      { requiredKeys: [] },
    );

    fc.assert(
      fc.property(errArb, (err) => {
        const expected =
          err.kind === 'network' ||
          err.kind === 'timeout' ||
          (err.kind === 'http' && typeof err.status === 'number' && err.status >= 500);
        expect(isDeliveryFailure(err)).toBe(expected);
      }),
      { numRuns: 200 },
    );

    fc.assert(
      fc.property(fc.integer({ min: 400, max: 499 }), (s) => {
        expect(isDeliveryFailure({ kind: 'http', status: s })).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('api() error tagging', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  const jsonResponse = (status, data) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });

  it('tags a rejected fetch as network with offline: true', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(api('/incidents')).rejects.toMatchObject({ kind: 'network', offline: true });
  });

  it('tags an aborted request as timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const p = api('/incidents', { timeoutMs: 10000 });
    jest.advanceTimersByTime(10000);
    await expect(p).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('tags 4xx and 5xx as http with status and server message', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(400, { error: 'Location is required' }));
    await expect(api('/incidents', { method: 'POST', body: {} }))
      .rejects.toMatchObject({ kind: 'http', status: 400, message: 'Location is required' });

    global.fetch = jest.fn().mockResolvedValue(jsonResponse(503, { error: 'Down' }));
    await expect(api('/incidents')).rejects.toMatchObject({ kind: 'http', status: 503, message: 'Down' });
  });

  it('sends custom headers and no Authorization header', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, []));
    await expect(api('/incidents/mine', { headers: { 'X-Device-Id': 'abc' } })).resolves.toEqual([]);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/incidents\/mine$/);
    expect(opts.headers['X-Device-Id']).toBe('abc');
    expect(Object.keys(opts.headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });
});
