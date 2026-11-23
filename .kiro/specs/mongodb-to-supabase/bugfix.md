# Bugfix Requirements Document

## Introduction

The CampusSOS server (`campussos/server`) keeps user accounts and incidents in MongoDB through Mongoose. This change moves that storage to Supabase (hosted Postgres) and nothing else. The server keeps its own email/password login (bcrypt hashes, 7-day JWTs), Socket.IO keeps delivering `incident:new` and `incident:update`, and the web dashboard (`campussos/web`) and the Expo mobile app (`campussos-mobile`) keep working without code changes.

This document treats the MongoDB dependency as the defect:

- **Bug condition:** any operation that reads or writes users or incidents: server startup, the seed script, the auth routes, the JWT check on protected routes, the incident routes, and the SMS webhook. Two gaps also count: there is no way to copy the existing MongoDB data, and the committed `.env.example` holds a real MongoDB Atlas username and password.
- **Fix checking:** those operations use Supabase, and a one-time migration script copies the existing MongoDB data.
- **Preservation checking:** for every request, clients see the same routes, status codes, error messages, and payloads over HTTP and Socket.IO as today, and the seed script prints the same output. The only exceptions are the deliberate changes in 2.22 to 2.25.

Decisions this document makes:

- Migrated users and incidents keep their MongoDB ids. JWTs issued before the switch keep working until they expire, and incident ids that the dashboard or the mobile app already hold stay valid. Responders do not have to log in again.
- Re-running the migration never overwrites a row that is already in Supabase. The final run therefore happens after the MongoDB-backed server is stopped, so no change made between the copy and the switch is lost.

Out of scope: Supabase Auth, Supabase Realtime, any change to web or mobile code, and the unused `react-dom` dependency in the server's `package.json`.

Removing the Atlas connection string from `.env.example` does not remove it from git history. The exposed password has to be changed in MongoDB Atlas, or that database user deleted once the migration is done. That step happens in Atlas, outside this change.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the server starts THEN the system connects to MongoDB with `MONGODB_URI` before it accepts requests, and when the connection fails it logs "MongoDB connection failed:" and exits with code 1

1.2 WHEN `npm run seed` runs THEN the system looks up and creates the responder account in MongoDB

1.3 WHEN someone registers, logs in, or calls `GET /api/auth/me` THEN the system reads and writes user accounts in MongoDB, and the user `id` it returns and signs into the JWT is the MongoDB ObjectId

1.4 WHEN a request to a protected route carries a JWT THEN the system loads that user from MongoDB to check that the account exists and is active

1.5 WHEN the mobile app sends an SOS (`POST /api/incidents`) or loads its incident log (`GET /api/incidents/mine`) THEN the system writes and reads incidents in MongoDB

1.6 WHEN a responder lists incidents (`GET /api/incidents`) or updates one (`PATCH /api/incidents/:id`) THEN the system reads and writes incidents in MongoDB and fills in `reporter` and `handledBy` from MongoDB users

1.7 WHEN the SMS webhook (`POST /api/sms/inbound`) receives an SOS THEN the system matches the sender's phone number against MongoDB users and writes the incident to MongoDB

1.8 WHEN the existing MongoDB users and incidents need to move to Supabase THEN the system offers no way to copy them

1.9 WHEN someone reads the server's `.env.example` THEN they find a real MongoDB Atlas connection string with a username and password, on a line that has no `MONGODB_URI=` key, in a file that is committed and pushed to the remote and has no Supabase settings

1.10 WHEN `npm test` runs THEN the server tests need Mongoose and mongodb-memory-server, which downloads a MongoDB binary the first time it runs

1.11 WHEN a developer follows the README THEN it tells them to set up MongoDB (Atlas or local) and to edit `MONGODB_URI`

### Expected Behavior (Correct)

Clauses 2.1 to 2.11 answer 1.1 to 1.11 one to one. Clauses 2.12 to 2.18 are the migration rules, 2.19 to 2.21 cover credentials and database setup, and 2.22 to 2.25 are the only deliberate changes to what clients see.

