# Requirements Document

## Introduction

The CampusSOS mobile app (`campussos-mobile`) currently opens to a combined login/register screen (`src/screens/LoginScreen.js`). After a successful login or registration, `src/AuthContext.js` stores a JWT session in SecureStore (localStorage on web), and the screens use that token:

- `SosFormScreen` sends `POST /api/incidents` with `Authorization: Bearer <token>`.
- `LogScreen` loads `GET /api/incidents/mine` with the token.
- `TipsScreen` opens a Socket.IO connection with `auth: { token }` to receive `incident:update` events for the sent alert.
- `HomeScreen` greets the user by `user.name` and has a log-out button.

On the server (`campussos/server`), `routes/incidents.js` applies `requireAuth` to every incident route and sets `reporter: req.user._id`. The Socket.IO middleware in `src/index.js` rejects connections without a valid JWT and puts each socket in a `user:<id>` room. The web dashboard (`campussos/web`) logs responders/admins in through the same `/api/auth/login` route and uses the same JWT for `GET/PATCH /api/incidents` and the responder socket room.

This feature removes the login and register flow from the mobile app so the app opens directly to the Home screen. The mobile app must still send SOS alerts, show the reporter's own incident log, and show live status updates. The web dashboard login and all responder-only endpoints must keep working unchanged.

**Working assumption (see Open Questions):** without accounts, the mobile app identifies itself with an anonymous identifier generated on first launch and stored on the device (the Device_ID). The server links app-submitted incidents to that Device_ID instead of to a User.

## Glossary

- **Mobile_App**: The Expo React Native app in `campussos-mobile`.
- **Server**: The Express + Socket.IO backend in `campussos/server`.
- **Web_Dashboard**: The responder/admin web app in `campussos/web`.
- **Device_ID**: A random identifier (for example a UUID v4) that the Mobile_App generates once per installation and keeps in persistent device storage. The Device_ID identifies the reporting device in place of a user account.
- **Device_Store**: The persistent key-value storage the Mobile_App uses on the current platform (SecureStore on iOS/Android, localStorage on web).
- **Home_Screen**: The Mobile_App screen with the SOS button, the "Someone else needs help" tile, and the "My incident log" tile.
- **Incident**: A record in the Server's `Incident` collection representing one SOS alert.
- **App_Incident**: An Incident with `source: 'APP'` submitted by the Mobile_App.
- **Responder_Account**: A User with role `responder` or `admin`, used to sign in to the Web_Dashboard.
- **Responder_Endpoints**: `GET /api/incidents` and `PATCH /api/incidents/:id`.
- **Mobile_Endpoints**: The Server endpoints the Mobile_App calls to create an App_Incident and to list the incidents of a Device_ID.
- **Status_Socket**: The Socket.IO connection the Mobile_App's Tips screen opens to receive `incident:update` events.
- **SMS_Fallback**: The existing offline path in `SosFormScreen` that opens a pre-filled SMS to the infirmary number.

## Requirements

### Requirement 1: Open directly to the Home screen

**User Story:** As a student in an emergency, I want the app to open straight to the SOS button, so that I can ask for help without creating an account or logging in.

#### Acceptance Criteria

1. WHEN the Mobile_App starts, THE Mobile_App SHALL show the Home_Screen, with the SOS button, the "Someone else needs help" tile, and the "My incident log" tile visible, as the first screen, without first showing a login screen, a register screen, or a loading indicator that waits on a user session check.
2. THE Mobile_App SHALL register exactly four screens in its navigation stack, named Home, SosForm, Tips, and Log, and SHALL register these four screens regardless of whether any user session data exists on the device.
3. THE Mobile_App SHALL contain no LoginScreen module, and no navigation action anywhere in the Mobile_App (including the back action on the Home_Screen) SHALL lead to a login or register screen.
4. THE Mobile_App SHALL contain no login, register, or logout functions in its client code, and no screen of the Mobile_App SHALL display a login, register, or logout control.
5. WHEN the Mobile_App starts, THE Mobile_App SHALL make zero requests to `/api/auth/login`, `/api/auth/register`, or `/api/auth/me`.
6. WHILE the Mobile_App is running, THE Mobile_App SHALL make zero requests to `/api/auth/login`, `/api/auth/register`, or `/api/auth/me` in response to any user action on the Home, SosForm, Tips, or Log screens.
7. IF session data saved by an earlier version of the Mobile_App (such as a stored login token or user record) is present on the device at startup, THEN THE Mobile_App SHALL still show the Home_Screen as the first screen and SHALL make zero requests to the auth endpoints listed in criterion 5.
8. IF the server is unreachable when the Mobile_App starts, THEN THE Mobile_App SHALL still show the Home_Screen as the first screen with the SOS button visible.

