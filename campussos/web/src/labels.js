export const CATEGORY_LABELS = {
  MEDICAL_EMERGENCY: 'Medical emergency',
  INJURY: 'Injury',
  FAINTING: 'Fainting',
  ALLERGIC_REACTION: 'Allergic reaction',
  MENTAL_HEALTH_CRISIS: 'Mental health crisis',
  OTHER: 'Other',
};
export const PATIENT_STATUS_LABELS = {
  CONSCIOUS_BREATHING: 'Conscious and breathing',
  CONFUSED: 'Confused',
  UNCONSCIOUS: 'Unconscious',
  NOT_BREATHING: 'Not breathing',
  BLEEDING: 'Bleeding',
  IN_PAIN: 'In pain',
  UNKNOWN: 'Unknown',
};
export const STATUS_LABELS = {
  PENDING: 'Waiting',
  ACKNOWLEDGED: 'Acknowledged',
  EN_ROUTE: 'On the way',
  ON_SCENE: 'On scene',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
};
export const fmtTime = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const fmtDuration = (sec) => (sec == null ? '-' : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`);
