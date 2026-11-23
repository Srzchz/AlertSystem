# Implementation Plan: mongodb-to-supabase

## Overview

The plan follows the bugfix order. Tasks 1 and 3 are exploration tests that fail on the unfixed server. Tasks 4 to 9 are preservation tests that pass on it, run through the store harness's MongoDB body (task 2). Tasks 11 to 24 apply the fix in small steps in the order of the request, and task 25 re-runs both sets of tests.

All work happens in `campussos/server`, plus the README in `campussos`. No task reads or edits `campussos/server/.env`, and no task changes `campussos/web` or `campussos-mobile`. Tests run once with `npm test` (`node --test`) in `campussos/server`, never in watch mode. New property test files start with `// Feature: mongodb-to-supabase, Property N: <title>` and `// **Validates: Requirements ...**`, like the existing suites. Database-backed properties use 30 to 50 runs.

## Tasks

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Data operations run on Supabase
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: the startup, seed, file, and offline checks are deterministic, so scope them to the concrete cases below. Only the request sequences are generated.
  - Add the test-only dev dependencies `@electric-sql/pglite` and `@electric-sql/pglite-socket` to `server/package.json`. The server's own behavior does not change.
  - Create `test/helpers/db.js` with `createTestDb()` (PGlite, with `db/schema.sql` applied when the file exists) and a pglite-socket server on 127.0.0.1 that gives spawned processes a loopback `DATABASE_URL` and `DATABASE_POOL_MAX=1`. The file defines no tests and does nothing on import, because `node --test` also runs every file under `test/`.
  - Every spawned process gets an env whose `DOTENV_CONFIG_PATH` points at an empty temp file. `import 'dotenv/config'` then never loads `server/.env`, so the unfixed server and seed cannot reach the real Atlas database.
  - Create `test/supabase.bugcondition.property.test.js` with one `test()` per check below. Load modules that exist only after the fix (such as `src/db/client.js`) with dynamic `import()`. Every check then runs and reports its own counterexample, and later tasks can verify one check at a time.
    - **Import scan** (every op in C): no file under `src/` imports `mongoose` or `mongodb`.
    - **Startup** (`op.kind = START`): spawn `node src/index.js` with `PORT=0`, a pglite-socket `DATABASE_URL` that has the schema, and no `MONGODB_URI`, and expect the `CampusSOS server on :` line. Expect `Supabase connection failed: <reason>` and exit code 1 for a closed port, a missing `DATABASE_URL`, a remote host without `DATABASE_CA_CERT`, and a database without the tables. Put a marker password in `DATABASE_URL` and assert it never appears in the output. While `db/schema.sql` is missing, spawn against an empty PGlite so the MongoDB failure is still observed.
    - **Seed** (`op.kind = SEED`): spawn `node src/seed.js` twice. Expect `Created responder: <email>`, then `Responder already exists: <email>`, one row in `public.users`, and exit code 0 both times.
    - **Requests** (`op.kind = HTTP AND reachesStore(op.request)`): call `setDb(pglite)` with no MongoDB connection. A fast-check property generates call sequences for each route group: register, login, and me; app SOS and `/mine`; responder list and PATCH; SMS. Every call succeeds, and every returned `_id` or `id` exists as a row with the values the API returned. Each group seeds the rows it needs with SQL, so it passes as soon as its own routes are switched. Use `endOnFailure: true`, because on unfixed code each request waits out Mongoose's 10-second buffering.
    - **Repository files** (`READ_FILE`, `COPY_MONGO_DATA`), as separate checks: `.env.example` has only `KEY=value` lines and comments, the expected keys, no URL with credentials, and `MONGODB_URI=` marked as migration-only; `db/schema.sql` applies to PGlite twice; `package.json` has a `migrate:mongo` script; the README describes the Supabase setup and does not say to edit `MONGODB_URI`. A failing `.env.example` check reports the line number and the broken rule, never the line's text, so the leaked credential is not printed.
    - **Offline** (`TEST_RUN`): `package.json` lists neither `mongoose` nor `mongodb-memory-server`, and no test file imports them.
  - The assertions follow `expectedBehavior(op, result)` in design.md. The deliberate-change cases (design test case 7) are in task 3.
  - Run `node --test test/supabase.bugcondition.property.test.js` on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document the counterexamples in this task. Expected: `src/index.js`, `src/seed.js`, `src/models/*.js`, `src/routes/*.js`, and `src/middleware/auth.js` import mongoose. Startup without `MONGODB_URI` logs "MongoDB connection failed:" and exits 1 although Postgres is reachable, and the seed fails the same way. Register waits 10 seconds and gets 500 while `public.users` stays empty. `src/db/client.js`, `db/schema.sql`, and the `migrate:mongo` script do not exist. `.env.example` line 2 is a credentialed `mongodb+srv://` URL with no key. If any of these does not show up, stop and revisit the root cause analysis in design.md before starting the fix.
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.10, 2.11, 2.19_

- [ ] 2. Build the store harness (MongoDB body) and the behavior model
  - [ ] 2.1 Create `test/helpers/store.js` with its MongoDB body
    - Use the exports listed in design.md "Testing Strategy": `openStore({ listen })`, and on the store `reset`, `insertUser`, `insertLegacyIncident`, `getIncident`, `countIncidents`, `deleteUser`, `childEnv`, and `close`. The exports stay the same after the fix.
    - Before the fix, the body uses mongodb-memory-server, `mongoose.connect`, and raw collection writes. `insertUser` bcrypt-hashes `password` unless `passwordHash` is given and returns `{ id, ...fields }` with a hex id. `insertLegacyIncident` writes a Mongo-shaped document with an explicit `_id` and timestamps, as stored today. `getIncident` returns hex ids, `Date` values, and no null or missing fields.
    - `childEnv()` returns `MONGODB_URI` for the memory server and a `DOTENV_CONFIG_PATH` that points at an empty temp file
    - Add the dev dependency `mongodb@^6.20.0`, so tests build `ObjectId` values from `mongodb` rather than from mongoose
    - No tests and no side effects on import
    - _Requirements: 2.10, 3.25_

  - [ ] 2.2 Create `test/helpers/model.js`
    - A plain-JS model of today's behavior: Mongoose 8 casts, trims, defaults, and validators (the "kept" table in design.md D6), the `GET /api/incidents` filter rules, the acknowledgement rule, the populate shapes, and the `toJSON` shape
    - Export `normalize()` and `isDeliberateChange()` as design.md defines them, so the preservation generators can leave out deliberate changes
    - _Requirements: 3.9, 3.10, 3.11, 3.12, 3.14, 3.15, 3.17, 3.18, 3.19_