### Requirement 2: Home screen without account data

**User Story:** As a student, I want the Home screen to work without my account details, so that the screen still looks complete when no one is logged in.

#### Acceptance Criteria

1. THE Home_Screen SHALL display a fixed greeting heading that contains no user name, email address, or other account field, with the subtitle "Stay calm. Help is one tap away." shown directly below it.
2. THE Home_Screen SHALL NOT display a log-out button, any control with the accessibility label "Log out", or the log-out confirmation dialog.
3. THE Home_Screen SHALL display the CampusSOS brand header, the SOS button, the "Someone else needs help" tile, the "My incident log" tile, and the offline SMS information note, in that top-to-bottom order.
4. IF no user session or account data exists on the device, THEN THE Home_Screen SHALL render every element listed in criteria 1 and 3 without a crash, an error message, a blank screen, or an empty placeholder where a user name used to appear.
5. WHEN the student taps the SOS button, THE Home_Screen SHALL open the SOS form for the student's own emergency (the self-report flow).
6. WHEN the student taps the "Someone else needs help" tile, THE Home_Screen SHALL open the SOS form for reporting another person, and WHEN the student taps the "My incident log" tile, THE Home_Screen SHALL open the incident log screen.

### Requirement 3: Anonymous device identity

**User Story:** As a student, I want my phone to be recognized between app launches, so that my past alerts and live status updates still belong to me without an account.

#### Acceptance Criteria

1. WHEN the Mobile_App starts and the Device_Store contains no Device_ID, THE Mobile_App SHALL generate a new Device_ID as a random UUID version 4 in the 36-character lowercase hyphenated form (8-4-4-4-12 hexadecimal digits) and save the Device_ID in the Device_Store.
2. WHEN the Mobile_App starts and the Device_Store contains a Device_ID that is a valid UUID version 4 string, THE Mobile_App SHALL reuse the stored Device_ID without generating a new value.
3. IF the Mobile_App starts and the Device_Store contains a Device_ID value that is not a valid UUID version 4 string, THEN THE Mobile_App SHALL generate a new Device_ID, overwrite the invalid value in the Device_Store, and use the new Device_ID.
4. THE Mobile_App SHALL use the same Device_ID value across every restart of the same installation, so that a Device_ID saved to the Device_Store and then loaded on the next launch is identical character for character.
5. IF a Device_Store read or write fails, or does not complete within 3 seconds, THEN THE Mobile_App SHALL generate one in-memory Device_ID, use that same value for every request until the app is closed, keep the SOS flow available without showing a blocking error, and attempt the Device_Store read again on the next launch.
6. WHEN the Mobile_App starts, THE Mobile_App SHALL finish resolving the Device_ID (stored, newly generated, or in-memory) before it sends its first SOS alert or status request to the server.
7. WHEN the Mobile_App starts, THE Mobile_App SHALL delete any saved `session` entry left in the Device_Store by the previous login flow, and SHALL leave the stored Device_ID unchanged.
8. IF deleting the saved `session` entry fails, THEN THE Mobile_App SHALL continue startup with the SOS flow available, show no error to the user, and try the deletion again on the next launch.

### Requirement 4: Submit SOS alerts without login

**User Story:** As a student, I want to send an SOS from the app without logging in, so that responders get my alert immediately.

