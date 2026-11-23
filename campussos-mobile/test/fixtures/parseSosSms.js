// Copy of parseSosSms from campussos/server/src/routes/sms.js (and the enums it uses from
// campussos/server/src/models/Incident.js). The server module imports express and mongoose
// from the server package, which the mobile Jest setup cannot load, so the parser is copied
// here for the SMS round-trip property test. Keep this in sync with the server source.

const CATEGORIES = [
  'MEDICAL_EMERGENCY', 'INJURY', 'FAINTING', 'ALLERGIC_REACTION', 'MENTAL_HEALTH_CRISIS', 'OTHER',
];
const PATIENT_STATUSES = [
  'CONSCIOUS_BREATHING', 'CONFUSED', 'UNCONSCIOUS', 'NOT_BREATHING', 'BLEEDING', 'IN_PAIN', 'UNKNOWN',
];

// Expected message: SOS|CATEGORY|PATIENT_STATUS|SEX|AGE|lat,lng|note
export function parseSosSms(text = '') {
  const [prefix, category, patientStatus, sex, age, coords, ...note] = text.trim().split('|');
  if ((prefix || '').toUpperCase() !== 'SOS') return null;
  // A blank or malformed coords segment (empty, whitespace, or missing a part) means no location.
  const parts = (coords || '').split(',');
  const [lat, lng] = parts.length >= 2 && parts[0].trim() && parts[1].trim() ? parts.map(Number) : [];
  return {
    category: CATEGORIES.includes(category) ? category : 'OTHER',
    patientStatus: PATIENT_STATUSES.includes(patientStatus) ? patientStatus : 'UNKNOWN',
    sex: ['M', 'F', 'OTHER'].includes(sex) ? sex : 'UNKNOWN',
    age: Number(age) || undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    note: note.join('|'),
  };
}
