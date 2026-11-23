// In-memory SecureStore for Jest. Tests can inspect or reset `__store`.
const __store = new Map();

module.exports = {
  __store,
  __reset: () => __store.clear(),
  getItemAsync: jest.fn(async (key) => (__store.has(key) ? __store.get(key) : null)),
  setItemAsync: jest.fn(async (key, value) => { __store.set(key, String(value)); }),
  deleteItemAsync: jest.fn(async (key) => { __store.delete(key); }),
  isAvailableAsync: jest.fn(async () => true),
};