2.1 WHEN the server starts THEN the system SHALL connect to Supabase using server-side environment settings and confirm it can query the users and incidents tables before it accepts requests. When that fails, it SHALL log "Supabase connection failed: <reason>" without any key or password and exit with code 1. It SHALL NOT need `MONGODB_URI` or a MongoDB driver to run.

2.2 WHEN `npm run seed` runs THEN the system SHALL look up and create the responder in the Supabase users table as described in 3.22, and SHALL exit when done

2.3 WHEN someone registers, logs in, or calls `GET /api/auth/me` THEN the system SHALL read and write user accounts in the Supabase users table, and SHALL return and sign the user's Supabase id, which for a migrated user is its MongoDB id

2.4 WHEN a request to a protected route carries a JWT THEN the system SHALL load that user from the Supabase users table by the token's `id`

2.5 WHEN the mobile app sends an SOS or loads its incident log THEN the system SHALL write and read incidents in the Supabase incidents table

2.6 WHEN a responder lists or updates incidents THEN the system SHALL read and write the Supabase incidents table and fill in `reporter` and `handledBy` from the Supabase users table

2.7 WHEN the SMS webhook receives an SOS THEN the system SHALL match the sender's phone number against the Supabase users table and write the incident to the Supabase incidents table

2.8 WHEN an operator runs the migration script with `MONGODB_URI` and the Supabase settings THEN the system SHALL copy the MongoDB users and incidents into Supabase following 2.12 to 2.18

2.9 WHEN someone reads the server's `.env.example` THEN it SHALL contain only placeholder values: the existing keys (`PORT`, `JWT_SECRET`, `CLIENT_ORIGIN`, `SMS_WEBHOOK_SECRET`, `SEED_RESPONDER_EMAIL`, `SEED_RESPONDER_PASSWORD`), the new Supabase settings, and a `MONGODB_URI=` placeholder marked as used only by the migration script, with no real host, username, password, or key

2.10 WHEN `npm test` runs THEN the suite SHALL run without internet access, without a Supabase project, and without a MongoDB server or binary download, and SHALL cover the scenarios in 3.25 plus the migration rules in 2.12 to 2.18

2.11 WHEN a developer follows the README THEN it SHALL explain how to create the Supabase project and tables, which server environment variables to set, how to run the seed, and how to run the one-time migration. For an existing install, it SHALL say to stop the MongoDB-backed server before the final migration run and start the Supabase-backed server after it. MongoDB SHALL appear only as the source of that migration. README sections that are not about the database stay as they are.

2.12 WHEN the migration script runs THEN the system SHALL only read from MongoDB, with no inserts, updates, deletes, or index builds

2.13 WHEN the migration script copies a user or incident THEN the system SHALL:
- keep its MongoDB id as its id;
- copy every field that today's schemas define, except Mongoose's `__v` version key, with the same value. This includes the bcrypt password hash, unchanged, so existing passwords keep working; `createdAt`, `updatedAt`, `acknowledgedAt`, and `resolvedAt` to the millisecond; `deviceId`; `active`; and the `reporter` and `handledBy` links;
- give each field that is missing from the MongoDB document the value the API shows for it today: `forSelf` true, `patient.sex` UNKNOWN, `patientStatus` UNKNOWN, `source` APP, `status` PENDING, `role` user, `active` true;
- leave out fields that today's schemas do not define, and name them in the report

2.14 WHEN a `reporter` or `handledBy` link points to a user that does not exist in MongoDB, or whose record was skipped under 2.17, THEN the system SHALL store the link as empty and count it in the report

2.15 WHEN a MongoDB user's email already belongs to a different user in Supabase (for example a responder created by running the seed first) THEN the system SHALL skip that MongoDB user, point every `reporter` and `handledBy` link to it at the Supabase user with the same email, and list the skip in the report

2.16 WHEN the migration script runs again THEN the system SHALL NOT create duplicates or overwrite anything: a user or incident whose id is already in Supabase stays as it is and counts as already present, and records added to MongoDB since the last run are copied

