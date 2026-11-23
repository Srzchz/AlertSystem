export const CATEGORIES = [
  { value: 'MEDICAL_EMERGENCY', label: 'Medical emergency' },
  { value: 'INJURY', label: 'Injury' },
  { value: 'FAINTING', label: 'Fainting' },
  { value: 'ALLERGIC_REACTION', label: 'Allergic reaction' },
  { value: 'MENTAL_HEALTH_CRISIS', label: 'Mental health crisis' },
  { value: 'OTHER', label: 'Other' },
];
export const PATIENT_STATUSES = [
  { value: 'CONSCIOUS_BREATHING', label: 'Conscious and breathing' },
  { value: 'CONFUSED', label: 'Confused' },
  { value: 'UNCONSCIOUS', label: 'Unconscious' },
  { value: 'NOT_BREATHING', label: 'Not breathing' },
  { value: 'BLEEDING', label: 'Bleeding' },
  { value: 'IN_PAIN', label: 'In pain' },
  { value: 'UNKNOWN', label: 'Not sure' },
];
export const SEXES = [
  { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' },
  { value: 'OTHER', label: 'Other' }, { value: 'UNKNOWN', label: 'Not sure' },
];
export const STATUS_LABELS = {
  PENDING: 'Waiting', ACKNOWLEDGED: 'Acknowledged', EN_ROUTE: 'On the way',
  ON_SCENE: 'On scene', RESOLVED: 'Resolved', CANCELLED: 'Cancelled',
};
export const labelOf = (list, value) => list.find((o) => o.value === value)?.label || value;

export const CATEGORY_ICONS = {
  MEDICAL_EMERGENCY: 'medkit', INJURY: 'bandage', FAINTING: 'pulse',
  ALLERGIC_REACTION: 'warning', MENTAL_HEALTH_CRISIS: 'heart', OTHER: 'ellipsis-horizontal',
};
export const CRITICAL_STATUSES = ['UNCONSCIOUS', 'NOT_BREATHING', 'BLEEDING'];
