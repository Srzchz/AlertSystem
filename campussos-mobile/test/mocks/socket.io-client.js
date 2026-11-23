// Fake Socket.IO client. `io(url, opts)` records its arguments and returns a
// socket whose handlers tests can trigger with `socket.__serverEmit(event, payload)`.
const sockets = [];

function createSocket(url, opts) {
  const handlers = {};
  const socket = {
    url,
    opts,
    connected: true,
    on: jest.fn((event, fn) => { (handlers[event] ||= []).push(fn); return socket; }),
    off: jest.fn((event, fn) => {
      if (!handlers[event]) return socket;
      handlers[event] = fn ? handlers[event].filter((h) => h !== fn) : [];
      return socket;
    }),
    emit: jest.fn(() => socket),
    connect: jest.fn(() => { socket.connected = true; return socket; }),
    disconnect: jest.fn(() => { socket.connected = false; return socket; }),
    close: jest.fn(() => { socket.connected = false; return socket; }),
    __serverEmit: (event, ...args) => (handlers[event] || []).forEach((h) => h(...args)),
  };
  return socket;
}

const io = jest.fn((url, opts) => {
  const s = createSocket(url, opts);
  sockets.push(s);
  return s;
});

module.exports = {
  __esModule: true,
  io,
  default: io,
  __sockets: sockets,
  __lastSocket: () => sockets[sockets.length - 1],
  __reset: () => { sockets.length = 0; io.mockClear(); },
};