- [ ] 3. Write deliberate-change exploration test
  - **Property 4: Deliberate changes** - Values only, unknown ids, nulls, NUL
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms that today's behavior differs where 2.22 to 2.25 change it
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the new behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples for every deliberate change
  - Create `test/deliberate.property.test.js`. It reaches storage only through the store harness.
  - Inputs are those where `isDeliberateChange(op)` holds, plus explicit nulls in optional fields:
    - 2.22: operator-shaped and other non-scalar `status` and `category` values match nothing (`status[$ne]=PENDING` returns `[]`). The string elements of an array that also holds an object still match. Values with `'`, `;`, `--`, or `$1` match only literally. An SMS `from` that is an object or an array links no reporter and still gives 201. A JWT signed with `JWT_SECRET` whose payload has no `id` gets 401 "Account unavailable". The seed with `SEED_RESPONDER_EMAIL` unset exits non-zero and creates no user, also when other users exist.
    - 2.23: random non-ObjectId strings and unknown 24-hex ids on `PATCH /api/incidents/:id` give 404 `{ error: 'Incident not found' }` and emit nothing
    - 2.24: explicit nulls in every optional field are left out of the 201 body, the list responses, and the emitted payloads, and `__v` never appears
    - 2.25: `nature: "a\u0000b"` is stored and returned as `"ab"`. Register, then log in, with an email that contains U+0000. An app SOS whose Device_ID contains U+0000 comes back without it, and a socket that connected with the same raw Device_ID receives its `incident:update`. A Device_ID made only of U+0000 gets 400 "Device ID is missing or invalid".
  - Run `node --test test/deliberate.property.test.js` on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it shows the behavior the fix changes)
  - Document the counterexamples in this task. Expected: `status[$ne]=PENDING` returns non-PENDING incidents, `PATCH /api/incidents/abc` returns 500, bodies contain `"accuracy": null` and `"__v": 0`, and `nature` keeps U+0000. Record what unfixed code does for the JWT and seed cases.
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.22, 2.23, 2.24, 2.25_

- [ ] 4. Write preservation property test for creates (BEFORE implementing fix)
  - **Property 2: Preservation** - Clients and operators see the same results: creates
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: app SOS bodies and SMS messages with mixed-type optional fields (numbers, booleans, strings with surrounding spaces, `{ _id }` objects, arrays, nulls) give 201 with the JSON that `model.js` predicts, or 500 with nothing stored and no `incident:new`
  - Create `test/preservation.create.property.test.js`, using the store harness. Generators leave out inputs where `isDeliberateChange` holds (no U+0000, scalar SMS `from` only).
  - Assert `normalize(observed)` equals `normalize(model)`: trims, casts, defaults, `updatedAt === createdAt`, `incident:new` sent only to the responders room, the 201 body equal to the emitted payload after a JSON round trip, and the SMS reply `{ ok: true, id }` with `id` equal to the incident's `_id`
  - Record emits as `(event, room, payload)` by wrapping `io.to(room).emit`
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.9, 3.10, 3.11, 3.12, 3.16, 3.17, 3.18, 3.20_

- [ ] 5. Write preservation property test for reads (BEFORE implementing fix)
  - **Property 2: Preservation** - Clients and operators see the same results: reads
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: random sets of users and legacy documents (missing fields, explicit nulls, `__v`, deleted or dangling reporters, decimal numbers, millisecond timestamps), combined with `/mine` headers and responder filters (single, repeated, unknown, and case-variant values; `from` and `to` across the whole JS date range; invalid date strings), give the lists that `model.js` predicts
  - Create `test/preservation.read.property.test.js`, using the store harness. Generate dangling and deleted links only on incidents without a Device_ID, as in real data, because 2.14 and `ON DELETE SET NULL` turn them into null, and `/mine` would show that null instead of the old id.
  - Assert: exact, case-sensitive `/mine` matches, newest first, at most 100, plain ids; exact filters, "any of" for repeated filters, inclusive date bounds, 500 for an unparsable date, newest first, at most 500, filled-in `reporter` and `handledBy`
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 2.13, 3.13, 3.14, 3.17, 3.18, 3.19_

- [ ] 6. Write preservation property test for updates (BEFORE implementing fix)
  - **Property 2: Preservation** - Clients and operators see the same results: updates
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: random PATCH sequences (valid, invalid, non-string, and repeated statuses; `outcome` and `notes` with spaces, numbers, and nulls; empty bodies) on existing incidents, with 24-hex ids only
  - Create `test/preservation.update.property.test.js`, using the store harness
  - Assert the modeled responses, the acknowledgement fields set once, `responseTimeSec` computed from the two timestamps, `resolvedAt` set on every RESOLVED, `updatedAt` changed only when a stored value changed, nothing changed or emitted on a 500, and one `incident:update` per room returned by `updateTargets`, sent after the save
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.15, 3.20_

- [ ] 7. Write preservation property test for accounts and tokens (BEFORE implementing fix)
  - **Property 2: Preservation** - Clients and operators see the same results: accounts and tokens
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: register, login, and `/me` with case and space variants of emails, short passwords, requested roles, phones of various JSON types, wrong passwords, inactive users, and expired, wrong-secret, or garbage tokens
  - Create `test/preservation.auth.property.test.js`, using the store harness. Every generated JWT carries an `id`, and no email contains U+0000.
  - Assert the same status codes, messages, user objects (`phone` absent or null both normalize the same), JWT claims (`{ id, role }`, `exp - iat` = 7 days), no password hash in any response, and 500 "Something went wrong on the server" for unexpected errors
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.24_

- [ ] 8. Write preservation test for the seed script (BEFORE implementing fix)
  - **Property 2: Preservation** - Clients and operators see the same results: seed
  - **IMPORTANT**: Follow observation-first methodology
  - Create `test/preservation.seed.test.js`. Spawn `node src/seed.js` with `store.childEnv()` and a set `SEED_RESPONDER_EMAIL` and `SEED_RESPONDER_PASSWORD`, first with no responder, then with an existing responder whose email differs only in letter case and surrounding spaces
  - Assert the console lines (`Created responder: <email>`, then `Responder already exists: <email>`), the exit code, the stored row (name "Infirmary Nurse", role responder, a bcrypt hash that matches the password), and that the second run changes nothing
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 2.2, 3.22_

