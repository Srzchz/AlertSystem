import { Alert } from 'react-native';
import * as SMS from 'expo-sms';
import { INFIRMARY_NUMBER } from './config';

// Builds the offline SOS text. Must stay compatible with the server's parseSosSms:
// SOS|CATEGORY|PATIENT_STATUS|SEX|AGE|lat,lng|note
export function buildSosSmsBody({ category, patientStatus, sex, age, coords, place, nature }) {
  return [
    'SOS',
    category,
    patientStatus,
    sex,
    age || '',
    coords ? `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}` : '',
    place || nature,
  ].join('|');
}

// Opens a pre-filled SMS to the infirmary. Resolves true if the SMS app was opened,
// false if SMS is unavailable (the user is told to call the infirmary instead).
export async function openSmsFallback(details) {
  if (!(await SMS.isAvailableAsync())) {
    Alert.alert('No connection', `Call the infirmary at ${INFIRMARY_NUMBER}.`);
    return false;
  }
  await SMS.sendSMSAsync([INFIRMARY_NUMBER], buildSosSmsBody(details));
  return true;
}