2.17 WHEN a record breaks a Supabase table rule (for example a category outside today's list) THEN the system SHALL skip that record, continue with the rest, and list its MongoDB id and the reason

2.18 WHEN the migration script finishes THEN the system SHALL print, separately for users and incidents, how many records were copied, already present, and skipped with an error, plus how many links were emptied or re-pointed. It SHALL exit with code 0 only when every record was copied or already present, and with a non-zero code when any record was skipped with an error or when it cannot connect to MongoDB or Supabase.

2.19 WHEN the server, the seed script, or the migration script connects to Supabase THEN the system SHALL read the credentials (service role key or database connection string) only from server-side environment variables. These values and `MONGODB_URI` SHALL NOT appear in the repository, in web or mobile code, in any API response or socket payload, or in any log line.

2.20 WHEN anyone calls the project's public Supabase API with the anon key, or as a signed-in Supabase Auth user, THEN the system SHALL return no rows from the users and incidents tables and SHALL reject inserts, updates, and deletes on them

2.21 WHEN someone prepares a new Supabase project THEN the repository SHALL contain the database setup to apply. That setup creates the users and incidents tables with the rules today's schemas enforce (required fields, allowed values, defaults, unique email, `deviceId` of at most 128 characters), indexes for newest-first listing of all incidents, by reporter, and by `deviceId`, and the access restrictions in 2.20.

2.22 WHEN a request value reaches a database query (filters, ids, `deviceId`, email, phone) THEN the system SHALL pass it only as a value, never as SQL or as a query operator. For example `GET /api/incidents?status[$ne]=PENDING` SHALL return an empty list, where today Mongoose treats it as a "not equal" filter.

2.23 WHEN `PATCH /api/incidents/:id` gets an id that matches no incident, in any format, THEN the system SHALL respond 404 `{ error: 'Incident not found' }` and emit nothing. Today an id that is not a valid MongoDB ObjectId gets 500.

2.24 WHEN an optional field holds an explicit null (for example a null GPS `accuracy` from the mobile app) THEN the system SHALL leave that key out of the payload, as it already does for fields that were never set, and SHALL stop sending Mongoose's internal `__v` key. Neither client reads `__v` or treats a missing key differently from null.

2.25 WHEN text sent to the API or copied by the migration contains the NUL character (U+0000), which Postgres text cannot store, THEN the system SHALL store and look up that text with the character removed, instead of failing the request or skipping the record

### Unchanged Behavior (Regression Prevention)

Everything below must behave exactly as it does today. Where a clause mentions storage, it means the Supabase tables.

3.1 WHEN the web dashboard and the mobile app talk to the switched server THEN the system SHALL CONTINUE TO serve them with no change to their code or configuration: the same base URL, routes, headers, request bodies, and socket handshake

3.2 WHEN any route is called (`GET /api/health`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/incidents`, `GET /api/incidents/mine`, `GET /api/incidents`, `PATCH /api/incidents/:id`, `POST /api/sms/inbound`) THEN the system SHALL CONTINUE TO return the same status codes and error messages as today, apart from 2.22 and 2.23

3.3 WHEN a request falls under one of the server-side criteria of the mobile-remove-auth spec (4.2 to 4.6, 4.10, 5.2 to 5.4, 6.2 to 6.6, 7.1 to 7.8, 8.1 to 8.4) THEN the system SHALL CONTINUE TO meet that criterion

3.4 WHEN someone registers THEN the system SHALL CONTINUE TO:
- respond 400 "Name, email and a password of 8+ characters are required" when the name, the email, or a password of at least 8 characters is missing;
- respond 409 "That email is already registered" when the email exists, ignoring letter case and surrounding spaces;
- store the name, email, and phone trimmed, the email in lowercase, a bcrypt hash (cost 10), role `user` whatever role the body asks for, and `active` true;
- respond 201 with `{ token, user }`

3.5 WHEN someone logs in THEN the system SHALL CONTINUE TO match the email ignoring letter case and surrounding spaces, check the password against the stored bcrypt hash, and respond 200 with `{ token, user }` on a match or 401 "Wrong email or password" otherwise. `user` is `{ id, name, email, phone, role }`, with `phone` left out when the user has none, and `GET /api/auth/me` returns the same object. The token is a JWT carrying `{ id, role }`, signed with `JWT_SECRET`, that expires after 7 days.

3.6 WHEN a request or socket carries a JWT issued before the switch for a migrated user THEN the system SHALL CONTINUE TO accept it until it expires, because the user keeps the same id

3.7 WHEN a protected route is called THEN the system SHALL CONTINUE TO respond:
- 401 "Not logged in" without a token;
- 401 "Session expired. Please log in again." for an invalid or expired token, or for any other error while checking it;
- 401 "Account unavailable" when the user is missing or inactive;
- 403 "Not allowed" when the role is not responder or admin

3.8 WHEN any response or socket event includes user data THEN the system SHALL CONTINUE TO leave out the password hash

3.9 WHEN a valid SOS reaches `POST /api/incidents` THEN the system SHALL CONTINUE TO store only the allowed fields, with `source` APP, `status` PENDING, no reporter, and the defaults `forSelf` true, `patient.sex` UNKNOWN, and `patientStatus` UNKNOWN, respond 201 with the incident, and emit `incident:new` to the responders room only

3.10 WHEN text is stored THEN the system SHALL CONTINUE TO trim `nature`, `outcome`, `notes`, and `deviceId`, keep an empty string as an empty string, and store all other text exactly as sent (subject to 2.25)

3.11 WHEN a value's JSON type differs from its field's type THEN the system SHALL CONTINUE TO convert it the way Mongoose does today (for example `"19"` becomes 19 for `patient.age`, and a number becomes text for `nature`), and a value that cannot be converted (for example `"abc"` for `patient.age`) SHALL CONTINUE TO fail with 500, with nothing stored and nothing emitted

3.12 WHEN a write breaks a rule that today's schemas enforce (a required value missing or empty after trimming; a value outside the allowed lists for category, patient status, status, sex, or role, which stay exactly as today; a `deviceId` over 128 characters; a duplicate email) THEN the system SHALL CONTINUE TO respond as today, with the route's own error when the route checks first and otherwise 500 "Something went wrong on the server", and SHALL store nothing, change nothing, and emit nothing

3.13 WHEN `GET /api/incidents/mine` is called THEN the system SHALL CONTINUE TO:
- respond 400 "Device ID is required" when `X-Device-Id` is missing or blank;
- otherwise return only the incidents whose `deviceId` exactly equals the trimmed header value (case-sensitive), newest first, at most 100;
- return `reporter` as a plain id or null and `handledBy` as a plain id or absent, without user details

3.14 WHEN a responder calls `GET /api/incidents` THEN the system SHALL CONTINUE TO:
- match `status` and `category` exactly, return an empty list for values that match nothing (including unknown values), and match any of the values when a filter is repeated;
- treat `from` and `to` as inclusive bounds on `createdAt`, and respond 500 when either cannot be parsed as a date;
- sort newest first and return at most 500 incidents;
- fill in `reporter` and `handledBy`

3.15 WHEN a responder PATCHes an existing incident THEN the system SHALL CONTINUE TO:
- set `status` when a non-empty status is sent;
- when a non-PENDING status is sent and `acknowledgedAt` is empty, set `acknowledgedAt` to now, `responseTimeSec` to round((acknowledgedAt − createdAt) / 1000), and `handledBy` to that responder, and never change these three afterwards;
- set `resolvedAt` to now every time the status sent is RESOLVED;
- set `outcome` and `notes` whenever they are present in the body;
- respond 200 with the incident, with `reporter` and `handledBy` filled in;
- only after the save, emit `incident:update` once to each of: the responders room, `user:<reporter id>` when there is a reporter, and `device:<deviceId>` when there is a `deviceId`

3.16 WHEN the SMS webhook is called THEN the system SHALL CONTINUE TO:
- respond 401 "Bad secret" when `x-webhook-secret` is missing or wrong;
- respond 400 "Not an SOS message" when the first segment is not SOS;
- parse the message fields and build the location description as today;
- link the user whose stored phone equals the trimmed sender number (the earliest-created one when several match, none when nothing matches);
- create one SMS incident and emit `incident:new` with `reporter` filled in;
- respond 201 with `{ ok: true, id }`, where `id` equals that incident's `_id`

3.17 WHEN the system sends an incident over HTTP or Socket.IO THEN it SHALL CONTINUE TO send the same keys and values as today, apart from 2.24, including:
- `_id` as a string, `patient` and `location` as nested objects, and `forSelf` as a boolean;
- `reporter` and `deviceId` always present, null when empty;
- `lat`, `lng`, `accuracy`, `age`, and `responseTimeSec` as JSON numbers with the same value, decimals included;
- timestamps as UTC ISO strings with milliseconds, exactly as `Date.prototype.toISOString` writes them (for example `2024-02-10T00:00:00.000Z`);
- the same JSON over HTTP and over Socket.IO for the same incident

3.18 WHEN an optional field was never set THEN the system SHALL CONTINUE TO leave its key out of the payload, for example `acknowledgedAt`, `responseTimeSec`, and `handledBy` before acknowledgement, `resolvedAt`, `outcome`, and `notes` before they are set, `nature` and `patient.age` when not given, and `location.lat` and `location.lng` on an SMS without GPS. `reporter` and `deviceId` are the exceptions (3.17).

3.19 WHEN `reporter` or `handledBy` is filled in THEN the system SHALL CONTINUE TO send `reporter` as `{ _id, name, phone, email }` (with `phone` left out when the user has none), or null when there is no user, and `handledBy` as `{ _id, name }`, where `_id` is the same id that user's JWT carries

3.20 WHEN `createdAt`, `updatedAt`, `acknowledgedAt`, or `resolvedAt` is recorded THEN the system SHALL CONTINUE TO keep millisecond precision, set `updatedAt` equal to `createdAt` on create, and change `updatedAt` only when an update changes a stored value

3.21 WHEN a socket connects THEN the system SHALL CONTINUE TO:
- check only the JWT's signature and expiry, without loading the user from the database;
- put a socket with a valid JWT in `user:<id>`, plus the responders room for the responder and admin roles;
- put a socket with a valid Device_ID and no valid JWT in `device:<deviceId>` only;
- reject anything else with "unauthorized"

3.22 WHEN `npm run seed` runs THEN the system SHALL CONTINUE TO:
- when no user has `SEED_RESPONDER_EMAIL` (ignoring letter case and surrounding spaces), create the responder with name "Infirmary Nurse", role responder, that email, and a bcrypt hash of `SEED_RESPONDER_PASSWORD`, and log "Created responder: <email>";
- otherwise log "Responder already exists: <email>" and change nothing

3.23 WHEN the server runs THEN the system SHALL CONTINUE TO:
- read `PORT` (default 4000), `JWT_SECRET`, `CLIENT_ORIGIN` (CORS for HTTP and Socket.IO), and `SMS_WEBHOOK_SECRET` as today;
- answer `GET /api/health` with `{ ok: true }`;
- deliver live events only through Socket.IO and authenticate with its own JWTs, with no Supabase Auth or Supabase Realtime

3.24 WHEN an unexpected error, including a database error, happens in a route THEN the system SHALL CONTINUE TO respond 500 "Something went wrong on the server" without database details. The JWT check is the exception and keeps the 401 from 3.7.

3.25 WHEN the server tests run THEN the scenarios today's tests check SHALL CONTINUE TO pass after being ported to the new store: the integration and regression suites, and the property tests for the incident log, the create-and-list round trip, Device_ID validation, SOS input validation, socket rooms, payload shape, and update targets. The only exception is the MongoDB index-build check, which the migration tests in 2.10 replace.

3.26 WHEN the migration has run and the server has switched THEN the system SHALL CONTINUE TO show responders every incident that existed before, with the same field values, and every migrated user SHALL CONTINUE TO log in with the same email and password, apart from records skipped under 2.15 or 2.17