- [ ] 9. Move the existing database-backed suites onto the store harness (BEFORE implementing fix)
  - Design D9 asks for this before the fix, so the same test files run on the unfixed and the fixed server
  - In `test/integration.test.js`, `test/regression.test.js`, `test/incidents.mine.property.test.js`, `test/incidents.roundtrip.property.test.js`, and `test/deviceId.invalid.property.test.js`, replace `MongoMemoryServer`, `mongoose.connect`, and direct `Incident` and `User` model calls with harness calls. Build ids with `ObjectId` from `mongodb` or as hex strings. Keep every scenario and assertion.
  - Leave the MongoDB index-build test in `regression.test.js` as it is (task 18.3 removes it), and leave the enum imports from `src/models/Incident.js` until task 18
  - Verify: each of the five suites passes on UNFIXED code
  - _Requirements: 3.1, 3.2, 3.3, 3.25_

- [ ] 10. Checkpoint - Unfixed baseline
  - Run `npm test` in `campussos/server`
  - Expected: the setup, socket, rooms, incident payload, and incidentInput suites, the five suites from task 9, and tasks 4 to 8 pass. Tasks 1 and 3 fail only with the counterexamples documented there.
  - Ensure nothing else fails, ask the user if questions arise.

- [ ] 11. Fix step 1: dependencies, enums, and the database setup file

  - [ ] 11.1 Add the `pg` dependency
    - In `server/package.json`, add `pg@^8.23.1` to `dependencies`. Keep `mongoose` and `mongodb-memory-server` until task 24, and leave `react-dom` as it is.
    - Task 17.3 adds the `migrate:mongo` script, so the script never points at a missing file
    - Verify: `npm ls pg` resolves, and `npm test` matches checkpoint 10
    - _Bug_Condition: isBugCondition(op) where op.kind = START; the server has no Postgres driver_
    - _Expected_Behavior: expectedBehavior: users and incidents reach public.users and public.incidents through DATABASE_URL_
    - _Preservation: no client-visible change_
    - _Requirements: 2.1_

  - [ ] 11.2 Move the enum lists to `src/lib/enums.js`
    - Create `src/lib/enums.js` with `CATEGORIES`, `PATIENT_STATUSES`, and `STATUSES` moved unchanged, plus `SEXES`, `SOURCES`, and `ROLES` as in design.md
    - `src/lib/incidentInput.js` imports `CATEGORIES` from `./enums.js`, with no other change
    - `src/models/Incident.js` imports the lists from `../lib/enums.js` and re-exports them, so existing imports keep working until task 18.10 deletes the model
    - Verify: `npm test` matches checkpoint 10
    - _Bug_Condition: lib/incidentInput.js depends on the Mongoose model file_
    - _Expected_Behavior: the pure validators no longer import a model_
    - _Preservation: the allowed values stay exactly as today (3.12)_
    - _Requirements: 3.3, 3.12_

  - [ ] 11.3 Add `server/db/schema.sql`
    - The SQL in design.md "Database setup": both tables with the CHECK rules, defaults, unique email (`users_email_key`), the 128-character `device_id` limit, and ObjectId-format ids; the three indexes; RLS with no policies; and the guarded revoke for `anon` and `authenticated`. Do not add `FORCE ROW LEVEL SECURITY`.
    - Verify: the task 1 check "db/schema.sql applies to PGlite twice" passes
    - _Bug_Condition: no setup file exists for the Supabase store_
    - _Expected_Behavior: the tables enforce today's schema rules and give anon and authenticated no rows and no writes_
    - _Preservation: required fields, allowed values, and defaults equal today's Mongoose schemas_
    - _Requirements: 2.13, 2.20, 2.21, 3.12_

