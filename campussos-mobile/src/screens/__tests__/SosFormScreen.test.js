import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import NetInfo from '@react-native-community/netinfo';
import SosFormScreen from '../SosFormScreen';

// Requirements 3.6, 4.1, 4.7, 4.8, 4.9

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { High: 4 },
}));

const mockGetDeviceId = jest.fn();
jest.mock('../../DeviceContext', () => ({ useDevice: () => ({ getDeviceId: mockGetDeviceId }) }));

const DEVICE_ID = '3f2b8c1e-9a4d-4c7e-b2f1-0d6e5a7c9b13';
const POSITION = { coords: { latitude: 14.6, longitude: 121.0, accuracy: 8 } };

const makeNav = () => ({ navigate: jest.fn(), replace: jest.fn(), popToTop: jest.fn() });
const jsonResponse = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

let alertSpy;
beforeEach(() => {
  jest.clearAllMocks();
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.getCurrentPositionAsync.mockResolvedValue(POSITION);
  mockGetDeviceId.mockResolvedValue(DEVICE_ID);
  global.fetch = jest.fn();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  alertSpy.mockRestore();
  jest.useRealTimers();
});

async function renderForm(nav = makeNav(), forSelf = true) {
  await render(<SosFormScreen route={{ params: { forSelf } }} navigation={nav} />);
  await waitFor(() => expect(screen.getByText('GPS location pinned')).toBeOnTheScreen());
  await fireEvent.press(screen.getByText('Injury'));
  await fireEvent.press(screen.getByText('In pain'));
  await fireEvent.press(screen.getByText('Female'));
  await fireEvent.changeText(screen.getByPlaceholderText('Age (e.g. 19)'), '19');
  await fireEvent.changeText(screen.getByPlaceholderText(/What happened\?/), 'Fell on the stairs');
  await fireEvent.changeText(screen.getByPlaceholderText(/Room or landmark/), 'Gym entrance');
  return nav;
}

const pressSend = () => fireEvent.press(screen.getByText('Send SOS'));
const lastAlert = () => alertSpy.mock.calls[alertSpy.mock.calls.length - 1];

function expectFormKept() {
  expect(screen.getByDisplayValue('19')).toBeOnTheScreen();
  expect(screen.getByDisplayValue('Fell on the stairs')).toBeOnTheScreen();
  expect(screen.getByDisplayValue('Gym entrance')).toBeOnTheScreen();
}

describe('SosFormScreen', () => {
  test('online submit sends deviceId and all fields without Authorization, then opens Tips via app', async () => {
    global.fetch.mockResolvedValue(jsonResponse(201, { _id: 'inc1', status: 'PENDING' }));
    const nav = await renderForm();
    await pressSend();

    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/incidents$/);
    expect(init.method).toBe('POST');
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(JSON.parse(init.body)).toEqual({
      deviceId: DEVICE_ID,
      forSelf: true,
      patient: { sex: 'F', age: 19 },
      nature: 'Fell on the stairs',
      category: 'INJURY',
      patientStatus: 'IN_PAIN',
      location: { lat: 14.6, lng: 121.0, accuracy: 8, description: 'Gym entrance' },
    });
    expect(nav.replace).toHaveBeenCalledWith('Tips', { category: 'INJURY', incidentId: 'inc1', deviceId: DEVICE_ID, via: 'app' });
  });

  test('sends nothing until the Device_ID resolves', async () => {
    let release;
    mockGetDeviceId.mockReturnValue(new Promise((r) => { release = r; }));
    global.fetch.mockResolvedValue(jsonResponse(201, { _id: 'inc2' }));
    const nav = await renderForm(makeNav(), false);
    // The press settles only when send() finishes, so do not await it yet.
    const pressed = pressSend();
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();

    release(DEVICE_ID);
    await pressed;
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.deviceId).toBe(DEVICE_ID);
    expect(body.forSelf).toBe(false);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('Tips', expect.objectContaining({ via: 'app' })));
  });

  test('offline opens the SMS fallback without any fetch', async () => {
    NetInfo.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false });
    const nav = await renderForm();
    await pressSend();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('Tips', { category: 'INJURY', via: 'sms' }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockGetDeviceId).not.toHaveBeenCalled();
    expect(SMS.sendSMSAsync).toHaveBeenCalledTimes(1);
    expect(SMS.sendSMSAsync.mock.calls[0][1]).toBe('SOS|INJURY|IN_PAIN|F|19|14.60000,121.00000|Gym entrance');
  });

  test('a 5xx response shows "Alert not delivered", keeps the form, and offers a pre-filled SMS', async () => {
    global.fetch.mockResolvedValue(jsonResponse(503, { error: 'Service unavailable' }));
    const nav = await renderForm();
    await pressSend();

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const [title, , buttons] = lastAlert();
    expect(title).toBe('Alert not delivered');
    expect(buttons.map((b) => b.text)).toEqual(['Try again', 'Send by SMS']);
    expect(nav.replace).not.toHaveBeenCalled();
    expectFormKept();

    await act(async () => { await buttons[1].onPress(); });
    expect(SMS.sendSMSAsync.mock.calls[0][1]).toBe('SOS|INJURY|IN_PAIN|F|19|14.60000,121.00000|Gym entrance');
    expect(nav.replace).toHaveBeenCalledWith('Tips', { category: 'INJURY', via: 'sms' });
  });

  test('a network error shows "Alert not delivered"', async () => {
    global.fetch.mockRejectedValue(new TypeError('Network request failed'));
    await renderForm();
    await pressSend();
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(lastAlert()[0]).toBe('Alert not delivered');
    expectFormKept();
  });

  test('no response within 10 seconds shows "Alert not delivered"', async () => {
    // fetch that only settles when aborted.
    global.fetch.mockImplementation((_url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    }));
    await renderForm();
    jest.useFakeTimers();
    // The press settles only when send() finishes, so do not await it yet.
    const pressed = pressSend();
    await jest.advanceTimersByTimeAsync(9999);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await pressed;
    expect(alertSpy).toHaveBeenCalled();
    expect(lastAlert()[0]).toBe('Alert not delivered');
    expectFormKept();
  });

  test('a 4xx response shows "Could not send alert" with the server message', async () => {
    global.fetch.mockResolvedValue(jsonResponse(400, { error: 'Location is required' }));
    await renderForm();
    await pressSend();
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(lastAlert()).toEqual(['Could not send alert', 'Location is required']);
  });

  test('denied location and no description asks for a location and sends nothing', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await render(<SosFormScreen route={{ params: { forSelf: true } }} navigation={makeNav()} />);
    await waitFor(() => expect(screen.getByText('Location unavailable')).toBeOnTheScreen());
    await pressSend();
    expect(lastAlert()[0]).toBe('Add a location');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
