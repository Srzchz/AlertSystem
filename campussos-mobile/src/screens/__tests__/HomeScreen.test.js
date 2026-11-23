import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import HomeScreen from '../HomeScreen';

// Requirements 2.1, 2.2, 2.3, 2.5, 2.6

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const makeNav = () => ({ navigate: jest.fn(), replace: jest.fn(), popToTop: jest.fn() });

// Collects every rendered string in tree order.
function textsInOrder(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textsInOrder(n, out)); return out; }
  (node.children || []).forEach((c) => textsInOrder(c, out));
  return out;
}

describe('HomeScreen', () => {
  test('shows the fixed greeting and subtitle with no account data or log-out control', async () => {
    await render(<HomeScreen navigation={makeNav()} />);
    expect(screen.getByText('Hi there')).toBeOnTheScreen();
    expect(screen.getByText('Stay calm. Help is one tap away.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Log out')).toBeNull();
    expect(screen.queryByText(/log out/i)).toBeNull();
  });

  test('renders brand, greeting, SOS, both tiles, and the SMS note in order', async () => {
    await render(<HomeScreen navigation={makeNav()} />);
    const texts = textsInOrder(screen.toJSON());
    const order = [
      'CampusSOS',
      'Hi there',
      'Stay calm. Help is one tap away.',
      'SOS',
      'Someone else needs help',
      'My incident log',
      'No internet? The app will open a text message to the infirmary instead.',
    ].map((t) => texts.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('SOS button opens the self-report form', async () => {
    const nav = makeNav();
    await render(<HomeScreen navigation={nav} />);
    await fireEvent.press(screen.getByLabelText('SOS. I need help.'));
    expect(nav.navigate).toHaveBeenCalledWith('SosForm', { forSelf: true });
  });

  test('tiles open the other-person form and the incident log', async () => {
    const nav = makeNav();
    await render(<HomeScreen navigation={nav} />);
    await fireEvent.press(screen.getByText('Someone else needs help'));
    expect(nav.navigate).toHaveBeenLastCalledWith('SosForm', { forSelf: false });
    await fireEvent.press(screen.getByText('My incident log'));
    expect(nav.navigate).toHaveBeenLastCalledWith('Log');
  });
});