- [ ] 12. Fix step 2: the data layer in `src/db/`

  - [ ] 12.1 Create `src/db/client.js` and `src/db/pg.js`
    - `client.js`: `setDb(db)` and `getDb()`, which throws "Database is not connected" when unset
    - `pg.js`: `poolConfigFromEnv`, `createPgDb`, `checkTables`, `connectDatabase`, `safeMessage`, and `describeError` as in design.md D1, D2, and "Data layer"
    - TLS: build the config from the URL's host, port, user, decoded password, and database, and ignore query parameters such as `sslmode`. Use `ssl: false` for `localhost`, `127.0.0.1`, and `::1`, and `{ ca: <contents of DATABASE_CA_CERT>, rejectUnauthorized: true }` for every other host. Fail with "DATABASE_URL is not set" or "DATABASE_CA_CERT is not set".
    - Pool: `max` 5 or `DATABASE_POOL_MAX`, `connectionTimeoutMillis` 10000, `idleTimeoutMillis` 30000, `keepAlive` true, and an `error` listener that logs instead of crashing
    - Redaction: `safeMessage` replaces `DATABASE_URL`, its decoded password, and `MONGODB_URI` with `[redacted]`. `describeError` logs the SQLSTATE code and message and never pg's `detail`, which can hold a bcrypt hash.
    - Driver contract: parameters are only string, number, boolean, or null; timestamps are read as epoch milliseconds; counts are cast with `::int`
    - Verify: `npm test` matches checkpoint 10. The task 1 startup checks exercise this module in task 14, and task 20.2 tests it on its own.
    - _Bug_Condition: isBugCondition(op) where op.kind = START_
    - _Expected_Behavior: both tables are queried before listen; failures print "Supabase connection failed: <reason>" without secrets_
    - _Preservation: no client-visible change_
    - _Requirements: 2.1, 2.19, 2.22_

  - [ ] 12.2 Create `src/db/ids.js`
    - `newId(nowMs)`: 24 lowercase hex characters in the ObjectId layout (4-byte seconds, 5 random bytes per process, 3-byte counter)
    - `toId(value)`: null or undefined give null; an ObjectId or a 24-hex string gives lowercase hex; anything else throws `InvalidIdError`
    - Verify: `npm test` matches checkpoint 10. Task 20.1 tests this module.
    - _Bug_Condition: ids are MongoDB ObjectIds bound to Mongoose_
    - _Expected_Behavior: new ids keep the ObjectId format, and migrated ids keep their value_
    - _Preservation: pre-switch JWTs and held incident ids stay valid; uppercase hex still finds the record_
    - _Requirements: 2.23, 3.2, 3.6, 3.7, 3.19_

  - [ ] 12.3 Create `src/db/cast.js` and `src/db/fields.js`
    - `cast.js`: `castString`, `castNumber`, `castBoolean`, `castDate`, `stripNul`, and `CastError`, mirroring mongoose 8.24.7 as listed in design.md D6. The error message never contains the value.
    - `fields.js`: `USER_FIELDS` and `INCIDENT_FIELDS` from the field table in design.md, and `prepareWrite(fields, input, { setters })` with `ValidationError`
    - Defaults apply only to undefined values, and an explicit null stays null. U+0000 is removed before the trim and lowercase setters and before validation. `required` fails on missing, null, or `''` after trim, the enum check lets null through, and `deviceId` is at most 128 characters after trim.
    - Verify: `npm test` matches checkpoint 10. Task 20.1 tests these modules.
    - _Bug_Condition: casting and validation happen inside Mongoose today_
    - _Expected_Behavior: text with U+0000 is stored without it (2.25)_
    - _Preservation: the same trims, casts, defaults, and validation errors as today (3.9 to 3.12)_
    - _Requirements: 2.25, 3.9, 3.10, 3.11, 3.12_

  - [ ] 12.4 Create `src/db/serialize.js`
    - `incidentJson(row, { populate })` and `userRecord(row)` as in design.md D5. `reporter` and `deviceId` are always present, `patient` and `location` are always objects, other null keys are left out, `__v` is never sent, and timestamps use `toISOString()`.
    - The same object goes to `res.json` and to every `emit`
    - Verify: `npm test` matches checkpoint 10. Task 18.8 rewrites the payload-shape property for this module.
    - _Bug_Condition: payloads come from Mongoose's toJSON()_
    - _Expected_Behavior: explicit nulls and __v are left out (2.24)_
    - _Preservation: the same keys, values, and populated shapes as today (3.17 to 3.19)_
    - _Requirements: 2.24, 3.13, 3.17, 3.18, 3.19_

  - [ ] 12.5 Create `src/db/users.js`
    - `findUserById`, `findUserByEmail(email, { withPassword })`, `findUserByPhone`, `createUser`, and `insertUserRow` as in design.md
    - Email and phone lookups accept only a string, number, or boolean, which is cast, stripped of U+0000, and trimmed (and lowercased for email); any other value matches nothing. The phone lookup takes the earliest-created match (`ORDER BY created_at, id LIMIT 1`).
    - `createUser` sets `created_at` and `updated_at` from one Node `now`. Every query uses bound parameters.
    - Verify: `npm test` matches checkpoint 10. Task 15 wires this module in.
    - _Bug_Condition: isBugCondition(op) where op is register, login, a protected route, the SMS webhook, or the seed_
    - _Expected_Behavior: users are read and written in public.users, and lookup values are only values (2.22)_
    - _Preservation: case- and space-insensitive email matching and the earliest phone match as today_
    - _Requirements: 2.3, 2.4, 2.7, 2.22, 2.25, 3.4, 3.5, 3.16, 3.20, 3.22_

  - [ ] 12.6 Create `src/db/incidents.js`
    - `createIncident`, `listIncidentsByDevice`, `listIncidents`, `updateIncident`, and `insertIncidentRow` as in design.md
    - `listIncidents`: `status` and `category` use today's truthiness test; a string becomes a one-value list, an array keeps its string elements, and an object becomes an empty list (`FALSE`). Dates are checked with `new Date(x)` before any query, and an invalid one throws. Bounds outside years 0001 to 9999 become `'-infinity'` or `'infinity'`. Sort `created_at DESC, id DESC`, limit 500.
    - `listIncidentsByDevice`: exact match, same sort, limit 100, plain ids
    - `updateIncident(id, mutate)`: a malformed id returns null with no query. In one transaction it runs `SELECT ... FOR UPDATE`, returns null when no row exists, runs `mutate` on a draft, writes only the values that differ after the field rules, and sets `updated_at` only when something changed.
    - Verify: `npm test` matches checkpoint 10. Task 15 wires this module in.
    - _Bug_Condition: isBugCondition(op) where op is an app SOS, /mine, the responder list, a PATCH, or an SMS_
    - _Expected_Behavior: incidents are read and written in public.incidents; filter values are only values (2.22); unknown ids give null (2.23)_
    - _Preservation: today's filters, sort orders, limits, acknowledgement rule, and updatedAt rule (3.13 to 3.15, 3.20)_
    - _Requirements: 2.5, 2.6, 2.22, 2.23, 3.13, 3.14, 3.15, 3.20_

- [ ] 13. Checkpoint - Data layer added, nothing wired yet
  - Run `npm test` in `campussos/server`
  - Expected: the same results as checkpoint 10, except that the task 1 schema check now passes
  - Ensure all tests pass apart from those expected failures, ask the user if questions arise.

- [ ] 14. Fix step 3: startup in `src/index.js` and `src/app.js`

  - [ ] 14.1 Switch `src/index.js` to Supabase
    - Call `createApp()`, then `connectDatabase(process.env)`, then `setDb(db)`, then `server.listen`, as in design.md D7. On failure, log `Supabase connection failed: <safeMessage>` and exit with code 1. Remove the mongoose import.
    - Keep `PORT` (default 4000), the listen line, and the `unhandledRejection` logger
    - Verify: every task 1 startup check passes, and `npm test` otherwise matches checkpoint 13
    - _Bug_Condition: isBugCondition(op) where op.kind = START_
    - _Expected_Behavior: both tables are queried before listen; failures print "Supabase connection failed: <reason>" without secrets and exit 1_
    - _Preservation: PORT, CLIENT_ORIGIN, JWT_SECRET, SMS_WEBHOOK_SECRET, and /api/health behave as today (3.23)_
    - _Requirements: 2.1, 2.19, 3.23_

  - [ ] 14.2 Update the error handler in `src/app.js`
    - The last-resort handler logs `describeError(err)` and still answers 500 "Something went wrong on the server". Update the comment to say the app is built without connecting to the database.
    - Verify: `npm test` matches the result after 14.1
    - _Bug_Condition: database errors would be logged with full details_
    - _Expected_Behavior: logs contain no secret and no failing row (2.19)_
    - _Preservation: the same 500 body as today (3.24)_
    - _Requirements: 2.19, 3.24_

