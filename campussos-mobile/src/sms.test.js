import { Alert } from 'react-native';
import * as SMS from 'expo-sms';
import { buildSosSmsBody, openSmsFallback } from './sms';
import { INFIRMARY_NUMBER } from './config';

const details = {
  category: 'INJURY', patientStatus: 'IN_PAIN', sex: 'F', age: '19',
  coords: { lat: 14.6123456, lng: 121.0123456 }, place: 'Gym entrance', nature: 'Fell',
};

describe('buildSosSmsBody', () => {
  test('uses the SOS|CATEGORY|PATIENT_STATUS|SEX|AGE|lat,lng|note format', () => {
    expect(buildSosSmsBody(details)).toBe('SOS|INJURY|IN_PAIN|F|19|14.61235,121.01235|Gym entrance');
  });

  test('leaves age and coordinates empty and falls back to nature as the note', () => {
    expect(buildSosSmsBody({ ...details, age: '', coords: null, place: '' }))
      .toBe('SOS|INJURY|IN_PAIN|F|||Fell');
  });
});

describe('openSmsFallback', () => {
  beforeEach(() => jest.clearAllMocks());

  test('opens a pre-filled SMS to the infirmary when SMS is available', async () => {
    await expect(openSmsFallback(details)).resolves.toBe(true);
    expect(SMS.sendSMSAsync).toHaveBeenCalledWith([INFIRMARY_NUMBER], buildSosSmsBody(details));
  });

  test('tells the user to call the infirmary when SMS is unavailable', async () => {
    SMS.isAvailableAsync.mockResolvedValueOnce(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await expect(openSmsFallback(details)).resolves.toBe(false);
    expect(SMS.sendSMSAsync).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('No connection', `Call the infirmary at ${INFIRMARY_NUMBER}.`);
  });
});
