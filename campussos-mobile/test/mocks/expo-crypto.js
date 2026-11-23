// expo-crypto backed by Node's crypto module, so random values are real.
const nodeCrypto = require('crypto');

module.exports = {
  getRandomValues: jest.fn((typedArray) => nodeCrypto.randomFillSync(typedArray)),
  randomUUID: jest.fn(() => nodeCrypto.randomUUID()),
  getRandomBytes: jest.fn((n) => new Uint8Array(nodeCrypto.randomBytes(n))),
};
