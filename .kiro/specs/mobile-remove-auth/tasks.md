# Implementation Plan: mobile-remove-auth

## Overview

The work runs server first, then the web dashboard, then the mobile app. On the server, pure helpers (`normalizeDeviceId`, `buildAppIncident`, `updateTargets`, `resolveSocketRooms`) come first, then the Incident model change, the `app.js`/`index.js` split, and the incident routes. The web dashboard gets `reporterLabel`. On the mobile app, the new Device_ID, storage, API, and SMS modules are built next to the existing auth code, the screens move over to them one at a time, and the last step removes `LoginScreen`, `AuthContext`, and the Login route from `App.js`.

All code is JavaScript (ES modules), matching the existing packages. Test tooling: server `node --test` + fast-check + supertest + mongodb-memory-server + socket.io-client; mobile Jest (`jest-expo`) + fast-check + React Native Testing Library; web Vitest + fast-check. Each property test runs at least 100 iterations and carries the comment `// Feature: mobile-remove-auth, Property {n}: {title}`.

## Tasks

- [x] 1. Set up server test tooling
  - [x] 1.1 Add server dev dependencies and test script
    - In `campussos/server/package.json`, add dev dependencies `fast-check`, `supertest`, `mongodb-memory-server`, `socket.io-client`
    - Add `"test": "node --test"` script; create `campussos/server/test/` for test files
    - _Requirements: 4.2, 5.2_

- [x] 2. Implement server pure helpers
  - [x] 2.1 Create `campussos/server/src/lib/deviceId.js`
    - Export `DEVICE_ID_MAX = 128` and `normalizeDeviceId(value)`: return the trimmed string if `typeof value === 'string'` and its trimmed length is 1–128, else `null`
    - _Requirements: 4.4, 5.4, 6.4_

  - [x] 2.2 Create `campussos/server/src/lib/incidentInput.js`
    - Export `buildAppIncident(body)` returning `{ ok: true, doc }` or `{ ok: false, error }`
    - Validation order and messages: `'Device ID is missing or invalid'`, `'Choose an alert category'` (category not in the Incident `CATEGORIES`), `'Location is required'` (non-numeric `lat`/`lng`)
    - Build `doc` with `deviceId` (normalized), `forSelf: body.forSelf !== false`, `patient` picked to `name`/`sex`/`age`, `nature`, `category`, `patientStatus`, `location` picked to `lat`/`lng`/`accuracy`/`description`, `source: 'APP'`, `status: 'PENDING'`; never set `reporter`, `handledBy`, or timestamps
    - _Requirements: 4.2, 4.4, 4.5, 4.6_

  - [x]* 2.3 Write property test for valid submissions
    - **Property 4: Valid app submissions build an anonymous APP incident**
    - **Validates: Requirements 4.2, 4.6**

  - [x]* 2.4 Write property test for invalid category or location
    - **Property 6: Invalid category or location is rejected with the existing messages**
    - **Validates: Requirements 4.5**

  - [x] 2.5 Create `campussos/server/src/lib/rooms.js`
    - Export `deviceRoom(deviceId)` returning `device:<deviceId>`
    - Export `updateTargets(incident)`: always `'responders'`, plus `user:<reporterId>` when a reporter exists (populated doc or ObjectId), plus `device:<deviceId>` when a stored Device_ID exists
    - _Requirements: 6.3, 6.6, 7.8_

  - [x]* 2.6 Write property test for update emit targets
    - **Property 12: Update emit targets**
    - **Validates: Requirements 6.3, 6.6, 7.8**

- [x] 3. Update the Incident model
  - [x] 3.1 Add `deviceId`, index, and `toJSON` transform in `campussos/server/src/models/Incident.js`
    - Add `deviceId: { type: String, trim: true, maxlength: 128 }`
    - Add `incidentSchema.index({ deviceId: 1, createdAt: -1 })`
    - Add a `toJSON` transform that sets `reporter` to `null` when missing or unresolved, and `deviceId` to `null` when absent; keep all existing fields and enums unchanged
    - _Requirements: 4.3, 7.7, 8.3, 8.5_

  - [x]* 3.2 Write property test for incident payload shape
    - **Property 14: Incident payload shape**
    - Cover APP and SMS documents, with and without a Device_ID, with a populated reporter, no reporter, and a reporter that populates to `null` (deleted User)
    - **Validates: Requirements 4.3, 7.7, 8.3**

