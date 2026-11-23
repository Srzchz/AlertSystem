import mongoose from 'mongoose';

export const CATEGORIES = [
  'MEDICAL_EMERGENCY', 'INJURY', 'FAINTING', 'ALLERGIC_REACTION', 'MENTAL_HEALTH_CRISIS', 'OTHER',
];
export const PATIENT_STATUSES = [
  'CONSCIOUS_BREATHING', 'CONFUSED', 'UNCONSCIOUS', 'NOT_BREATHING', 'BLEEDING', 'IN_PAIN', 'UNKNOWN',
];
export const STATUSES = ['PENDING', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SCENE', 'RESOLVED', 'CANCELLED'];

const incidentSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // empty for unmatched SMS
    forSelf: { type: Boolean, default: true }, // SOS as patient vs. SOS for others
    patient: {
      name: String,
      sex: { type: String, enum: ['M', 'F', 'OTHER', 'UNKNOWN'], default: 'UNKNOWN' },
      age: Number,
    },
    nature: { type: String, trim: true }, // nature of accident, free text
    category: { type: String, enum: CATEGORIES, required: true },
    patientStatus: { type: String, enum: PATIENT_STATUSES, default: 'UNKNOWN' },
    location: {
      lat: Number,
      lng: Number,
      accuracy: Number,
      description: String, // e.g. "Near gym entrance"
    },
    source: { type: String, enum: ['APP', 'SMS'], default: 'APP' },
    status: { type: String, enum: STATUSES, default: 'PENDING' },
    acknowledgedAt: Date,
    resolvedAt: Date,
    responseTimeSec: Number, // createdAt -> acknowledgedAt
    outcome: { type: String, trim: true },
    notes: { type: String, trim: true },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

incidentSchema.index({ createdAt: -1 });
incidentSchema.index({ reporter: 1, createdAt: -1 });

export default mongoose.model('Incident', incidentSchema);
