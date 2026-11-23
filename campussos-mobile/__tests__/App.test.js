import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, act } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

// Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// SosFormScreen imports expo-location at module level; Home never calls it.
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { High: 4, Balanced: 3 },
}));

// Capture the NavigationContainer created by App.js through a ref so the
// test can read the navigator state without changing App.js.
const mockNavRef = { current: null };
jest.mock('@react-navigation/native', () => {
  const ReactLib = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: (props) => ReactLib.createElement(actual.NavigationContainer, { ...props, ref: mockNavRef }),
  };
});

const App = require('../App').default;

// The first render loads and transforms the whole navigator tree, which can
// exceed Jest's 5 s default on a cold cache. Later renders take ~40 ms.
jest.setTimeout(30000);

const ROOT = path.resolve(__dirname, '..');
const flush = () => act(async () => {});

function hasHostType(node, type) {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((n) => hasHostType(n, type));
  if (typeof node !== 'object') return false;
  if (node.type === type) return true;
  return hasHostType(node.children, type);
}

function fetchUrls() {
  return global.fetch.mock.calls.map(([url]) => String(url));
}

async function renderAppAndExpectHome() {
  await render(<App />);
  // Home is the first screen, with no session-check spinner in front of it.
  expect(screen.getByLabelText('SOS. I need help.')).toBeOnTheScreen();
  expect(screen.getByText('Someone else needs help')).toBeOnTheScreen();
  expect(screen.getByText('My incident log')).toBeOnTheScreen();
  expect(hasHostType(screen.toJSON(), 'ActivityIndicator')).toBe(false);
  await flush();
  expect(fetchUrls().filter((u) => u.includes('/api/auth/'))).toEqual([]);
}

const originalFetch = global.fetch;

beforeEach(() => {
  SecureStore.__reset();
  jest.clearAllMocks();
  mockNavRef.current = null;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('App startup', () => {
  test('opens on Home with the SOS button and both tiles', async () => {
    await renderAppAndExpectHome();
  });

  test('still opens on Home when an old login session is stored', async () => {
    SecureStore.__store.set('session', JSON.stringify({ token: 'old.jwt', user: { name: 'Ana' } }));
    await renderAppAndExpectHome();
    expect(screen.queryByText(/Ana/)).toBeNull();
  });

  test('still opens on Home when the server is unreachable', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); });
    await renderAppAndExpectHome();
  });
});

describe('Navigation', () => {
  test('registers exactly Home, SosForm, Tips, Log with Home first', async () => {
    await render(<App />);
    await flush();
    const state = mockNavRef.current.getRootState();
    expect(state.routeNames).toEqual(['Home', 'SosForm', 'Tips', 'Log']);
    expect(state.routes[state.index].name).toBe('Home');
  });
});

describe('Smoke: login code is gone', () => {
  test('LoginScreen.js and AuthContext.js do not exist', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/screens/LoginScreen.js'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'src/AuthContext.js'))).toBe(false);
  });

  test('no client source references login, register, or logout', () => {
    const isTest = (f) => /\.test\.js$/.test(f);
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
      return /\.(js|jsx|ts|tsx)$/.test(e.name) && !isTest(e.name) ? [p] : [];
    });
    const files = [path.join(ROOT, 'App.js'), ...walk(path.join(ROOT, 'src'))];
    expect(files.length).toBeGreaterThan(5);

    const offenders = files.flatMap((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return ['/auth/login', '/auth/register', /logout/i]
        .filter((p) => (typeof p === 'string' ? src.includes(p) : p.test(src)))
        .map((p) => `${path.relative(ROOT, f)}: ${p}`);
    });
    expect(offenders).toEqual([]);
  });
});