- [x] 4. Split server startup and move socket auth
  - [x] 4.1 Create `campussos/server/src/socket.js`
    - Export `resolveSocketRooms(auth, verifyToken)`: valid token → `{ kind: 'user', user, rooms: ['user:<id>', + 'responders' for responder/admin] }`; else valid `normalizeDeviceId(auth.deviceId)` → `{ kind: 'device', deviceId, rooms: ['device:<id>'] }`; else `null`
    - Export `attachSocketAuth(io)`: in `io.use` store the result on `socket.data` or call `next(new Error('unauthorized'))`; in `io.on('connection')` join `socket.data.rooms`. Add no client-to-server handlers
    - _Requirements: 6.2, 6.4, 6.5, 7.5, 7.6_

  - [x]* 4.2 Write property test for socket room assignment
    - **Property 11: Socket room assignment**
    - Use a verifier stub that returns a generated `{ id, role }` for a marked valid token and throws otherwise
    - **Validates: Requirements 6.2, 6.4, 6.5, 7.5, 7.6**

  - [x] 4.3 Create `campussos/server/src/app.js` and slim down `src/index.js`
    - `createApp()` builds Express, CORS, JSON parsing, the auth/incidents/sms routes, the existing error handler, the HTTP server, and Socket.IO with `attachSocketAuth`; returns `{ app, server, io }`
    - `index.js` loads env, calls `createApp()`, connects MongoDB, and listens, with the same startup behavior as today
    - _Requirements: 7.1, 7.5, 8.2_