- [ ] 15. Fix step 4: the middleware and each route
  - From this task until task 18.1, the harness-based suites fail, because the routes use the repositories while the harness still has its MongoDB body. Verify each sub-task with the task 1 request check for its route group, which uses PGlite directly.

  - [ ] 15.1 Switch `src/middleware/auth.js`
    - `signToken` signs `{ id: user.id, role: user.role }`. `requireAuth` calls `findUserById(payload.id)`. The existing `catch` still answers "Session expired. Please log in again." for bad tokens, malformed ids, and database errors.
    - Verify: together with 15.2, by the task 1 "register, login, and me" check
    - _Bug_Condition: isBugCondition(op) where a protected route gets a verifiable JWT_
    - _Expected_Behavior: the user is loaded from public.users by the token's id (2.4)_
    - _Preservation: the 401 and 403 messages and pre-switch tokens keep working (3.6, 3.7)_
    - _Requirements: 2.4, 2.22, 3.6, 3.7_

  - [ ] 15.2 Switch `src/routes/auth.js`
    - Register uses `findUserByEmail(email.toLowerCase())` and `createUser({ name, email, phone, password })` with the bcrypt hash (cost 10). Login uses `findUserByEmail((email || '').toLowerCase(), { withPassword: true })`. `publicUser` returns `{ id, name, email, phone, role }` and leaves out a null `phone` or `role`.
    - Validation, messages, and status codes stay unchanged
    - Verify: the task 1 "register, login, and me" check passes
    - _Bug_Condition: isBugCondition(op) where op is register, login, or /me and reachesStore_
    - _Expected_Behavior: accounts live in public.users, and the returned and signed id is the Supabase id (2.3)_
    - _Preservation: register and login behavior and the user object as today (3.4, 3.5, 3.8)_
    - _Requirements: 2.3, 3.4, 3.5, 3.8_

  - [ ] 15.3 Switch `POST /` and `GET /mine` in `src/routes/incidents.js`
    - `POST /`: `createIncident(result.doc)`, then emit `incident:new` to the responders room and respond 201 with that same object
    - `GET /mine`: `listIncidentsByDevice(deviceId)`. The Device_ID is still never logged.
    - Verify: the task 1 "app SOS and /mine" check passes
    - _Bug_Condition: isBugCondition(op) where op is a valid app SOS or a /mine request with a valid Device_ID_
    - _Expected_Behavior: incidents are written to and read from public.incidents (2.5)_
    - _Preservation: the same 201 body, emit, and /mine list as today (3.9, 3.13, 3.17)_
    - _Requirements: 2.5, 3.9, 3.13, 3.17_

  - [ ] 15.4 Switch `GET /` and `PATCH /:id` in `src/routes/incidents.js`
    - `GET /`: `listIncidents(req.query)`
    - `PATCH /:id`: `updateIncident(req.params.id, (incident) => { ... })` with today's status, outcome, and notes code and `incident.handledBy = req.user.id`. A null result gives 404 `{ error: 'Incident not found' }`. Then run the same `updateTargets` loop and `res.json`.
    - Verify: the task 1 "responder list and PATCH" check passes
    - _Bug_Condition: isBugCondition(op) where a responder lists or updates incidents_
    - _Expected_Behavior: public.incidents with users filled in from public.users (2.6); filter values are only values (2.22); unknown ids give 404 (2.23)_
    - _Preservation: today's filters, limits, acknowledgement rule, and one emit per room after the save (3.14, 3.15)_
    - _Requirements: 2.6, 2.22, 2.23, 3.14, 3.15_

  - [ ] 15.5 Switch `src/routes/sms.js`
    - Import the enums from `../lib/enums.js`. Use `findUserByPhone(from)` when `from` is truthy and `createIncident({ reporter: reporter?.id, ... })`, emit `incident:new`, and respond 201 `{ ok: true, id: full._id }`. `parseSosSms` stays unchanged.
    - Verify: the task 1 "SMS" check passes, and the task 1 import scan lists no route files
    - _Bug_Condition: isBugCondition(op) where the webhook gets the right secret and an SOS message_
    - _Expected_Behavior: the sender is matched in public.users and the incident is written to public.incidents (2.7)_
    - _Preservation: the same 401, 400, 201, parsing, and reporter matching as today (3.16)_
    - _Requirements: 2.7, 2.22, 3.16_

- [ ] 16. Fix step 5: switch `src/seed.js`
  - Connect with `connectDatabase(process.env)` and `setDb`, call `findUserByEmail(SEED_RESPONDER_EMAIL)`, then log `Responder already exists: <email>`, or call `createUser` with name "Infirmary Nurse", role responder, and `bcrypt.hash(SEED_RESPONDER_PASSWORD, 10)` and log `Created responder: <email>`. Then call `db.end()` so the process exits. A connection failure logs `Supabase connection failed: <reason>` and exits with code 1.
  - Verify: the task 1 seed check passes. Task 8 runs again after task 18.1.
  - _Bug_Condition: isBugCondition(op) where op.kind = SEED_
  - _Expected_Behavior: the 3.22 rules hold on public.users and the process exits (2.2)_
  - _Preservation: the same console lines and stored responder as today (3.22)_
  - _Requirements: 2.2, 2.19, 3.22_

