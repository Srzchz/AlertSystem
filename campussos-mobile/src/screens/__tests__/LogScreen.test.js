import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../LogScreen';

// Requirements 5.1, 5.5, 5.6, 5.7

// Run the focus callback once on mount, like a screen gaining focus.
jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useFocusEffect: (cb) => { useEffect(() => cb(), [cb]); },
  };
});

const DEVICE_ID = '3f2b8c1e-9a4d-4c7e-b2f1-0d6e5a7c9b13';
// Stable context value, as DeviceProvider provides.
jest.mock('../../DeviceContext', () => {
  const value = { getDeviceId: () => Promise.resolve('3f2b8c1e-9a4d-4c7e-b2f1-0d6e5a7c9b13') };
  return { useDevice: () => value };
});

const jsonResponse = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

const STATUSES = [
  ['PENDING', 'Waiting', null],
  ['ACKNOWLEDGED', 'Acknowledged', 45],
  ['EN_ROUTE', 'On the way', 125],
  ['ON_SCENE', 'On scene', 60],
  ['RESOLVED', 'Resolved', 300],
  ['CANCELLED', 'Cancelled', null],
];
const incidents = STATUSES.map(([status], i) => ({
  _id: `inc${i}`,
  category: i === 0 ? 'INJURY' : 'FAINTING',
  status,
  createdAt: new Date(Date.UTC(2026, 0, 10 - i, 8, 30)).toISOString(),
  responseTimeSec: STATUSES[i][2],
  location: { lat: 14.6, lng: 121, description: `Place ${i}` },
}));

beforeEach(() => {
  global.fetch = jest.fn();
});

describe('LogScreen', () => {
  test('sends one request with X-Device-Id and no Authorization', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, []));
    await render(<LogScreen />);
    await waitFor(() => expect(screen.getByText('No alerts yet')).toBeOnTheScreen());

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/incidents\/mine$/);
    expect(init.headers['X-Device-Id']).toBe(DEVICE_ID);
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  test('renders one card per incident in order with category, date, status, and response time', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, incidents));
    await render(<LogScreen />);
    await waitFor(() => expect(screen.getByText('Place 0')).toBeOnTheScreen());

    STATUSES.forEach(([, label]) => expect(screen.getByText(label)).toBeOnTheScreen());
    expect(screen.getByText('Injury')).toBeOnTheScreen();
    expect(screen.getAllByText('Fainting')).toHaveLength(5);
    incidents.forEach((i) => expect(screen.getByText(new Date(i.createdAt).toLocaleString())).toBeOnTheScreen());
    expect(screen.getAllByText('Not yet acknowledged')).toHaveLength(2);
    expect(screen.getByText('45s')).toBeOnTheScreen();
    expect(screen.getByText('2m 5s')).toBeOnTheScreen();
    expect(screen.getByText('1m 0s')).toBeOnTheScreen();
    expect(screen.getByText('5m 0s')).toBeOnTheScreen();

    const places = screen.getAllByText(/^Place \d$/).map((n) => n.props.children);
    expect(places).toEqual(incidents.map((_, i) => `Place ${i}`));
  });

  test('shows the empty state when no incidents are returned', async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, []));
    await render(<LogScreen />);
    await waitFor(() => expect(screen.getByText('No alerts yet')).toBeOnTheScreen());
    expect(screen.getByText('No alerts have been sent from this phone.')).toBeOnTheScreen();
  });

  test('shows an error with Retry that resends the request and sends nothing else', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(500, { error: 'Something went wrong on the server' }))
      .mockResolvedValueOnce(jsonResponse(200, incidents.slice(0, 1)));
    await render(<LogScreen />);
    await waitFor(() => expect(screen.getByText('Cannot load your log')).toBeOnTheScreen());
    expect(screen.getByText('Something went wrong on the server')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(screen.getByText('Place 0')).toBeOnTheScreen());
    expect(screen.queryByText('Cannot load your log')).toBeNull();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    global.fetch.mock.calls.forEach(([url, init]) => {
      expect(url).toMatch(/\/api\/incidents\/mine$/);
      expect(init.method).toBe('GET');
      expect(init.headers['X-Device-Id']).toBe(DEVICE_ID);
    });
  });

  test('a network error shows the offline message with Retry', async () => {
    global.fetch.mockRejectedValue(new TypeError('Network request failed'));
    await render(<LogScreen />);
    await waitFor(() => expect(screen.getByText('Cannot load your log')).toBeOnTheScreen());
    expect(screen.getByText('You are offline. Connect to see your log.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Retry')).toBeOnTheScreen();
  });
});
