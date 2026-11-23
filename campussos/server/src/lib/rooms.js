// Socket.IO room names used for incident events.

export const RESPONDERS_ROOM = 'responders';

export const userRoom = (userId) => `user:${userId}`;
export const deviceRoom = (deviceId) => `device:${deviceId}`;

// Returns the reporter's id whether `reporter` is a populated User document,
// an ObjectId, or a plain id string. Returns null when there is no reporter.
function reporterId(reporter) {
  if (reporter == null) return null;
  const id = typeof reporter === 'object' && reporter._id != null ? reporter._id : reporter;
  const str = String(id);
  return str ? str : null;
}

// Rooms that should receive `incident:update` for an updated incident:
// always the responders room, the reporter's user room when a reporter exists,
// and the device room when the incident has a stored Device_ID.
export function updateTargets(incident) {
  const targets = [RESPONDERS_ROOM];
  const uid = reporterId(incident?.reporter);
  if (uid) targets.push(userRoom(uid));
  const deviceId = incident?.deviceId;
  if (typeof deviceId === 'string' && deviceId.length > 0) targets.push(deviceRoom(deviceId));
  return targets;
}