- [x] 5. Update incident routes
  - [x] 5.1 Rewrite route auth and handlers in `campussos/server/src/routes/incidents.js`
    - Remove `router.use(requireAuth)`; put `requireAuth` and `requireRole('responder','admin')` on `GET /` and `PATCH /:id` only, with their query, populate, and update logic unchanged
    - `POST /`: no auth; use `buildAppIncident`, respond 400 on `{ ok: false }`, else create, populate `reporter`, emit `incident:new` to `responders`, respond 201. Remove copying `req.user.name` into `patient.name`
    - `GET /mine`: no auth; `normalizeDeviceId(req.get('X-Device-Id'))`; null → 400 `'Device ID is required'`; else `Incident.find({ deviceId }).sort({ createdAt: -1 }).limit(100)`
    - `PATCH /:id`: after `save()` succeeds, emit `incident:update` to each room from `updateTargets(incident)`; emit nothing on 404 or errors
    - Never log the Device_ID
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.10, 5.2, 5.4, 6.3, 6.6, 7.2, 7.3, 7.4, 7.8_

  - [x]* 5.2 Write property test for invalid Device_IDs
    - **Property 5: Invalid Device_IDs are rejected**
    - Check `normalizeDeviceId`, `buildAppIncident`, and `GET /api/incidents/mine` (supertest against `createApp()` with mongodb-memory-server)
    - **Validates: Requirements 4.4, 5.4**

  - [x]* 5.3 Write property test for per-device incident log
    - **Property 9: Incident log returns only that device's incidents**
    - Include Device_IDs that differ only in letter case and sets larger than 100; clear the collection at the start of each run
    - **Validates: Requirements 5.2**

  - [x]* 5.4 Write property test for create/list round trip
    - **Property 10: Create/list round trip**
    - **Validates: Requirements 5.3**

  - [x]* 5.5 Write server integration tests for incidents and sockets
    - Valid POST returns 201 and a responder socket receives `incident:new` with `reporter: null` and `deviceId`
    - Invalid Device_ID, category, or location returns 400 and the Incident count is unchanged
    - Responder routes: no token, bad token, expired token, inactive user → 401; `user` role → 403; responder → 200 with the previous body shape
    - PATCH on a Device_ID incident reaches a device socket within 2 seconds and the responder socket; PATCH on an SMS incident without Device_ID and a 404 PATCH emit nothing to device rooms
    - A device socket does not receive `incident:new`
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.10, 6.2, 6.3, 6.6, 7.2, 7.3, 7.4, 7.8_

  - [x]* 5.6 Write server regression tests for auth, legacy data, and SMS
    - Auth: login success and wrong password, register creates role `user`, `/me` with a valid token
    - Legacy incidents with reporters: filters, newest-first order, 500 cap, populated reporter; an incident whose reporter User was deleted returns `reporter: null`
    - SMS webhook: matching phone, unmatched phone, bad secret, non-SOS prefix
    - Smoke: insert legacy incidents, start the app (index build), and compare all documents before and after
    - _Requirements: 7.1, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 6. Checkpoint - Ensure all server tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update the web dashboard reporter label
  - [x] 7.1 Add `reporterLabel` and use it in the dashboard
    - In `campussos/web/src/labels.js`, export `ANONYMOUS_REPORTER = 'Anonymous mobile reporter'` and `reporterLabel(incident)`: non-empty `reporter.name` → name; else `source === 'APP'` → `ANONYMOUS_REPORTER`; else `'Unregistered number'`
    - `src/components/AlertPopup.jsx`: "Reported by" uses `reporterLabel(incident)`; "Contact" stays `reporter?.phone || '-'`
    - `src/pages/Records.jsx`: name column becomes `i.patient?.name || reporterLabel(i)`
    - Leave login, API calls, and the responder socket unchanged
    - _Requirements: 7.9_

  - [x]* 7.2 Add Vitest and write property test for reporter label
    - Add `vitest` and `fast-check` dev dependencies and a `"test": "vitest --run"` script to `campussos/web/package.json`
    - **Property 15: Web reporter label is never blank**
    - Add one example each for APP, SMS, and populated-reporter incidents
    - **Validates: Requirements 7.9**

- [x] 8. Build mobile Device_ID foundation
  - [x] 8.1 Install mobile dependencies and test tooling
    - Run `npx expo install expo-crypto jest-expo jest` in `campussos-mobile`; add dev dependencies `fast-check` and `@testing-library/react-native`
    - Add a `"test": "jest"` script and the `jest-expo` preset in `package.json`
    - Add Jest mocks for `expo-secure-store`, `expo-crypto`, `expo-sms`, `@react-native-community/netinfo`, and `socket.io-client`
    - _Requirements: 3.1_

  - [x] 8.2 Create `campussos-mobile/src/storage.js`
    - Extract the SecureStore / `localStorage` wrapper from `AuthContext.js` as `store.get`, `store.set`, `store.del`
    - Export `withTimeout(promise, ms)` that rejects with `{ timeout: true }` after `ms`
    - _Requirements: 3.1, 3.5_

  - [x] 8.3 Create `campussos-mobile/src/device/deviceId.js`
    - Export `DEVICE_ID_KEY = 'deviceId'`, `UUID_V4_RE`, `isUuidV4(value)`, `formatUuidV4(bytes)` (set version and variant bits, lowercase 8-4-4-4-12)
    - Export `resolveDeviceId({ store, randomBytes, timeoutMs = 3000 })`: reuse a valid stored ID; otherwise generate, write, and return it; on read/write failure or timeout return a fresh ID with `persisted: false`
    - No React Native imports in this module
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x]* 8.4 Write property test for UUID v4 formatting
    - **Property 1: UUID v4 formatting**
    - **Validates: Requirements 3.1**

  - [x]* 8.5 Write property test for stable Device_ID resolution
    - **Property 2: Device_ID resolution is stable**
    - Use an in-memory store seeded with missing, valid UUID v4, and arbitrary string values
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [x]* 8.6 Write property test for storage failure fallback
    - **Property 3: Storage failure falls back to one in-memory Device_ID**
    - Use Jest fake timers for the 3-second timeouts
    - **Validates: Requirements 3.5**

  - [x] 8.7 Create `campussos-mobile/src/DeviceContext.js` and mount it
    - Export `DeviceProvider` and `useDevice()` returning `{ getDeviceId }`; start one `resolveDeviceId` call on mount using `Crypto.getRandomValues(new Uint8Array(n))` and return the same promise on every call
    - On mount, call `store.del('session')` without awaiting and ignore errors; never touch the `deviceId` key
    - Render children immediately with no loading gate
    - In `App.js`, wrap the navigator in `DeviceProvider` (keep `AuthProvider` for now so the app keeps running until task 11.1)
    - _Requirements: 3.5, 3.6, 3.7, 3.8_

  - [x]* 8.8 Write unit tests for `DeviceProvider`
    - Deletes `session`, keeps `deviceId`, survives a failing delete, and returns the same ID to repeated `getDeviceId()` calls
    - _Requirements: 3.5, 3.7, 3.8_