- [ ] 17. Fix step 6: the migration modules and CLI

  - [ ] 17.1 Create `migration/map.js`
    - `mapUser(doc)` and `mapIncident(doc)` follow the mapping rules in design.md "Migration details". Ids: an ObjectId (recognized by `_bsontype`, without importing bson) or a 24-hex string. The same casts as the server and U+0000 removal, but no trim or lowercase. Today's API defaults for absent keys, and null kept as null. Errors for missing timestamps or dates outside years 0001 to 9999. Links that are not ids become dangling links. `__v` is dropped silently, and other unknown keys are dropped and counted by path.
    - Error reasons name the field and the rule, never the value
    - Verify: task 18.1 runs every legacy fixture through this module, and task 20.4 tests it on its own
    - _Bug_Condition: isBugCondition(op) where op.kind = COPY_MONGO_DATA_
    - _Expected_Behavior: Property 3 mapping rules (2.13, 2.17, 2.25)_
    - _Preservation: a copied record's normalized API view equals today's view of its document (3.26)_
    - _Requirements: 2.13, 2.17, 2.25_

  - [ ] 17.2 Create `migration/run.js` and `migration/report.js`
    - `runMigration({ source, db })` follows the "Run" pseudocode: users first, then incidents, each in ascending `_id` order, one `INSERT ... ON CONFLICT (id) DO NOTHING RETURNING id` per record. It counts "already present" by id and by email, re-points links to users matched by email, empties links to missing or skipped users, and skips records that break a table rule with `safeMessage(e)` as the reason.
    - `formatReport(stats)` prints the report shown in design.md. `exitCodeFor(stats)` returns 0 when nothing was skipped with an error and 1 otherwise.
    - Verify: task 20.5 tests these modules
    - _Bug_Condition: isBugCondition(op) where op.kind = COPY_MONGO_DATA_
    - _Expected_Behavior: Property 3 run rules, report, and exit code (2.14 to 2.18)_
    - _Preservation: re-runs never overwrite or duplicate a row (2.16)_
    - _Requirements: 2.14, 2.15, 2.16, 2.17, 2.18_

  - [ ] 17.3 Create `migration/source.js` and `migration/cli.js`, and add the `migrate:mongo` script
    - `mongoSource(mongoDb)` only calls `collection('users' | 'incidents').find({}, { sort: { _id: 1 } })`
    - `cli.js` loads `.env`, connects to Supabase with `connectDatabase`, then to MongoDB with `MongoClient` (`serverSelectionTimeoutMS` 10000) using the database named in `MONGODB_URI`'s path, or `test` when the path is empty. It runs the migration, prints the report, and exits 0, 1, or 2 as in design.md. Connection failures print `MongoDB connection failed: <reason>` or `Supabase connection failed: <reason>` through `safeMessage`. Only `cli.js` imports `mongodb`.
    - Add `"migrate:mongo": "node migration/cli.js"` to `server/package.json`
    - Do not run the CLI by hand: it loads `server/.env`. Task 20.6 runs it with a safe env.
    - Verify: the task 1 `migrate:mongo` check passes
    - _Bug_Condition: isBugCondition(op) where op.kind = COPY_MONGO_DATA_
    - _Expected_Behavior: MongoDB receives only find() calls, and the exit code follows 2.18_
    - _Preservation: the server never imports migration/_
    - _Requirements: 2.8, 2.12, 2.18, 2.19_

- [ ] 18. Fix step 7: port each existing test suite to the new store

  - [ ] 18.1 Switch `test/helpers/store.js` to its PGlite body
    - Use `createTestDb()` and `setDb`. `insertLegacyIncident` runs the migration's `mapIncident`, its link resolution, and `insertIncidentRow`, so every legacy fixture also exercises the 2.13 mapping. `insertUser` keeps its contract. `childEnv()` points at a pglite-socket server with a loopback `DATABASE_URL`, `DATABASE_POOL_MAX=1`, and the empty `DOTENV_CONFIG_PATH`. Tests that spawn a process do not query PGlite directly while the child is inside a transaction.
    - Delete the MongoDB body. The exports stay the same.
    - Verify: tasks 4 to 8 and the five suites from task 9 pass without edits, and task 3 passes except its Device_ID U+0000 cases, which task 23 fixes
    - _Requirements: 2.10, 3.25_

  - [ ] 18.2 Port `test/integration.test.js`
    - No change beyond task 9. Confirm it passes on PGlite.
    - _Requirements: 3.1, 3.3, 3.7, 3.9, 3.13, 3.15, 3.21_

  - [ ] 18.3 Port `test/regression.test.js`
    - Remove the MongoDB index-build test. The migration tests replace it (3.25). Keep the auth, legacy-incident, filter, 500-cap, deleted-reporter, and SMS cases unchanged.
    - _Requirements: 3.3, 3.4, 3.5, 3.14, 3.16, 3.19, 3.25_

  - [ ] 18.4 Port `test/incidents.mine.property.test.js`
    - Import `CATEGORIES` and `STATUSES` from `src/lib/enums.js`. Remove the index build step that relied on Mongoose.
    - _Requirements: 3.13_

  - [ ] 18.5 Port `test/incidents.roundtrip.property.test.js`
    - Import `CATEGORIES` and `PATIENT_STATUSES` from `src/lib/enums.js`
    - _Requirements: 3.9, 3.13_

  - [ ] 18.6 Port `test/deviceId.invalid.property.test.js`
    - No change beyond task 9. Confirm it passes on PGlite.
    - _Requirements: 3.3, 3.13_

  - [ ] 18.7 Port `test/incidentInput.valid.property.test.js` and `test/incidentInput.invalid.property.test.js`
    - Import `CATEGORIES` from `src/lib/enums.js`. No other change.
    - _Requirements: 3.3, 3.9_

  - [ ] 18.8 Rewrite `test/incident.property.test.js` for the serializer
    - Property 14 of mobile-remove-auth, now against `incidentJson`. Reporter variants: none, populated, populated without phone, joined user missing. Device_ID variants: stored, null, absent. Include a JSON round trip.
    - _Requirements: 3.17, 3.18_

  - [ ] 18.9 Port `test/rooms.property.test.js`
    - Build the ObjectId variant with `ObjectId` from `mongodb` and the incident id with `newId()`
    - _Requirements: 3.15_

  - [ ] 18.10 Delete `src/models/User.js` and `src/models/Incident.js`
    - Verify: nothing imports `src/models/`, and the task 1 import scan passes
    - _Bug_Condition: isBugCondition(op) for every op; the models bind the server to Mongoose_
    - _Expected_Behavior: the server loads no mongoose or mongodb module (2.1)_
    - _Preservation: test/socket.property.test.js and test/setup.test.js stay unchanged and pass_
    - _Requirements: 2.1, 3.25_

- [ ] 19. Checkpoint - Fixed store, old suites ported
  - Run `npm test` in `campussos/server`
  - Expected: everything passes except the task 1 checks for `.env.example`, the README, and offline, and the task 3 Device_ID U+0000 cases. Tasks 21 to 24 fix those.
  - Ensure all tests pass apart from those expected failures, ask the user if questions arise.

