// Shared Jest mocks for native modules used by the app.
// Each mock lives in test/mocks/ so tests can import it to inspect calls or reset state.
jest.mock('expo-secure-store', () => require('./test/mocks/expo-secure-store'));
jest.mock('expo-crypto', () => require('./test/mocks/expo-crypto'));
jest.mock('expo-sms', () => require('./test/mocks/expo-sms'));
jest.mock('@react-native-community/netinfo', () => require('./test/mocks/netinfo'));
jest.mock('socket.io-client', () => require('./test/mocks/socket.io-client'));