- [x] 9. Update mobile API and SMS helpers
  - [x] 9.1 Update `campussos-mobile/src/api.js`
    - Remove the `token` option and `Authorization` header; accept `headers` and `timeoutMs` (via `AbortController`)
    - Tag errors with `kind`: `'network'` (also `offline: true`), `'timeout'`, or `'http'` with `status` and the server's `error` message
    - Export `isDeliveryFailure(err)`: true for `network`, `timeout`, or `http` with status >= 500
    - _Requirements: 4.1, 4.8, 5.1, 5.7_

  - [x]* 9.2 Write property test for delivery-failure classification
    - **Property 7: Delivery-failure classification**
    - **Validates: Requirements 4.8**

  - [x] 9.3 Create `campussos-mobile/src/sms.js`
    - Extract `buildSosSmsBody(details)` (same `SOS|CATEGORY|PATIENT_STATUS|SEX|AGE|lat,lng|note` format as today) and `openSmsFallback(details)` (`isAvailableAsync` + `sendSMSAsync`, with the existing "call the infirmary" alert when SMS is unavailable) from `SosFormScreen.js`
    - _Requirements: 4.7, 4.8_

  - [x]* 9.4 Write property test for SMS body round trip
    - **Property 8: SMS fallback body round trip**
    - Import `parseSosSms` from `campussos/server/src/routes/sms.js` by relative path, or copy it into a test fixture with a note if the cross-package import does not work under Jest
    - **Validates: Requirements 4.8**