- [ ] 20. Fix step 8: the new tests from the design's test table

  - [ ] 20.1 Write `test/cast.test.js`
    - A table of inputs and the outputs mongoose 8.24.7 gives (design.md D6) for strings, numbers, booleans, and dates, including `''`, `{ _id }` objects, arrays, plain objects, NaN, and Infinity
    - `prepareWrite`: defaults only for undefined, required, enum with null, maxlength after trim, setters on and off, and U+0000 removed before validation
    - `ids.js`: `newId` format and order within one process, and `toId` for null, uppercase hex, ObjectId instances, and malformed input
    - _Requirements: 2.25, 3.10, 3.11_

  - [ ] 20.2 Write `test/db.adapter.test.js`
    - `poolConfigFromEnv`: percent-encoded passwords, IPv6 brackets, ignored `sslmode`, loopback without TLS, a remote host without `DATABASE_CA_CERT` (error), and a remote host with it (`ca` set and `rejectUnauthorized: true`). `safeMessage` and `describeError` redact secrets and never include `detail`.
    - The production `createPgDb` pool through pglite-socket: parameter and result types (text, float8 edge values, boolean, null, epoch-millisecond timestamps), commit and rollback, `FOR UPDATE`, error codes 23505 and 23514 with `constraint`, and the pool `error` listener
    - _Requirements: 2.1, 2.19_

  - [ ] 20.3 Write `test/schema.test.js`
    - Each value of every enum list inserts and one outside value fails with 23514, and the CHECK lists equal `src/lib/enums.js`. Also cover defaults, the unique email (23505), the 128-character `device_id` limit, the id format, the three indexes in `pg_indexes`, and that re-applying the file changes nothing.
    - Create `anon` and `authenticated` in PGlite with Supabase-style default grants before applying the file. SELECT then returns no rows or "permission denied", and INSERT, UPDATE, and DELETE fail.
    - _Requirements: 2.20, 2.21, 3.12_

  - [ ] 20.4 Write `test/migration.map.property.test.js`
    - **Property 3: Migration** - Faithful, read-only, repeatable copy: mapping
    - Generate user and incident documents with `ObjectId` from `mongodb` (no server), with missing, null, mistyped, and unknown fields, `__v`, and U+0000
    - Assert that each mapped row's normalized API view equals the `model.js` view of Mongoose's hydrate and `toJSON`, that rule violations are skipped with the field and rule named, and that unknown keys are reported by path
    - Add example documents for every mapping rule
    - _Requirements: 2.13, 2.17, 2.25_

  - [ ] 20.5 Write `test/migration.run.property.test.js`
    - **Property 3: Migration** - Faithful, read-only, repeatable copy: runs
    - Use a recording source and a PGlite target. Generate dangling links and emails that clash with users created by the seed.
    - Assert: the source receives only `find`. A second run copies nothing, changes no row, and reports everything as already present, while documents added between runs are copied. Link counts and targets, the skip list, the report counts, and `exitCodeFor` are correct. A JWT signed for a migrated user's id passes `GET /api/auth/me`, and login with the original password works against the copied bcrypt hash.
    - Add `formatReport` examples
    - _Requirements: 2.12, 2.14, 2.15, 2.16, 2.17, 2.18, 3.6, 3.26_

  - [ ] 20.6 Write `test/migration.cli.test.js`
    - Spawn `migration/cli.js` through `store.childEnv()` with an unreachable MongoDB (`mongodb://u:<marker>@127.0.0.1:1/?serverSelectionTimeoutMS=1000`), and separately with an unreachable Supabase. Expect exit code 2, the right "connection failed" message, and no marker in the output.
    - Pass a fake `Db` object to `mongoSource` that records calls and allows only `collection(...).find(...)`
    - _Requirements: 2.8, 2.12, 2.18, 2.19_

  - [ ] 20.7 Write `test/secrets.test.js`
    - Scan the tracked files (`git ls-files`) in `server`, `web`, and `campussos-mobile`, excluding `node_modules`, for connection strings with credentials. Only `<placeholder>` passwords are allowed. Skip `server/.env` explicitly and never open it. Files in `web` and `campussos-mobile` are only read, never changed. A finding reports the file and line number, never the matched text.
    - Spawn the server, the seed, and the migration CLI with marker passwords in `DATABASE_URL` and `MONGODB_URI`, make successful and failing requests, and assert the markers never appear in stdout, stderr, HTTP bodies, or socket payloads
    - Expected: the scan fails on `server/.env.example` until task 21, and everything else passes
    - _Requirements: 2.9, 2.19_

- [ ] 21. Fix step 9: rewrite `server/.env.example` with placeholders only
  - Write the whole file from design.md "Changes Required": the existing keys and comments, `DATABASE_URL=`, `DATABASE_CA_CERT=./supabase-ca.crt`, and `MONGODB_URI=` marked as used only by `npm run migrate:mongo`. Copy nothing from the old line 2. Do not open `server/.env`.
  - Verify: the task 1 `.env.example` check and task 20.7 pass
  - _Bug_Condition: isBugCondition(op) where op reads server/.env.example_
  - _Expected_Behavior: placeholders only, with the Supabase settings and a migration-only MONGODB_URI (2.9)_
  - _Preservation: PORT, JWT_SECRET, CLIENT_ORIGIN, SMS_WEBHOOK_SECRET, and the seed keys keep their names (3.23)_
  - _Requirements: 2.9, 2.19_

- [ ] 22. Fix step 10: update `campussos/README.md`
  - Make the changes listed in design.md "Changes Required": the layout line, a Supabase project under prerequisites, a new "Set up the database" section (project, `server/db/schema.sql` in the SQL Editor, the Session pooler string in `DATABASE_URL` and why, the root certificate in `DATABASE_CA_CERT`, RLS on with no policies), the "Run the server" steps, a new "Move existing MongoDB data (one time)" section with its six steps, and the updated next-steps line
  - State that the migration needs the dev dependencies (`npm install`, not `--omit=dev`), because `mongodb` is a dev dependency, and that the seed runs after the final migration on an existing install
  - Leave the sections that are not about the database as they are
  - Verify: the task 1 README check passes
  - _Bug_Condition: isBugCondition(op) where op reads a README section about the database_
  - _Expected_Behavior: Supabase setup, seed, and the one-time migration are described; MongoDB appears only as the migration source (2.11)_
  - _Preservation: the web, mobile, alert-flow, and SMS sections stay unchanged_
  - _Requirements: 2.11_

- [ ] 23. Fix step 11: update `src/lib/deviceId.js`
  - `normalizeDeviceId` removes U+0000 before trimming and checking the length, so socket rooms match stored values
  - Change the comment: the `typeof` check rejects objects such as `{ "$ne": null }`, and the value reaches SQL only as a bound parameter
  - Verify: the task 3 Device_ID U+0000 cases pass, and `test/deviceId.invalid.property.test.js` and `test/socket.property.test.js` still pass
  - _Bug_Condition: a Device_ID with U+0000 is stored without it but joins a room with it_
  - _Expected_Behavior: the stored value and the socket room match (2.25)_
  - _Preservation: every other Device_ID is accepted or rejected as today (3.3, 3.13, 3.21)_
  - _Requirements: 2.22, 2.25_