#### Acceptance Criteria

1. WHEN the user sends an SOS while the device has network connectivity, THE Mobile_App SHALL submit the alert to the Mobile_Endpoints with the Device_ID, category, location (`lat`, `lng`, and optional `accuracy` and `description`), `forSelf`, patient details, nature, and patient status, and without a JWT or any login step.
2. WHEN the Server receives a valid App_Incident submission that includes a Device_ID, THE Server SHALL create an Incident with `source: 'APP'`, `status: 'PENDING'`, no reporter user, and the submitted Device_ID, and SHALL respond with HTTP 201 and the created Incident.
3. WHEN the Server creates an App_Incident, THE Server SHALL emit `incident:new` to the `responders` room with the same payload shape the Web_Dashboard receives today, with the reporter field empty and the Device_ID included.
4. IF an App_Incident submission has a missing Device_ID, a Device_ID that is not a string, a Device_ID that is empty after trimming whitespace, or a Device_ID longer than 128 characters, THEN THE Server SHALL respond with HTTP 400 and an error message indicating the Device_ID is missing or invalid, and SHALL NOT create an Incident or emit `incident:new`.
5. IF an App_Incident submission has a category outside the Incident categories, or a location without numeric `lat` and `lng`, THEN THE Server SHALL respond with HTTP 400 and the existing error messages ("Choose an alert category" for the category check, "Location is required" for the location check), and SHALL NOT create an Incident or emit `incident:new`.
6. WHEN the Server receives an App_Incident submission with `forSelf` set to `true` or omitted, THE Server SHALL store `forSelf: true` and the submitted patient details (sex, age, and name if provided) without requiring a patient name.
7. WHILE the device has no network connectivity, THE Mobile_App SHALL keep the existing SMS_Fallback behavior and SHALL NOT attempt to submit to the Mobile_Endpoints.
8. IF an online SOS submission fails because of a network error, an HTTP 5xx response, or no response within 10 seconds, THEN THE Mobile_App SHALL show an error indicating the alert was not delivered, SHALL keep the entered SOS details, and SHALL offer the SMS_Fallback pre-filled with those details.
9. WHEN the Mobile_App receives an HTTP 201 response for an SOS submission, THE Mobile_App SHALL show a confirmation that the alert was sent.
10. THE Server SHALL continue to require a valid responder or admin JWT for listing all Incidents and for updating Incident status, outcome, or notes. Removing login applies only to the Mobile_Endpoints.

### Requirement 5: Incident log per device

**User Story:** As a student, I want to see my past alerts on this phone, so that I can check their status and response time.

#### Acceptance Criteria

1. WHEN the Log screen opens, THE Mobile_App SHALL send one incident-log request for the Device_ID stored on the phone to the Mobile_Endpoints, without a JWT or any other login credential.
2. WHEN the Server receives an incident-log request with a non-empty Device_ID, THE Server SHALL return only Incidents whose stored Device_ID exactly equals the requested Device_ID (case-sensitive), sorted by creation time newest first, limited to the 100 most recent items, without requiring a JWT.
3. FOR ALL App_Incidents created with a Device_ID, an incident-log request sent after the create request has succeeded, with the same Device_ID, SHALL include that Incident with the same identifier, category and status (create/list round-trip).
4. IF an incident-log request has a missing Device_ID, or a Device_ID that is empty or contains only whitespace, THEN THE Server SHALL respond with HTTP 400 and an error message indicating that a Device_ID is required, and SHALL return no Incidents.
5. WHEN the Mobile_App receives the incident-log response, THE Mobile_App SHALL display one entry per returned Incident in the order received, and each entry SHALL show the Incident's category, creation date and time, current status (one of PENDING, ACKNOWLEDGED, EN_ROUTE, ON_SCENE, RESOLVED, CANCELLED), and response time in seconds or a "not yet acknowledged" indicator if the Incident has no response time.
6. IF the incident-log response contains zero Incidents, THEN THE Mobile_App SHALL display an empty-state message indicating that no alerts have been sent from this phone.
7. IF the incident-log request fails because of a network error, a non-success response, or no response within 15 seconds, THEN THE Mobile_App SHALL display an error message indicating the log could not be loaded, SHALL offer a retry action that resends the request, and SHALL NOT send any new alert or change any Incident.