- [x] 10. Move mobile screens off login
  - [x] 10.1 Update `campussos-mobile/src/screens/HomeScreen.js`
    - Remove `useAuth`, `confirmLogout`, the log-out button, and the `Alert` import
    - Show the fixed greeting "Hi there" with the subtitle "Stay calm. Help is one tap away." below it
    - Keep element order and navigation targets (`SosForm {forSelf: true}`, `SosForm {forSelf: false}`, `Log`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 10.2 Update `campussos-mobile/src/screens/SosFormScreen.js`
    - Replace `useAuth` with `useDevice`; use `buildSosSmsBody`/`openSmsFallback` from `src/sms.js`
    - Offline (NetInfo): open SMS fallback and go to `Tips {via: 'sms'}` with no request
    - Online: `await getDeviceId()`, then `api('/incidents', { method: 'POST', timeoutMs: 10000, body: { deviceId, forSelf, patient, nature, category, patientStatus, location } })`
    - On 201: `navigation.replace('Tips', { category, incidentId, deviceId, via: 'app' })`
    - On `isDeliveryFailure`: keep form state and show "Alert not delivered" with "Try again" and "Send by SMS" (pre-filled with the current details); other errors show "Could not send alert" with the server message
    - _Requirements: 3.6, 4.1, 4.7, 4.8, 4.9_

  - [x] 10.3 Update `campussos-mobile/src/screens/TipsScreen.js`
    - Export pure `applyIncidentUpdate(currentStatus, incidentId, event)` and use it in the `incident:update` handler
    - Read `deviceId` from route params and connect with `io(API_URL, { auth: { deviceId }, transports: ['websocket'] })`; remove `useAuth` and the token
    - _Requirements: 6.1, 6.7_

  - [x]* 10.4 Write property test for Tips update filtering
    - **Property 13: Tips screen applies only matching updates**
    - **Validates: Requirements 6.7**

  - [x] 10.5 Update `campussos-mobile/src/screens/LogScreen.js`
    - Replace `useAuth` with `useDevice`; `load()` awaits `getDeviceId()` and calls `api('/incidents/mine', { headers: { 'X-Device-Id': deviceId }, timeoutMs: 15000 })`
    - Empty state: "No alerts yet" / "No alerts have been sent from this phone."
    - Error state: "Cannot load your log", the error message, and a Retry button that calls `load()`; keep pull-to-refresh
    - Keep each card's category, date and time, status pill, and the existing `dur(sec)` response-time format (`45s`, `2m 5s`); show "Not yet acknowledged" when `responseTimeSec` is null
    - _Requirements: 5.1, 5.5, 5.6, 5.7_

- [x] 11. Remove login and wire the final navigation
  - [x] 11.1 Finalize `campussos-mobile/App.js` and delete auth modules
    - Remove `AuthProvider`, the `ActivityIndicator` loading branch, and the `Login` screen; register exactly `Home`, `SosForm`, `Tips`, `Log` unconditionally with `initialRouteName="Home"` inside `DeviceProvider`
    - Delete `src/screens/LoginScreen.js` and `src/AuthContext.js`; remove any remaining imports of them
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x]* 11.2 Write app startup, navigation, and smoke tests
    - App renders Home first with the SOS button and both tiles and no loading indicator; repeat with an old `session` entry and with `fetch` rejecting; no fetch URL contains `/api/auth/`
    - Navigation state lists exactly `Home`, `SosForm`, `Tips`, `Log`
    - Smoke: `LoginScreen.js` and `AuthContext.js` do not exist; no client source contains `/auth/login`, `/auth/register`, or `logout`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x]* 11.3 Write mobile screen tests
    - Home: "Hi there" and subtitle shown, no "Log out" label, snapshot of element order, SOS and tiles navigate with the right params
    - SosForm: online body contains `deviceId` and all fields with no `Authorization` header, sent only after the Device_ID resolves; offline goes to SMS without fetch; 5xx and timeout show "Alert not delivered" with form values kept; 201 navigates to Tips with `via: 'app'`
    - Log: one request with `X-Device-Id`; cards for all six statuses and a null response time; empty state; error with Retry that resends
    - Tips: socket created with `auth: { deviceId }` and no token
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 3.6, 4.1, 4.7, 4.8, 4.9, 5.1, 5.5, 5.6, 5.7, 6.1_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirement clauses for traceability.
- The mobile app keeps `AuthProvider` mounted until task 11.1 so it stays runnable while screens move to `useDevice`.
- Property tests validate the universal properties in the design; unit, integration, and smoke tests cover UI, navigation, and regression of unchanged server behavior.
- Tests run once (no watch mode): server `npm test`, web `npm test` (`vitest --run`), mobile `npm test`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "7.1", "8.1"] },
    { "id": 1, "tasks": ["2.1", "2.5", "3.1", "7.2", "8.2", "9.1", "9.3"] },
    { "id": 2, "tasks": ["2.2", "2.6", "3.2", "4.1", "8.3", "9.2", "9.4", "10.1"] },
    { "id": 3, "tasks": ["2.3", "2.4", "4.2", "4.3", "8.4", "8.5", "8.6", "8.7"] },
    { "id": 4, "tasks": ["5.1", "8.8", "10.2", "10.3", "10.5"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "10.4", "11.1"] },
    { "id": 6, "tasks": ["5.5", "5.6", "11.2", "11.3"] }
  ]
}
```
