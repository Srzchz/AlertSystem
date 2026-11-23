import React from 'react';
import { render, screen, act } from '@testing-library/react-native';
import * as socketMock from 'socket.io-client';
import TipsScreen from '../TipsScreen';
import { API_URL } from '../../config';

// Requirement 6.1 (and 6.7 at the screen level)

const DEVICE_ID = '3f2b8c1e-9a4d-4c7e-b2f1-0d6e5a7c9b13';
const makeNav = () => ({ navigate: jest.fn(), replace: jest.fn(), popToTop: jest.fn() });

beforeEach(() => socketMock.__reset());

describe('TipsScreen', () => {
  test('opens the status socket with auth { deviceId } and no token', async () => {
    const route = { params: { category: 'INJURY', via: 'app', incidentId: 'inc1', deviceId: DEVICE_ID } };
    await render(<TipsScreen route={route} navigation={makeNav()} />);

    expect(socketMock.io).toHaveBeenCalledTimes(1);
    const [url, opts] = socketMock.io.mock.calls[0];
    expect(url).toBe(API_URL);
    expect(opts.auth).toEqual({ deviceId: DEVICE_ID });
    expect(opts.auth).not.toHaveProperty('token');
    expect(screen.getByText('Alert sent')).toBeOnTheScreen();
  });

  test('applies updates for the shown incident only', async () => {
    const route = { params: { category: 'INJURY', via: 'app', incidentId: 'inc1', deviceId: DEVICE_ID } };
    await render(<TipsScreen route={route} navigation={makeNav()} />);
    const socket = socketMock.__lastSocket();

    await act(async () => { socket.__serverEmit('incident:update', { _id: 'other', status: 'CANCELLED' }); });
    expect(screen.queryByText('This alert was cancelled.')).toBeNull();
    await act(async () => { socket.__serverEmit('incident:update', { _id: 'inc1', status: 'CANCELLED' }); });
    expect(screen.getByText('This alert was cancelled.')).toBeOnTheScreen();
  });

  test('opens no socket for an SMS alert', async () => {
    const route = { params: { category: 'INJURY', via: 'sms' } };
    await render(<TipsScreen route={route} navigation={makeNav()} />);
    expect(socketMock.io).not.toHaveBeenCalled();
    expect(screen.getByText('One more step')).toBeOnTheScreen();
  });
});