### Requirement 6: Live status updates without login

**User Story:** As a student who sent an alert, I want to see when responders acknowledge it and are on the way, so that I know help is coming.

#### Acceptance Criteria

1. WHEN the Tips screen opens for an alert sent through the app, THE Mobile_App SHALL open the Status_Socket with the same Device_ID that was submitted with that alert and without a JWT.
2. WHEN the Server accepts a Status_Socket connection that carries a Device_ID and no valid JWT, THE Server SHALL add the socket only to the room for that Device_ID and SHALL NOT add it to the `responders` room or to any `user:<id>` room.
3. WHEN a responder successfully updates an App_Incident that has a stored Device_ID through `PATCH /api/incidents/:id`, THE Server SHALL emit `incident:update` with the updated Incident, including its current status (one of PENDING, ACKNOWLEDGED, EN_ROUTE, ON_SCENE, RESOLVED, CANCELLED), to the room for that Incident's Device_ID within 2 seconds of the update being saved, in addition to the existing emits to the `responders` room and the reporter's `user:<id>` room.
4. IF a socket connection has neither a valid JWT nor a Device_ID, where a Device_ID that is missing, empty, or longer than 128 characters counts as no Device_ID, THEN THE Server SHALL reject the connection with an unauthorized error and SHALL NOT add the socket to any room.
5. IF a socket connection carries a valid JWT, THEN THE Server SHALL add the socket to the `user:<id>` room for that JWT's user and, for the responder or admin role, to the `responders` room, in the same way as before this change.
6. IF the `PATCH /api/incidents/:id` request fails (for example, the Incident is not found) or the updated Incident has no stored Device_ID (including SMS incidents), THEN THE Server SHALL NOT emit `incident:update` to any Device_ID room.
7. WHEN the Mobile_App receives `incident:update` on the Status_Socket for the Incident shown on the Tips screen, THE Mobile_App SHALL display that Incident's new status on the Tips screen within 2 seconds and SHALL ignore `incident:update` events for any other Incident.

### Requirement 7: Keep the web dashboard and responder access unchanged

**User Story:** As an infirmary responder, I want the web dashboard login and incident management to keep working, so that I can still receive and handle alerts.

#### Acceptance Criteria

1. THE Server SHALL keep the `/api/auth/login`, `/api/auth/register`, and `/api/auth/me` routes with their current behavior: login with a matching email and password returns a JWT that is valid for 7 days plus the User's id, name, email, phone and role; login with a wrong email or password returns HTTP 401; register always creates a User with the normal user role; `/api/auth/me` returns the current User for a valid JWT.
2. WHEN a request to a Responder_Endpoint carries a valid, unexpired JWT for an active Responder_Account (a User whose role is responder or admin), THE Server SHALL process the request and return the same response as the current implementation.
3. IF a request to a Responder_Endpoint has no JWT, an invalid or expired JWT, or a JWT for a User that no longer exists or is inactive, THEN THE Server SHALL respond with HTTP 401, return an error message saying the caller is not authenticated, and leave all Incidents unchanged.
4. IF a request to a Responder_Endpoint carries a valid JWT for an active User whose role is neither responder nor admin, THEN THE Server SHALL respond with HTTP 403, return an error message saying the action is not allowed, and leave all Incidents unchanged.
5. WHEN a Responder_Account connects a socket with a valid JWT, THE Server SHALL add the socket to the `responders` room and to that User's own `user:<id>` room, and THE Server SHALL add a socket from a User of any other role only to that User's own `user:<id>` room.
6. IF a socket connection attempt has neither a valid JWT nor a valid Device_ID, THEN THE Server SHALL reject the connection with an unauthorized error and SHALL NOT add the socket to any room.
7. THE Server SHALL include the reporter Device_ID in every Incident payload sent to the Web_Dashboard (the GET /api/incidents response, the PATCH /api/incidents/:id response, and the `incident:new` and `incident:update` socket events), and THE Server SHALL set the `reporter` field to null in those payloads for App_Incidents that have no linked User.
8. WHEN a Responder_Account updates the status, outcome or notes of an App_Incident that has no linked User through PATCH /api/incidents/:id, THE Server SHALL save the change, return the updated Incident, and emit `incident:update` to the `responders` room without returning an error, even though no `user:<id>` room is notified.
9. WHEN the Web_Dashboard shows an App_Incident without a linked User, in the live alert popup, the incident list or the records page, THE Web_Dashboard SHALL show a reporter label identifying an anonymous mobile reporter in place of the reporter name, and SHALL NOT show an empty reporter field, a missing-value placeholder such as "undefined" or "null", or a rendering error.