- [ ] 24. Fix step 12: remove mongoose and mongodb-memory-server
  - Run `npm uninstall mongoose mongodb-memory-server` in `campussos/server`. Keep `mongodb` as a dev dependency only.
  - Delete any MongoDB-only test code that is left
  - Verify: the task 1 offline check passes, `npm ls mongoose` finds nothing, and no file under `src/`, `migration/`, or `test/` imports `mongoose` or `mongodb-memory-server`
  - _Bug_Condition: isBugCondition(op) where op.kind = TEST_RUN_
  - _Expected_Behavior: the suite runs with no network, no Supabase project, and no MongoDB server or binary (2.10); production installs get no MongoDB driver (2.1)_
  - _Preservation: every test still passes_
  - _Requirements: 2.1, 2.10_

- [ ] 25. Verify the fix

  - [ ] 25.1 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Data operations run on Supabase
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run `node --test test/supabase.bugcondition.property.test.js`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.10, 2.11, 2.19_

  - [ ] 25.2 Verify deliberate-change test now passes
    - **Property 4: Deliberate changes** - Values only, unknown ids, nulls, NUL
    - **IMPORTANT**: Re-run the SAME test from task 3 - do NOT write a new test
    - Run `node --test test/deliberate.property.test.js`
    - **EXPECTED OUTCOME**: Test PASSES (confirms the deliberate changes)
    - _Requirements: 2.22, 2.23, 2.24, 2.25_

  - [ ] 25.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Clients and operators see the same results
    - **IMPORTANT**: Re-run the SAME tests from tasks 4 to 8 - do NOT write new tests
    - Run the five `test/preservation.*` files
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20, 3.22, 3.24_

  - [ ] 25.4 Verify the ported suites and the migration tests
    - Re-run the suites from task 18 and tasks 20.1 to 20.7 without edits
    - **EXPECTED OUTCOME**: Tests PASS
    - _Requirements: 2.8, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 3.1, 3.2, 3.3, 3.21, 3.23, 3.25, 3.26_

- [ ] 26. Checkpoint - Ensure all tests pass
  - Run `npm test` in `campussos/server`. Every suite passes with no network, no Supabase project, and no MongoDB server or binary download.
  - Ensure all tests pass, ask the user if questions arise.

## Manual checklist (you run these; they are not agent tasks)

These steps need your real Supabase project, your own `campussos/server/.env`, and MongoDB Atlas. No task above does them.

1. Create the Supabase project. Also create a scratch project for the rehearsal.
2. In each project's SQL Editor, run `campussos/server/db/schema.sql`. Leave RLS on and add no policies; the Security Advisor's "RLS enabled, no policy" notice is expected.
3. In your own `campussos/server/.env`, set `DATABASE_URL` to the Session pooler string (Dashboard, Connect, Session pooler; percent-encode special characters in the password) and `DATABASE_CA_CERT` to the path of the certificate downloaded from Database Settings, SSL Configuration. Point them at the scratch project first.
4. Rehearse: create a read-only Atlas user for the migration and put its connection string in `MONGODB_URI`. The old password is public in git history. Run `npm run migrate:mongo` against the scratch project, compare the report with `countDocuments()` in Atlas, start the server, log in as the responder, and open the dashboard's records page.
5. Final migration: point `DATABASE_URL` and `DATABASE_CA_CERT` at the real project and stop the MongoDB-backed server. Run `npm run migrate:mongo`. Exit code 0 means every record was copied or already present. Exit code 1 lists skipped records; fix them in MongoDB and run it again, which is safe.
6. Start the Supabase-backed server (`npm start`), then run `npm run seed`. On an install with no MongoDB data, run the seed right after step 3 instead. Seeding the real project before the final migration would make the migrated responder "already present by email", so it would get a new id and the seed password, and responders would have to log in again.
7. Clear `MONGODB_URI` in your `.env`, delete the read-only migration user, and change the exposed Atlas password or delete that database user. Removing the string from `.env.example` does not remove it from git history. If you change the password before the switch, also update `MONGODB_URI` for the running server.

## Notes

- Test-only dev dependencies arrive before the fix: `@electric-sql/pglite` and `@electric-sql/pglite-socket` in task 1, and `mongodb@^6.20.0` in task 2.1, because the exploration and preservation tests need them on unfixed code. The rest of design.md D10 lands in tasks 11.1, 17.3, and 24.
- Tasks 15 to 17 leave the harness-based suites failing until task 18.1 switches the harness to PGlite. The harness's legacy fixtures need the migration's `mapIncident`, so the switch cannot come earlier in this order. The task 1 request, seed, and startup checks verify those tasks in the meantime.
- Following the requested order, the isolated tests for `src/db/` and `migration/` are written in task 20, after the code. Until then those modules are checked through the task 1 checks, task 18.1, and the ported suites.
- Every spawned server, seed, or migration process runs with `DOTENV_CONFIG_PATH` set to an empty temp file, so no test loads `campussos/server/.env`.
- Each task references the bugfix.md clauses it covers. Properties 1 to 4 are the correctness properties in design.md.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4", "5", "6", "7", "8", "9"] },
    { "id": 4, "tasks": ["10"] },
    { "id": 5, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 6, "tasks": ["12.1", "12.2"] },
    { "id": 7, "tasks": ["12.3", "12.4"] },
    { "id": 8, "tasks": ["12.5", "12.6"] },
    { "id": 9, "tasks": ["13"] },
    { "id": 10, "tasks": ["14.1"] },
    { "id": 11, "tasks": ["14.2"] },
    { "id": 12, "tasks": ["15.1"] },
    { "id": 13, "tasks": ["15.2", "15.3"] },
    { "id": 14, "tasks": ["15.4"] },
    { "id": 15, "tasks": ["15.5"] },
    { "id": 16, "tasks": ["16", "17.1"] },
    { "id": 17, "tasks": ["17.2"] },
    { "id": 18, "tasks": ["17.3", "18.1"] },
    { "id": 19, "tasks": ["18.2", "18.3", "18.4", "18.5", "18.6", "18.7", "18.8", "18.9"] },
    { "id": 20, "tasks": ["18.10"] },
    { "id": 21, "tasks": ["19"] },
    { "id": 22, "tasks": ["20.1", "20.2", "20.3", "20.4", "20.5", "20.6", "20.7"] },
    { "id": 23, "tasks": ["21", "22", "23"] },
    { "id": 24, "tasks": ["24"] },
    { "id": 25, "tasks": ["25.1", "25.2", "25.3", "25.4"] },
    { "id": 26, "tasks": ["26"] }
  ]
}
```
