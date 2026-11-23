// Online by default. Override per test, e.g.
// NetInfo.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false })
const onlineState = { type: 'wifi', isConnected: true, isInternetReachable: true, details: {} };

const NetInfo = {
  fetch: jest.fn(async () => ({ ...onlineState })),
  refresh: jest.fn(async () => ({ ...onlineState })),
  addEventListener: jest.fn(() => jest.fn()),
  configure: jest.fn(),
  useNetInfo: jest.fn(() => ({ ...onlineState })),
};

module.exports = { __esModule: true, default: NetInfo, ...NetInfo };