### Requirement 8: Existing data and SMS intake

**User Story:** As a maintainer, I want existing records and the SMS webhook to keep working, so that the change does not lose history.

#### Acceptance Criteria

1. WHEN a responder or admin requests Incidents through the Responder_Endpoints, THE Server SHALL return every Incident that existed before the change and matches the request's status, category, and date-range filters, ordered newest first, capped at 500 Incidents per response, with each Incident's category, patient status, status, location, source, timestamps, response time, outcome, and notes identical to their stored values, and with the `reporter` field populated with the referenced User's name, phone, and email.
2. WHEN the `/api/sms/inbound` webhook receives a request carrying the configured webhook secret and a message in the format `SOS|CATEGORY|PATIENT_STATUS|SEX|AGE|lat,lng|note`, THE Server SHALL create one Incident with source SMS, map unrecognized category, patient status, and sex values to OTHER, UNKNOWN, and UNKNOWN respectively, set `reporter` to the User whose phone number equals the sender number (or leave `reporter` empty when no User matches), broadcast the new Incident to connected responders, and return a success response containing the new Incident's identifier, exactly as it did before the change.
3. IF an existing Incident has no `reporter` or its `reporter` references a User that no longer exists, THEN THE Server SHALL still include that Incident in Responder_Endpoints responses with an empty reporter and SHALL complete the request without an error.
4. IF the `/api/sms/inbound` webhook receives a request with a missing or incorrect webhook secret, or a message whose first segment is not `SOS` (case-insensitive), THEN THE Server SHALL reject the request with an error response indicating the reason and SHALL NOT create an Incident or broadcast to responders.
5. THE Server SHALL NOT delete or modify any stored Incident as part of the change, so the count of stored Incidents and the field values of each Incident before and after the change are equal.

## Open Questions

1. **Reporter identity.** With login gone, the infirmary no longer sees the reporter's name, phone, or email for app alerts. Options:
   - (a) Anonymous Device_ID only (the assumption in this document). Simplest; responders see no contact details.
   - (b) Device_ID plus an optional one-time "profile" form in the app (name, phone, student ID) stored on the device and sent with each SOS. Responders get contact info without accounts.
   - (c) Keep accounts on the server but auto-create a hidden "device user" per installation. Fits the current `reporter` model but adds server-side user records nobody logs into.
   Which option do you want?
2. **Abuse protection.** Unauthenticated `POST /api/incidents` lets anyone who can reach the Server create alerts. Is that acceptable for this project, or should the Server add a rate limit per Device_ID/IP or a shared app key?
3. **Privacy of the incident log.** Anyone who knows a Device_ID could read that device's incident log. Is a random UUID enough for this project, or should the log endpoint need a separate device secret?
4. **Public registration route.** The Web_Dashboard does not use `/api/auth/register` (responder accounts come from the seed script). Should the route stay (as written here) or be removed since the mobile app no longer calls it?
5. **Existing logged-in installs.** Incidents created before this change are linked to a User, not a Device_ID, so they will not appear in the new per-device log. Is losing that history in the app acceptable?
