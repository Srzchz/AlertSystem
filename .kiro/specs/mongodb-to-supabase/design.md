# MongoDB to Supabase Bugfix Design

## Overview

The CampusSOS server (`campussos/server`) stores users and incidents through Mongoose models, and startup, the seed script, the auth routes, the JWT middleware, the incident routes, and the SMS webhook all call those models directly. This design moves that storage to Supabase Postgres without changing anything the web dashboard or the mobile app can see. It also adds a one-time copy of the existing MongoDB data, removes the Atlas credential from `.env.example`, and makes the test suite run offline.

The fix has five parts:

1. **Connection.** The server uses node-postgres (`pg`) through the Supabase session pooler, which works on IPv4 networks. TLS is always on, and the server certificate is checked against Supabase's root certificate. The connection string and the certificate path come only from server environment variables. Login stays the server's own bcrypt and JWT code and live events stay on Socket.IO; Supabase Auth and Realtime are not used.
2. **Schema.** `server/db/schema.sql` creates `public.users` and `public.incidents` with the rules today's Mongoose schemas enforce. Ids stay 24-character ObjectId hex text. The file adds the three indexes and shuts out the public Data API with row level security (RLS) and revoked grants.
3. **Data layer.** A new `src/db/` folder replaces `src/models/`. Repositories run parameterized SQL, a cast module reproduces the Mongoose casting and validation the API depends on, and one serializer produces the JSON that `toJSON()` produced, for both `res.json` and Socket.IO. Route handlers keep their logic and swap model calls for repository calls.
4. **Migration.** `npm run migrate:mongo` reads MongoDB with the plain `mongodb` driver and never writes to it. It inserts into Supabase with `ON CONFLICT (id) DO NOTHING`, so it can run more than once. It keeps ids and password hashes, empties or re-points links, skips records that break a table rule, prints a report, and sets the exit code.
5. **Tests.** Every DB-backed suite runs against PGlite (Postgres compiled to WebAssembly, inside the test process) with the real `schema.sql`. The production `pg` adapter and the spawned server, seed, and migration processes run against PGlite through `@electric-sql/pglite-socket` on 127.0.0.1. No test needs a network, a Supabase project, or a MongoDB binary.

Versions checked for this design: mongoose 8.24.7 and mongodb 6.20.0 (installed today), pg 8.23.1, @electric-sql/pglite 0.5.17 (runs Postgres 18.7), @electric-sql/pglite-socket 0.2.20, fast-check 4.11.0. Statements marked "probed" were run against these versions on this machine. The SQL uses only features that Supabase's Postgres 15 and 17 also have.

## Glossary

- **Bug_Condition (C)**: an operation that today reads or writes users or incidents through MongoDB, or one of the four repository gaps (no copy tool, a credential in `.env.example`, tests bound to mongodb-memory-server, a README that only describes MongoDB). Formalized as `isBugCondition`.
- **Property (P)**: what the fixed system must do for every operation in C: use the Supabase tables, keep secrets out of every output, and follow the migration rules. Formalized as `expectedBehavior`.
- **Preservation**: for every operation, including those in C, clients and operators see the same result as before. The result is the status code, error message, JSON body, Socket.IO events with their rooms and payloads, and the seed's console line. The fix changes where data lives, not what clients receive.
- **F / F'**: the server before and after the fix.
- **API view**: the JSON a client receives for a record, over HTTP or Socket.IO.
- **normalize()**: removes the differences that 2.24 allows before two API views are compared.
- **isDeliberateChange**: the inputs where 2.22, 2.23, or 2.25 define new behavior.
- **Supabase store**: the `public.users` and `public.incidents` tables, reached through `DATABASE_URL`.
- **Repository**: `src/db/users.js` or `src/db/incidents.js`, which routes, middleware, and the seed call instead of Mongoose models.
- **Mongoose-compatible cast**: `src/db/cast.js` and `src/db/fields.js`, which reproduce how Mongoose 8 converts, trims, defaults, and validates values.
- **Legacy document**: a MongoDB document as it is stored today, possibly with `__v`, missing fields, or no `deviceId`.
- **Session pooler**: Supabase's shared Supavisor pooler in session mode, host `aws-<index>-<region>.pooler.supabase.com`, port 5432, user `postgres.<project-ref>`.
- **PGlite / pglite-socket**: an in-process Postgres for tests, and a localhost Postgres wire-protocol server in front of it.
- **Store harness**: `test/helpers/store.js`, the only way tests reach storage. It has a MongoDB body before the fix and a PGlite body after it, so the same test files run on F and F'.
- **Existing functions**: `createApp` (`src/app.js`) builds the Express app, HTTP server, and Socket.IO server; `requireAuth`, `requireRole`, and `signToken` (`src/middleware/auth.js`) handle JWTs; `buildAppIncident` (`src/lib/incidentInput.js`) validates an app SOS; `normalizeDeviceId` (`src/lib/deviceId.js`) validates a Device_ID; `updateTargets` (`src/lib/rooms.js`) picks the rooms for `incident:update`; `parseSosSms` (`src/routes/sms.js`) parses an SMS; `resolveSocketRooms` (`src/socket.js`) picks a socket's rooms.

## Bug Details

### Bug Condition

The bug appears in every operation that touches stored users or incidents. Startup connects to MongoDB with `MONGODB_URI`, and the seed, the auth routes, the JWT check, the incident routes, and the SMS webhook all call Mongoose models. It also appears in four places outside request handling: there is no way to copy the data, `.env.example` holds a real Atlas credential, the tests need mongodb-memory-server, and the README only describes MongoDB.

**Formal Specification:**
```
FUNCTION isBugCondition(op)
  INPUT: op, one operation on campussos/server: a process start, a seed run, an HTTP
         request, a request to copy the MongoDB data, a read of a committed file, or a test run
  OUTPUT: boolean

  RETURN op.kind = START                                                   // 1.1
      OR op.kind = SEED                                                    // 1.2
      OR (op.kind = HTTP AND reachesStore(op.request))                     // 1.3 to 1.7
      OR op.kind = COPY_MONGO_DATA                                         // 1.8
      OR (op.kind = READ_FILE AND op.path = 'server/.env.example')         // 1.9
      OR op.kind = TEST_RUN                                                // 1.10
      OR (op.kind = READ_FILE AND op.path = 'README.md'
          AND op.section describes the database)                           // 1.11
END FUNCTION

FUNCTION reachesStore(req)
  // true exactly when today's handler calls a Mongoose model for req
  CASE req.route OF
    'POST /api/auth/register':
        RETURN NOT registerCheckFails(req.body)        // the 400 check in routes/auth.js
               AND typeof req.body.email = 'string'    // otherwise email.toLowerCase() throws first
    'POST /api/auth/login':
        RETURN NOT req.body.email OR typeof req.body.email = 'string'
    'GET /api/auth/me', 'GET /api/incidents', 'PATCH /api/incidents/:id':
        RETURN bearerToken(req) ≠ null AND jwtVerifies(bearerToken(req))   // requireAuth loads the user
    'POST /api/incidents':
        RETURN buildAppIncident(req.body).ok
    'GET /api/incidents/mine':
        RETURN normalizeDeviceId(req.header('X-Device-Id')) ≠ null
    'POST /api/sms/inbound':
        RETURN req.header('x-webhook-secret') = SMS_WEBHOOK_SECRET
               AND parseSosSms(req.body.message) ≠ null
    OTHERWISE:                                         // GET /api/health, unknown paths
        RETURN false
  END CASE
END FUNCTION
```

Socket.IO handshakes are outside C: `resolveSocketRooms` only verifies the JWT and never loads data.

**Expected result for operations in C:**
```
FUNCTION expectedBehavior(op, result)
  INPUT: op where isBugCondition(op); result = everything the fixed system did and printed
  OUTPUT: boolean

  RETURN every users/incidents read and write in result went to public.users or
         public.incidents through DATABASE_URL                                     // 2.1 to 2.7
     AND the server and seed loaded no 'mongoose' or 'mongodb' module; for
         COPY_MONGO_DATA, MongoDB received only find() calls                        // 2.1, 2.12
     AND no log line, HTTP body, or socket payload contains DATABASE_URL, its
         password, or MONGODB_URI                                                   // 2.19
     AND (op.kind ≠ START OR (both tables were queried before listen() AND
          on failure stderr = "Supabase connection failed: <reason>" AND exit code = 1))  // 2.1
     AND (op.kind ≠ SEED OR (the 3.22 rules hold on public.users AND the process exits))  // 2.2
     AND (op.kind ≠ COPY_MONGO_DATA OR the migration rules of Property 3 hold)       // 2.8, 2.12 to 2.18
     AND (op.kind ≠ READ_FILE OR the file rules of 2.9 and 2.11 hold)
     AND (op.kind ≠ TEST_RUN OR the suite passes with no network, no Supabase
          project, and no MongoDB server or binary)                                 // 2.10
END FUNCTION
```

**Deliberate changes and normalization** (used by Properties 2 and 4):
```
FUNCTION isDeliberateChange(op)
  INPUT: an HTTP request, a socket handshake, or a seed run
  OUTPUT: boolean
  RETURN lookupValueNotScalar(op)                                                  // 2.22
      OR (op.route = 'PATCH /api/incidents/:id'
          AND NOT op.params.id MATCHES /^[0-9a-fA-F]{24}$/)                        // 2.23
      OR some text value in op contains U+0000                                     // 2.25
END FUNCTION

FUNCTION lookupValueNotScalar(op)
  RETURN (op.route = 'GET /api/incidents'
          AND (status or category is an object
               OR status or category is an array with a non-string element))
      OR (op.route = 'POST /api/sms/inbound' AND op.body.from is truthy
          AND typeof op.body.from NOT IN {'string', 'number', 'boolean'})
      OR (op is a seed run AND SEED_RESPONDER_EMAIL is unset)
      OR (op carries a validly signed JWT whose payload has no id)                 // needs JWT_SECRET
END FUNCTION

FUNCTION normalize(observation)
  INPUT: status, body, socket events [(event, room, payload)], console lines
  OUTPUT: the observation with only the 2.24 differences removed
  FOR EACH JSON object o in body and payloads DO
    delete o.__v
    delete every key k of o where o[k] = null,
        except 'reporter' and 'deviceId' on an incident
    IF o is an incident THEN
      o.patient  := o.patient  ?? {}      // Mongoose's minimize drops an empty nested object
      o.location := o.location ?? {}
    END IF
  END FOR
  RETURN observation
END FUNCTION
```

### Examples

- **Startup.** `DATABASE_URL` points at a Postgres that has the schema, and `MONGODB_URI` is unset. F logs "MongoDB connection failed:" followed by Mongoose's error that the `uri` parameter must be a string, and exits with code 1. F' queries both tables, then logs `CampusSOS server on :4000`.
- **Register.** `POST /api/auth/register` with `{"name":"Ana","email":" Ana@CvSU.edu.ph ","password":"password123"}`. F inserts into the MongoDB `users` collection. F' inserts a row into `public.users` with email `ana@cvsu.edu.ph` and a new 24-hex id. Both respond 201 with `{ token, user }` of the same shape, and the token's `id` equals `user.id`.
- **Pre-switch JWT.** A token signed before the switch for migrated user `65a1…`. F loads the user from MongoDB. F' loads row `65a1…` from `public.users` and accepts the token (3.6).
- **App SOS.** F writes the `incidents` collection and F' writes `public.incidents`. The 201 body and the `incident:new` payload are the same JSON in both, apart from `__v`.
- **Copy the data.** F has no tool. F' prints the migration report and exits 0 when no record was skipped with an error.
- **`.env.example`.** In F, line 2 is a bare `mongodb+srv://` connection string with the Atlas username and password and no key. F' contains placeholders only. This document does not repeat the leaked value.
- **`npm test`.** F's first run downloads a MongoDB binary through mongodb-memory-server and fails offline. F' runs with no network.
- **Outside C.** `GET /api/health` returns `{ ok: true }` in both, and a socket that sends `{ deviceId }` joins `device:<id>` in both.
- **Edge case, deliberate change.** `GET /api/incidents?status[$ne]=PENDING` returns every non-PENDING incident in F, because Mongoose runs the operator, and `[]` in F' (2.22).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- API surface: the same base URL, routes, headers, request bodies, and socket handshake, with the same status codes and error messages, and the server-side criteria of the mobile-remove-auth spec (3.1 to 3.3).
- Accounts and tokens: register validation and the 409 for a known email, ignoring case and surrounding spaces; stored name, email, and phone trimmed and email lowercased; bcrypt cost 10; role `user` and `active` true; login matching and 401; the `{ id, name, email, phone, role }` user object; the 7-day JWT carrying `{ id, role }`; the 401 and 403 messages of protected routes; no password hash in any response or event (3.4 to 3.8).
- Incident writes: only allowed fields stored, the same defaults, trims, and casts, and a 500 with nothing stored or emitted for values that cannot be converted or break a rule (3.9 to 3.12).
- Reads: `/mine` with an exact, case-sensitive device match, newest first, at most 100, plain ids; the responder list with exact filters, "any of" for repeated filters, inclusive date bounds, 500 for unparsable dates, newest first, at most 500, filled-in users (3.13, 3.14).
- Updates: status, acknowledgement fields set once, `resolvedAt` on every RESOLVED, outcome and notes, the filled-in response, and one emit per room after the save (3.15).
- The SMS webhook (3.16), payload keys and value types, timestamps, and populated users (3.17 to 3.20), socket rooms (3.21), seed output (3.22), environment and health check (3.23), and error responses (3.24).
- Today's test scenarios, ported to the new store (3.25).
- After the migration: pre-switch JWTs, old passwords, and every existing incident with the same values (3.6, 3.26).

**Scope:**
Preservation covers every operation, not only those outside C, because C includes almost every request. Operations outside C run code the fix does not touch:
- `GET /api/health` and unknown paths
- Socket.IO handshakes and room joins
- Requests rejected before storage: the 400s from `buildAppIncident` and the register check, "Device ID is required", "Not logged in", 401s from a bad or expired token, "Bad secret", and "Not an SOS message"

Operations inside C must give the same client-visible result through the new store. The only allowed differences are 2.22 to 2.25.

## Hypothesized Root Cause

Based on the bug description and the code, the causes are:

1. **No data-access layer.** `index.js`, `seed.js`, `models/User.js`, `models/Incident.js`, `routes/auth.js`, `routes/incidents.js`, `routes/sms.js`, and `middleware/auth.js` use Mongoose directly, and `lib/incidentInput.js` imports `CATEGORIES` from the model file. Changing the store means changing every caller.

2. **The API depends on implicit Mongoose behavior.** Probed on mongoose 8.24.7, or read from its source in `node_modules`:
   - Write casts: `nature: 5` is stored as `"5"`, `patient.age: "19"` as 19, `patient.age: ""` as null, and an object with a string `_id` becomes that string on a String path. Arrays and plain objects fail with CastError, and `patient.age: "abc"` fails validation.
   - Setters run on query values too: `findOne({ email: '  A@B.COM ' })` filters on `a@b.com`.
   - Defaults apply only to undefined values, so `patientStatus: null` stays null. The enum validator lets null through (`null == v || ~vals.indexOf(v)`), and `required` fails on `''`.
   - Filters: an array value becomes `$in` (`{ phone: ['  a ', 5] }` was cast to `{ phone: { $in: ['a', '5'] } }`), an object with `$` keys runs as an operator, and an undefined key is dropped (`findOne({ _id: undefined })` was cast to `{}`, which matches any document).
   - Ids: `findById('abc')` throws CastError, so PATCH answers 500 and `requireAuth` answers "Session expired". Uppercase hex finds the record because ObjectIds compare as bytes.
   - Output: `toJSON()` includes `__v`, keeps explicit nulls, drops empty nested objects (minimize), and the schema transform sets a missing `reporter` and `deviceId` to null. A stored `Infinity` is sent as JSON `null`.
   - Timestamps: `createdAt` equals `updatedAt` on create, and `save()` changes `updatedAt` only when a path changed. Assigning an equal value, after setters, does not count as a change.

   A port that only swaps the queries would change payloads and status codes.

3. **ObjectIds are part of the contract.** JWTs carry the user's ObjectId hex, and the dashboard and the app hold incident `_id`s. New ids must keep the format, and migrated ids must not change.

4. **The credential was pasted in place of the placeholder.** Line 2 of `.env.example` has no `MONGODB_URI=` key, which suggests the real connection string was pasted over the placeholder line and then committed.

5. **Tests are bound to the old store.** Every DB-backed suite starts `MongoMemoryServer`, and several build Mongoose objects directly (`Incident.hydrate`, `Incident.collection.insertMany`, `new mongoose.Types.ObjectId()`).

## Correctness Properties

Property 1: Bug Condition - Data operations run on Supabase

_For any_ operation where isBugCondition holds, the fixed system SHALL perform every users and incidents read and write against `public.users` and `public.incidents` through `DATABASE_URL`, with no MongoDB driver loaded by the server or the seed. At startup it SHALL query both tables before listening, and on failure log "Supabase connection failed: <reason>" without secrets and exit with code 1. It SHALL keep `DATABASE_URL`, its password, and `MONGODB_URI` out of the repository, logs, HTTP bodies, and socket payloads. The repository SHALL contain a setup SQL file that enforces today's schema rules and gives the `anon` and `authenticated` roles no rows and no writes, an `.env.example` with placeholders only, and a README that describes the Supabase setup. The test suite SHALL pass with no network, no Supabase project, and no MongoDB server or binary.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.10, 2.11, 2.19, 2.20, 2.21**

Property 2: Preservation - Clients and operators see the same results

_For any_ request, socket handshake, or seed run where isDeliberateChange does not hold, whether or not isBugCondition holds, the fixed server SHALL produce the same normalized client-visible result as the original server: status code, error message, JSON body, Socket.IO events with their target rooms and payloads, and the seed's console output. normalize() only removes `__v`, null-valued optional keys, and the difference between a missing and an empty `patient` or `location` object.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24, 3.25**

Property 3: Migration - Faithful, read-only, repeatable copy

_For any_ collection of MongoDB user and incident documents, and any number of migration runs with documents added between runs, the migration SHALL send only reads to MongoDB. Every copied record SHALL keep its id, and its normalized API view SHALL equal the original API view of its document, with bcrypt hashes and millisecond timestamps unchanged and today's defaults filled in for missing fields. A row already in Supabase SHALL never be duplicated or overwritten. Links to missing or skipped users SHALL be emptied, links to users matched by email SHALL be re-pointed, and records that break a table rule SHALL be skipped and listed with their id and reason. The report SHALL give the counts per table, and the exit code SHALL be 0 exactly when no record was skipped with an error. After the migration, JWTs issued before the switch and the old passwords SHALL keep working for every migrated user.

**Validates: Requirements 2.8, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 3.6, 3.26**

Property 4: Deliberate changes - Values only, unknown ids, nulls, NUL

_For any_ request that carries an object-shaped or other non-scalar lookup value, a PATCH id that matches no incident, an explicit null in an optional field, or text containing U+0000, the fixed server SHALL treat each lookup value as a plain value, so that a non-scalar value matches nothing (`status[$ne]=PENDING` returns `[]`, an object `from` links no reporter); SHALL answer the PATCH with 404 `{ error: 'Incident not found' }` and emit nothing; SHALL leave out every key whose value is null and never send `__v`; and SHALL store and look up text with U+0000 removed instead of failing.

**Validates: Requirements 2.22, 2.23, 2.24, 2.25**

## Fix Implementation

### Design decisions

**D1. Driver: `pg` in production, PGlite in tests, pglite-socket for the production adapter** (2.1, 2.10, 2.19, 2.22)

Decision: the server uses node-postgres with a `pg.Pool`. All data code goes through a small handle with `query` and `transaction` (`src/db/client.js`). Tests install a PGlite-backed handle in-process. The adapter contract test, and every test that spawns `src/index.js`, `src/seed.js`, or `migration/cli.js`, run the production pool against PGlite through pglite-socket on 127.0.0.1.

- Direct SQL gives transactions (for the acknowledgement rule), `ON CONFLICT DO NOTHING` (for the migration), and exact text and number semantics. The same `schema.sql` runs in PGlite, so tests exercise the real CHECK constraints, defaults, foreign keys, and RLS.
- `@supabase/supabase-js` goes through PostgREST, which has no multi-statement transactions, so the acknowledgement rule would need a SQL function called over RPC. Offline tests would need a fake REST API that enforces none of the table rules, so the tests would no longer check the CHECK constraints, defaults, or RLS that 2.20 and 2.21 require.
- Running the whole suite through pglite-socket would test the production driver everywhere. PGlite is a single session, though, and the socket server multiplexes every connection onto it; its docs warn that not every case is covered, and concurrent transactions from a pool are the obvious risk. Using it with one pool connection, and only where the production pool must run, keeps that risk contained.

Driver contract, from differences probed between pg 8.23.1 and PGlite 0.5.17:
- Parameters are only `string`, `number`, `boolean`, or `null`. Timestamps are sent as ISO strings, and filter lists are expanded into `$n` placeholders instead of array parameters.
- Timestamps are read as `(extract(epoch from col) * 1000)::float8 AS <name>_ms` and turned into `Date` in JavaScript. This is exact for every millisecond value from year 0001 to 9999 (probed). The code never relies on driver date parsing, because PGlite's default `timestamptz` parser turned year 0001 into 2001.
- Counts are cast with `::int`, because pg returns `count(*)` as a string and PGlite as a number.
- U+0000 is removed before any text reaches a query. PGlite rejects it with error 22021, and pg through the socket lost the connection.

**D2. Connectivity and TLS** (2.1, 2.19)

Decision: `DATABASE_URL` is the Session pooler string from the Supabase dashboard (Connect, then Session pooler). `DATABASE_CA_CERT` is the path to the server root certificate from Database Settings, SSL Configuration.

- **Pooler.** The direct host `db.<project-ref>.supabase.co` is IPv6-only on the Free and Pro plans unless the project buys the IPv4 add-on, and many home, campus, and hosting networks have no IPv6. Supabase's docs recommend the shared pooler in session mode for a persistent backend on an IPv4-only network. Session mode gives each pool client its own backend session, so transactions and prepared statements behave as on a direct connection. Transaction mode (port 6543) is meant for serverless functions and drops session state between transactions; this long-running server does not need it. Where IPv6 works, the direct string also works, because the code does not depend on the host.
- **TLS.** node-postgres applies SSL settings parsed from a connection string over the `ssl` object passed in code, and current pg-connection-string treats `sslmode=require` as full verification against Node's CA list. Supabase's certificate chains to Supabase's own root, so that combination fails with "self-signed certificate in certificate chain". `src/db/pg.js` therefore builds the pg config from the URL's host, port, user, password (percent-decoded), and database, ignores query parameters such as `sslmode`, and sets `ssl` itself:
  - Loopback host (`localhost`, `127.0.0.1`, `::1`): `ssl: false`, for a local Postgres and for pglite-socket in tests.
  - Any other host: `ssl: { ca: <contents of DATABASE_CA_CERT>, rejectUnauthorized: true }`. Node also checks the host name, which matches libpq's `verify-full`. Supabase's psql guide uses the same mode against the pooler host.
  - Any other host without `DATABASE_CA_CERT`: startup fails with "Supabase connection failed: DATABASE_CA_CERT is not set".

  Trade-off: failing closed adds one setup step, downloading a public certificate. Encrypting without verification would work with no setup, but allows a man-in-the-middle on shared networks.
- **Pool.** `max: 5`, because session mode holds one pooler slot per client and the seed, the migration, and the SQL editor need room. An optional `DATABASE_POOL_MAX` overrides it; tests that spawn processes set it to 1 for pglite-socket. `connectionTimeoutMillis: 10000`, so a wrong host fails startup instead of hanging. `idleTimeoutMillis: 30000` and `keepAlive: true`. An `error` listener on the pool logs a dropped idle connection instead of crashing the process.
- **Secrets in output.** `safeMessage(err)` replaces `DATABASE_URL`, its decoded password, and `MONGODB_URI` with `[redacted]` in every message the server, seed, or migration prints. Database errors are logged as SQLSTATE code plus message. pg's `detail` field is never logged, because it can contain the failing row (probed: "Failing row contains (…)", which for `users` includes the bcrypt hash).

**D3. Schema file and public access** (2.13, 2.20, 2.21)

Decision: one idempotent file, `server/db/schema.sql`, which the README tells people to paste into the Supabase SQL Editor and which the tests apply to PGlite. The tables live in `public` with RLS enabled, no policies, and every privilege revoked from `anon` and `authenticated`. The revoke runs inside a `DO` block that checks `pg_roles`, so the same file applies in PGlite, where those roles do not exist.

- **One guarded file instead of a Supabase-only second file.** People run one script, and the guarded statements are still tested: the access test creates `anon` and `authenticated` in PGlite with Supabase-style default grants before applying the file. Probed: `anon` then gets "permission denied for table users", and with a grant left in place, `authenticated` reads `[]` and inserts fail with "new row violates row-level security policy".
- **`public` with RLS and revoke, instead of a schema hidden from the Data API.** Supabase documents this setup for tables in an exposed schema: enable RLS, and revoke the grants that existing projects give `anon` and `authenticated` on new tables. RLS and the revoke apply to these tables whichever schemas the Data API exposes, so PostgREST and GraphQL both get nothing. A private schema would need schema-qualified names and dashboard settings without blocking anything more.
- **The server keeps full access.** It connects as `postgres`, the owner of tables created in the SQL Editor, and owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set. The file must not set it. Supabase's Security Advisor will report "RLS enabled, no policy" for both tables, which is intended.
- **Ids.** `text` with `CHECK (id ~ '^[0-9a-f]{24}$')`. Migrated ObjectIds keep their value. New ids come from `newId()` in Node, which uses the ObjectId layout (4-byte seconds, 5 random bytes per process, 3-byte counter), so new ids sort by creation time like ObjectIds and need no Postgres extension. Stored ids are always lowercase.
- **Numbers.** `double precision` for `lat`, `lng`, `accuracy`, `age`, and `response_time_sec`, never `numeric`, `integer`, or `bigint`. Both drivers return JS numbers, and Mongo's `Number` is a double, so age may have decimals and a migrated `responseTimeSec` need not be whole. Postgres prints the shortest round-trip form. Probed through both drivers: `0.1 + 0.2`, `5e-324`, `Infinity`, and `NaN` came back identical, and through PGlite also `14.599999999999998` and `2**53 + 2`. `-0` comes back as `0`, which JSON cannot tell apart anyway.
- **Allowed values.** `text` columns with `CHECK (... IN (...))`, not Postgres enum types, so a filter with an unknown value returns no rows instead of an error (probed, 3.14). `NULL` passes these checks, as it passes Mongoose's enum validator.
- **Defaults.** Columns with a Mongoose default get the same SQL `DEFAULT` and stay nullable, because Mongoose stores an explicit null and the API accepts one today (`patientStatus: null` gives 201).
- **Timestamps.** `created_at` and `updated_at` are `NOT NULL`, because Mongoose always writes them.
- **Links.** `reporter_id` and `handled_by` reference `users(id)` with `ON DELETE SET NULL`. No route deletes users, but if someone deletes one in the dashboard, the responder routes show `reporter: null` for that user's incidents, as populate does today for a dangling ObjectId. `/mine`, which shows plain ids, would show `null` or no `handledBy` where today it shows the old id. That only affects app incidents whose responder account was deleted by hand, and the mobile app does not read `handledBy`.

**D4. Data-access layer** (2.3 to 2.7, 2.22)

Decision: `src/db/` holds the database handle, the cast and field rules, the serializer, and two repositories. `src/models/` is deleted. The enum lists move to `src/lib/enums.js`, which does no I/O, so `lib/incidentInput.js` stays pure. `CATEGORIES`, `PATIENT_STATUSES`, and `STATUSES` keep their names and values.

SQL text is built only from constant fragments, column names from the fixed field tables in `fields.js`, and generated `$n` placeholders. Every request value is a bound parameter.

**D5. One serializer** (2.24, 3.13, 3.17 to 3.19)

`incidentJson(row, { populate })` in `src/db/serialize.js` builds the API view. The same object goes to `res.json` and to every `emit`, so HTTP and Socket.IO match.
- `_id` is the id string.
- `reporter` is always present. With `populate`, it is `{ _id, name, phone, email }`, without `phone` when it is null, or `null` when there is no reporter or no joined user. Without `populate` (`/mine`), it is the plain id or `null`.
- `deviceId` is always present, `null` when empty.
- `handledBy` is present only when set: `{ _id, name }` with `populate`, the plain id without.
- `patient` (`name`, `sex`, `age`) and `location` (`lat`, `lng`, `accuracy`, `description`) are always objects, possibly empty. Mongoose omits a nested object that has no fields; only hand-made legacy documents have none, and both clients read these fields with optional chaining (`Dashboard.jsx`, `MapView.jsx`, `AlertPopup.jsx`, `LogScreen.js`).
- Every other key is left out when its value is null (2.24, 3.18). `__v` is never sent.
- Timestamps are `new Date(ms).toISOString()`, numbers are sent as stored, and a stored `Infinity` or `NaN` becomes JSON `null` through `JSON.stringify`, as today.

`publicUser(u)` in `routes/auth.js` returns `{ id, name, email, phone, role }` and leaves out `phone` and `role` when they are null.

**D6. Mongoose behavior: kept and changed** (3.10 to 3.16, 3.20, 2.22 to 2.25)

Kept on purpose:

| Behavior today (mongoose 8.24.7) | Kept by | Clause |
|---|---|---|
| String cast: number or boolean becomes text, `{ _id: '<string>' }` becomes that string, arrays and plain objects fail | `castString` | 3.11 |
| Number cast: `''` becomes null, numeric strings and booleans go through `Number()`, `{ _id }` casts the `_id`, NaN, arrays, and objects fail | `castNumber` | 3.11 |
| Boolean cast: `true`, `'true'`, `1`, `'1'`, `'yes'` and their false forms (migration only) | `castBoolean` | 2.13 |
| Trim on `name`, `email`, `phone`, `deviceId`, `nature`, `outcome`, `notes`; lowercase on `email`; `''` stays `''` | field rules `trim`, `lowercase` | 3.4, 3.10 |
| Setters on lookups: email trimmed and lowercased, phone trimmed | `findUserByEmail`, `findUserByPhone` | 3.4, 3.5, 3.16, 3.22 |
| Defaults only for undefined; explicit null stored as null | `prepareWrite` | 3.9 |
| `required` fails on missing, null, or `''` after trim | `prepareWrite` and CHECK | 3.12 |
| Enum lets null through, rejects `''` and unknown values | `prepareWrite` and CHECK | 3.12 |
| `deviceId` at most 128 characters after trim | `prepareWrite` and CHECK | 3.12 |
| Duplicate email fails (E11000, 500) when the route's check did not catch it | `users_email_key` (23505), 500 | 3.12 |
| An array filter value means "any of" | `IN ($n, …)` over the string elements | 3.14 |
| Unknown enum value in a filter returns `[]` | text column with CHECK | 3.14 |
| Unparsable `from` or `to` fails (500) | same `new Date(x)` test, then throw | 3.14 |
| Malformed id in a JWT throws CastError, so `requireAuth` answers "Session expired" | `toId` throws inside `findUserById` | 3.7 |
| Uppercase hex finds the record | `toId` lowercases 24-hex input | 3.2, 3.15 |
| `createdAt` equals `updatedAt` on create; `updatedAt` changes only when a stored value changes | one Node `now` per write; `updateIncident` compares old and new values | 3.20 |
| Populate selects `name phone email` and `name`; a missing user gives null | `LEFT JOIN` and serializer | 3.19 |
| Sort `createdAt` descending, limits 100 and 500 | `ORDER BY created_at DESC, id DESC LIMIT n`; equal timestamps were unordered before and now fall back to id order | 3.13, 3.14 |
| `findOne({ phone })` takes the first match | `ORDER BY created_at, id LIMIT 1` | 3.16 |

Changed on purpose:

| Today | After the fix | Clause |
|---|---|---|
| An object filter value with `$` keys runs as an operator (`status[$ne]=X`) | matches nothing, `[]` | 2.22 |
| An object filter value without `$` keys, or an array with an object element, fails with CastError (500) | the object matches nothing; other array elements still match | 2.22 |
| SMS `from` as an array becomes `$in`; as an object it runs as an operator or fails (500) | links no reporter; the incident is created (201) | 2.22 |
| An undefined lookup key is dropped, so it matches any record (a forged JWT without `id`; the seed with `SEED_RESPONDER_EMAIL` unset) | matches nothing ("Account unavailable"; the seed then fails because the email is required) | 2.22 |
| PATCH with a non-ObjectId id fails with CastError (500) | 404 `{ error: 'Incident not found' }`, nothing emitted | 2.23 |
| Explicit nulls and `__v` are sent | left out | 2.24 |
| U+0000 is stored and matched as is | removed before casting, storage, and lookups, including in `normalizeDeviceId` so socket rooms match stored values. Consequences: an enum value that is valid once NULs are removed is accepted, a required value made only of NULs counts as empty, and a Device_ID made only of NULs is treated as missing | 2.25 |

**D7. Startup and seed** (2.1, 2.2, 3.22, 3.23)

- `src/index.js` calls `createApp()`, then `connectDatabase(process.env)`, which builds the pool and runs `SELECT 1 FROM public.users LIMIT 1` and `SELECT 1 FROM public.incidents LIMIT 1`. Only then does it call `server.listen`. Any failure logs `Supabase connection failed: <safeMessage>` and exits with code 1. Examples of reasons: `DATABASE_URL is not set`, `DATABASE_CA_CERT is not set`, `connect ECONNREFUSED 127.0.0.1:5432`, `password authentication failed for user "postgres.<ref>"`, `relation "public.users" does not exist`.
- `src/seed.js` connects the same way, calls `findUserByEmail(SEED_RESPONDER_EMAIL)`, which trims and lowercases like Mongoose's query setters, then either logs `Responder already exists: <email>` or calls `createUser` with name "Infirmary Nurse", role responder, and `bcrypt.hash(SEED_RESPONDER_PASSWORD, 10)`, and logs `Created responder: <email>`. It then calls `db.end()`, so the process exits. A connection failure logs `Supabase connection failed: <reason>` and exits 1.

**D8. Migration** (2.8, 2.12 to 2.18, 3.6, 3.26)

Decision: a top-level `server/migration/` folder, which the server never imports. Only `migration/cli.js` imports the `mongodb` driver; `source.js` receives the driver's `Db` object, and `map.js` recognizes ObjectIds by their `_bsontype` without importing bson. Mapping, running, and reporting are separate modules, so tests feed plain documents (bson `ObjectId` and `Date` values need no server) and a PGlite target. The algorithm, mapping rules, and report are under "Migration details" below.

- It reads the database named in `MONGODB_URI`'s path, or `test` when the path is empty, which is where Mongoose wrote by default. It reads the `users` and `incidents` collections, the names Mongoose gave the `User` and `Incident` models.
- Users go first, then incidents, so links can be resolved.
- Inserts use `ON CONFLICT (id) DO NOTHING`, one record per statement, so one bad record never blocks the others and a re-run continues where the last one stopped. The data set is small (one campus), so batching is not needed.
- A user whose email already belongs to a different Supabase user counts as "already present (by email)". The record is not copied, but the person exists in Supabase and every link points there. Reading 2.15 with 2.18, this is not an error and does not make the exit code non-zero.
- Because re-runs never overwrite, a rehearsal must use a scratch Supabase project, or the tables must be emptied (`TRUNCATE public.incidents, public.users`) before the final run. Otherwise changes made in MongoDB after the rehearsal would not be copied. The README says so.

**D9. Tests** (2.10, 3.25)

Decision: every DB-backed suite goes through the store harness, which keeps the same exports before and after the fix. Before the fix its body uses mongodb-memory-server, so the ported suites and the new preservation properties can run on F. The fix replaces the body with PGlite and deletes the MongoDB version together with mongoose and mongodb-memory-server. Details are in the Testing Strategy.

**D10. Dependencies, environment, and docs** (2.1, 2.9, 2.10, 2.11)

- `dependencies`: remove `mongoose`, add `pg`. `react-dom` stays as it is (out of scope).
- `devDependencies`: remove `mongodb-memory-server`; add `@electric-sql/pglite`, `@electric-sql/pglite-socket`, and `mongodb@^6.20.0`. The driver is only for the migration and for building bson values in tests, so production installs (`npm ci --omit=dev`) never get a MongoDB driver (2.1). Version 6 is the major Mongoose 8 uses today; mongodb 7 needs Node 20.19 or later, while the README promises Node 20.
- Scripts: add `"migrate:mongo": "node migration/cli.js"`. `test` stays `node --test`. That runner also loads files under `test/helpers/`; they define no tests and do nothing when imported.
- `.env.example` and the README are rewritten as described under Changes Required. `server/.env`, which holds real secrets, is not read or edited. The README tells the user to add the new keys to their own `.env`.

### Database setup: `server/db/schema.sql`

```sql
-- CampusSOS database setup. Paste into the Supabase SQL Editor (or run with psql).
-- Safe to run more than once. The offline tests apply this same file to PGlite.

CREATE TABLE IF NOT EXISTS public.users (
  id         text        PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),   -- ObjectId hex
  name       text        NOT NULL CHECK (name <> ''),
  email      text        NOT NULL CHECK (email <> ''),                -- lowercase, written by the server
  password   text        NOT NULL CHECK (password <> ''),             -- bcrypt hash
  phone      text,
  role       text        DEFAULT 'user' CHECK (role IN ('user', 'responder', 'admin')),
  active     boolean     DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.incidents (
  id                   text        PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  reporter_id          text        REFERENCES public.users (id) ON DELETE SET NULL,
  device_id            text        CHECK (char_length(device_id) <= 128),
  for_self             boolean     DEFAULT true,
  patient_name         text,
  patient_sex          text        DEFAULT 'UNKNOWN'
                                   CHECK (patient_sex IN ('M', 'F', 'OTHER', 'UNKNOWN')),
  patient_age          double precision,
  nature               text,
  category             text        NOT NULL CHECK (category IN ('MEDICAL_EMERGENCY', 'INJURY',
                                   'FAINTING', 'ALLERGIC_REACTION', 'MENTAL_HEALTH_CRISIS', 'OTHER')),
  patient_status       text        DEFAULT 'UNKNOWN' CHECK (patient_status IN ('CONSCIOUS_BREATHING',
                                   'CONFUSED', 'UNCONSCIOUS', 'NOT_BREATHING', 'BLEEDING', 'IN_PAIN',
                                   'UNKNOWN')),
  location_lat         double precision,
  location_lng         double precision,
  location_accuracy    double precision,
  location_description text,
  source               text        DEFAULT 'APP' CHECK (source IN ('APP', 'SMS')),
  status               text        DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACKNOWLEDGED',
                                   'EN_ROUTE', 'ON_SCENE', 'RESOLVED', 'CANCELLED')),
  acknowledged_at      timestamptz,
  resolved_at          timestamptz,
  response_time_sec    double precision,
  outcome              text,
  notes                text,
  handled_by           text        REFERENCES public.users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL
);

-- Newest-first listing of all incidents, by reporter, and by Device_ID (2.21)
CREATE INDEX IF NOT EXISTS incidents_created_at_idx
  ON public.incidents (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS incidents_reporter_created_at_idx
  ON public.incidents (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_device_created_at_idx
  ON public.incidents (device_id, created_at DESC, id DESC);

-- No access through the Data API with the anon key or as a Supabase Auth user (2.20).
-- RLS with no policies hides every row; the revoke also removes the default grants.
-- Do not add policies or FORCE ROW LEVEL SECURITY: the server connects as the table owner.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.users, public.incidents FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
```

A test keeps the CHECK lists equal to `src/lib/enums.js` (see `test/schema.test.js`).

### Data layer: `server/src/db/`

**`client.js`**: the one database handle.
```js
// Param = string | number | boolean | null   (timestamps as ISO strings; no arrays or objects)
// Queryable = { query(text: string, params?: Param[]): Promise<{ rows: object[], rowCount: number }> }
// Db = Queryable & { transaction(fn: (tx: Queryable) => Promise<T>): Promise<T>, end(): Promise<void> }
export function setDb(db)      // index.js, seed.js, migration/cli.js, and tests call this once
export function getDb()        // repositories; throws 'Database is not connected' if unset
```

**`pg.js`**: production adapter.
```js
export function poolConfigFromEnv(env)        // pure: URL parts, ssl rule (D2), pool options; throws a safe Error
export function createPgDb(config)            // wraps pg.Pool as a Db; transaction = connect, BEGIN, fn, COMMIT or ROLLBACK, release
export async function checkTables(db)         // SELECT 1 FROM public.users LIMIT 1; SELECT 1 FROM public.incidents LIMIT 1
export async function connectDatabase(env)    // poolConfigFromEnv + createPgDb + checkTables; ends the pool on failure
export function safeMessage(err, env)         // message with DATABASE_URL, its password, and MONGODB_URI redacted
export function describeError(err, env)       // for logs: 'Database error <code>: <message>' or a redacted stack
```

**`ids.js`**
```js
export function newId(nowMs = Date.now())   // 24 lowercase hex chars, ObjectId layout
export function toId(value)                 // null/undefined -> null; ObjectId-like or 24-hex string -> lowercase hex;
                                            // anything else -> throws InvalidIdError
export class InvalidIdError extends Error {}
```

**`cast.js`**: mirrors of `mongoose/lib/cast/{string,number,boolean,date}.js` plus the `_id` unwrapping in `SchemaNumber.prototype.cast`.
```js
export function castString(value)    // throws CastError
export function castNumber(value)
export function castBoolean(value)
export function castDate(value)      // migration only
export function stripNul(text)       // removes U+0000 (2.25)
export class CastError extends Error // { path, kind }; the message never contains the value
```

**`fields.js`**: the Mongoose schemas as data, shared by the repositories and the migration.

| API path | Column | Type | Rules | Default |
|---|---|---|---|---|
| `name` | `name` | string | trim, required | |
| `email` | `email` | string | trim, lowercase, required | |
| `password` | `password` | string | required | |
| `phone` | `phone` | string | trim | |
| `role` | `role` | string | enum `ROLES` | `'user'` |
| `active` | `active` | boolean | | `true` |
| `reporter` | `reporter_id` | id | | |
| `deviceId` | `device_id` | string | trim, maxlength 128 | |
| `forSelf` | `for_self` | boolean | | `true` |
| `patient.name` | `patient_name` | string | | |
| `patient.sex` | `patient_sex` | string | enum `SEXES` | `'UNKNOWN'` |
| `patient.age` | `patient_age` | number | | |
| `nature` | `nature` | string | trim | |
| `category` | `category` | string | required, enum `CATEGORIES` | |
| `patientStatus` | `patient_status` | string | enum `PATIENT_STATUSES` | `'UNKNOWN'` |
| `location.lat`, `.lng`, `.accuracy` | `location_lat`, `_lng`, `_accuracy` | number | | |
| `location.description` | `location_description` | string | | |
| `source` | `source` | string | enum `SOURCES` | `'APP'` |
| `status` | `status` | string | enum `STATUSES` | `'PENDING'` |
| `acknowledgedAt`, `resolvedAt` | `acknowledged_at`, `resolved_at` | date | | |
| `responseTimeSec` | `response_time_sec` | number | | |
| `outcome`, `notes` | `outcome`, `notes` | string | trim | |
| `handledBy` | `handled_by` | id | | |
| `createdAt`, `updatedAt` | `created_at`, `updated_at` | date | set by the repository from the Node clock | |

```js
export const USER_FIELDS, INCIDENT_FIELDS
export function prepareWrite(fields, input, { setters })   // -> { [column]: Param }; throws ValidationError
export class ValidationError extends Error                 // { path, kind: 'cast' | 'required' | 'enum' | 'maxlength' }
```
Per field: an undefined value takes the default, or NULL when there is none. Any other value is cast for its type, has U+0000 removed if it is text, and gets the trim and lowercase setters (server writes only, not the migration). Every field is then validated (required, enum, maxlength), so a missing `category` fails like an empty one. Validation errors reach the Express error handler and become 500 before any SQL runs, as Mongoose's ValidationError does today.

**`serialize.js`**
```js
export function incidentJson(row, { populate })   // API view (D5)
export function userRecord(row)                   // { id, name, email, phone, role, active, createdAt, updatedAt } (+ password if selected)
```

**`users.js`**
```js
export async function findUserById(id)                                   // toId(id); null -> null; malformed -> throws
export async function findUserByEmail(email, { withPassword = false } = {})
        // string, number, or boolean -> castString, stripNul, trim, lowercase; anything else -> null
export async function findUserByPhone(phone)
        // string, number, or boolean -> castString, stripNul, trim; anything else -> null;
        // WHERE phone = $1 ORDER BY created_at, id LIMIT 1
export async function createUser(input, { now = new Date() } = {})       // prepareWrite + newId + INSERT ... RETURNING
export async function insertUserRow(q, row)                              // shared with the migration
```

**`incidents.js`**
```js
export async function createIncident(input, { now = new Date() } = {})
        // prepareWrite + newId; WITH ins AS (INSERT ... RETURNING *) SELECT ... LEFT JOIN users r -> incidentJson(populate)
export async function listIncidentsByDevice(deviceId)
        // WHERE device_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100 -> incidentJson(plain ids)
export async function listIncidents({ status, category, from, to })
        // filters below; LEFT JOIN users r, users h; ORDER BY created_at DESC, id DESC LIMIT 500
export async function updateIncident(id, mutate, { now = new Date() } = {})
        // returns incidentJson(populate) or null when nothing matches
export async function insertIncidentRow(q, row)                          // shared with the migration
```

`listIncidents` filters:
- `status` and `category` use the same truthiness test as today. A string becomes a one-value list, an array keeps its string elements, and an object becomes an empty list (2.22). Each value has U+0000 removed. A non-empty list becomes `col IN ($i, …)`, and an empty list becomes `FALSE`.
- `from` and `to` use the same `if (from || to)` and `new Date(x)` as today. An invalid date throws, which gives 500. Valid bounds become `created_at >= $i::timestamptz` and `created_at <= $j::timestamptz`. A bound before 0001-01-01 is sent as `'-infinity'`, and one after 9999-12-31T23:59:59.999Z as `'infinity'`. Probed: Postgres rejects the extended-year strings `toISOString` writes, and every stored timestamp falls inside that range, so comparisons give the same answer as today for every valid JS date.
- Dates are checked before any query runs, so an invalid date still gives 500 when another filter matches nothing, as today.

`updateIncident(id, mutate)`:
```
id := toId(id), and return null for InvalidIdError                         // 2.23: 404, no query
RETURN db.transaction(tx =>
  row := SELECT <columns> FROM incidents WHERE id = $1 FOR UPDATE           // locks out a concurrent PATCH
  IF no row THEN RETURN null                                                // 404 comes before any validation, as today
  draft := editable copy of row (API names; Date values; null columns become undefined)
  mutate(draft)                                                             // the route's code, unchanged
  changes := for each writable field the route assigned:
               value := prepareWrite rule for that field (cast, strip NUL, setters, validate)
               keep it only if it differs from the stored value             // ' x ' trimmed to the stored 'x' is no change
  IF changes is not empty THEN
    UPDATE incidents SET <changed columns>, updated_at = $now WHERE id = $1 // 3.20
  RETURN incidentJson(SELECT <columns + joined users> WHERE id = $1, populate) )
```
A validation error rolls the transaction back, so nothing changes and nothing is emitted (3.12). The row lock also means a second concurrent PATCH sees the first one's `acknowledgedAt` and leaves the three acknowledgement fields alone (3.15). Today two concurrent saves could both set them.

Trade-off: a single `UPDATE ... SET col = CASE ... END ... RETURNING` would be just as atomic and saves two round trips. It would also move `Math.round`, the setters, the "did anything change" test, and the rule that 404 wins over a validation error into SQL, where they are harder to compare with today's code. The short transaction keeps the route's JavaScript line for line, and PATCH is rare (a responder clicking a button), so the extra round trips do not matter.

### Route-to-repository mapping

| Caller | Today (Mongoose) | After the fix |
|---|---|---|
| `src/index.js` startup | `mongoose.connect(MONGODB_URI)` | `connectDatabase(process.env)`, then `setDb(db)`, then `listen` |
| `src/seed.js` | `User.findOne({ email })`, `User.create(...)` | `findUserByEmail(email)`, `createUser(...)`, `db.end()` |
| `POST /api/auth/register` | `User.findOne({ email: email.toLowerCase() })`, `User.create(...)` | `findUserByEmail(email.toLowerCase())`, `createUser({ name, email, phone, password })` |
| `POST /api/auth/login` | `User.findOne(...).select('+password')` | `findUserByEmail((email \|\| '').toLowerCase(), { withPassword: true })` |
| `requireAuth` (all protected routes) | `User.findById(payload.id)` | `findUserById(payload.id)` |
| `GET /api/auth/me` | `publicUser(req.user)` | same; `req.user` is a `userRecord` |
| `POST /api/incidents` | `Incident.create(doc)`, `populate('reporter')` | `createIncident(result.doc)` |
| `GET /api/incidents/mine` | `Incident.find({ deviceId }).sort(...).limit(100)` | `listIncidentsByDevice(deviceId)` |
| `GET /api/incidents` | `Incident.find(q).sort(...).limit(500).populate(...)` | `listIncidents(req.query)` |
| `PATCH /api/incidents/:id` | `findById`, mutate, `save()`, `populate(...)` | `updateIncident(req.params.id, mutate)`; the mutate callback is today's code with `req.user.id` |
| `POST /api/sms/inbound` | `User.findOne({ phone: from })`, `Incident.create(...)`, `populate` | `findUserByPhone(from)`, `createIncident({ reporter: reporter?.id, ... })`; responds `{ ok: true, id: full._id }` |

Unchanged code: `src/socket.js`, `src/lib/rooms.js`, `buildAppIncident`, `parseSosSms`, the CORS setup, the health route, and every status code and message in the routes.

### Migration details: `server/migration/`

**Modules**
```js
// cli.js       npm run migrate:mongo. Loads .env, connects Supabase (connectDatabase) and MongoDB
//              (MongoClient, serverSelectionTimeoutMS 10000), runs, prints the report, sets the exit code.
// source.js    export function mongoSource(mongoDb)
//                -> { users: () => mongoDb.collection('users').find({}, { sort: { _id: 1 } }),
//                     incidents: () => mongoDb.collection('incidents').find({}, { sort: { _id: 1 } }) }
// map.js       export function mapUser(doc)     -> { ok: true, row, unknown } | { ok: false, id, reason, unknown }
//              export function mapIncident(doc) -> { ok: true, row, unknown } | { ok: false, id, reason, unknown }
// run.js       export async function runMigration({ source, db }) -> stats
// report.js    export function formatReport(stats) -> string
//              export function exitCodeFor(stats)  -> 0 | 1
```

**Mapping rules** (`map.js`, pure):
- `_id`: an ObjectId (`_bsontype === 'ObjectId'`) becomes `toHexString()`, and a 24-hex string is lowercased. Anything else is an error: "id is not an ObjectId".
- Each schema field goes through the same type cast as the server and has U+0000 removed, but gets no trim or lowercase. Those setters ran when the value was first written, and the API shows stored values as they are.
- An absent key gets the value the API shows today (2.13): `forSelf` true, `patient.sex` UNKNOWN, `patientStatus` UNKNOWN, `source` APP, `status` PENDING, `role` user, `active` true. A key that holds null stays null; Mongoose shows null today, and 2.24 then leaves it out. A `patient` or `location` value that is not an object counts as absent.
- A missing `createdAt` or `updatedAt`, or any date outside 0001-01-01 to 9999-12-31, is an error, because the columns are NOT NULL and Postgres cannot read the extended years `toISOString` writes.
- Cast failures and required, enum, and maxlength failures are errors that name the field and the rule, never the value.
- `reporter` and `handledBy`: an ObjectId or 24-hex string becomes the hex id, and null or absent becomes null. Any other value is treated as a link to a user that does not exist (emptied, 2.14).
- `__v` is dropped silently. Any other key outside the schema, at the top level or inside `patient` or `location`, is dropped and counted by path, for example `location.floor`.

**Run** (`run.js`):
```
idMap := {}                                     // MongoDB user id -> Supabase user id, or null
FOR EACH doc IN source.users():                  // ascending _id
  m := mapUser(doc); count m.unknown
  IF NOT m.ok THEN users.skipped += (m.id, m.reason); idMap[m.id] := null; CONTINUE       // 2.17
  IF a users row has id m.row.id THEN users.presentById += 1; idMap[id] := id; CONTINUE    // 2.16
  other := SELECT id FROM users WHERE email = m.row.email
  IF other THEN users.presentByEmail += (id, email, other.id); idMap[id] := other.id; CONTINUE  // 2.15
  TRY INSERT ... ON CONFLICT (id) DO NOTHING RETURNING id
      a row back: users.copied += 1, idMap[id] := id; no row: users.presentById += 1, idMap[id] := id
  CATCH e: IF e.constraint = 'users_email_key' THEN handle as presentByEmail (re-read by email)
           ELSE users.skipped += (id, safeMessage(e)); idMap[id] := null

FOR EACH doc IN source.incidents():              // ascending _id
  m := mapIncident(doc); count m.unknown
  IF NOT m.ok THEN incidents.skipped += (m.id, m.reason); CONTINUE                        // 2.17
  FOR link IN (reporter_id, handled_by) WHERE m.row[link] ≠ null:
    target := idMap[m.row[link]]                 // undefined when it is not a MongoDB user id
    IF target is null or undefined THEN m.row[link] := null; pending.emptied += 1          // 2.14
    ELSE IF target ≠ m.row[link] THEN m.row[link] := target; pending.repointed += 1        // 2.15
  TRY INSERT ... ON CONFLICT (id) DO NOTHING RETURNING id
      a row back: incidents.copied += 1; add pending counts to links
      no row: incidents.presentById += 1         // the existing row is left as it is (2.16)
  CATCH e: incidents.skipped += (id, safeMessage(e))
```
Only `find()` reaches MongoDB (2.12), and the plain driver builds no indexes, unlike Mongoose's autoIndex. The README suggests running the migration as an Atlas user with only the `read` role.

**Report** (2.18), for example:
```
MongoDB -> Supabase migration
Users:      copied 12, already present 4 (3 by id, 1 by email), skipped with an error 1
Incidents:  copied 230, already present 0, skipped with an error 2
Links:      emptied 3, re-pointed 5
Already present by email (links point to the Supabase user):
  users      65a1b2c3d4e5f6a7b8c9d0e1  nurse@cvsu.edu.ph -> 66f0a1b2c3d4e5f6a7b8c9d0
Skipped with an error:
  users      65a1b2c3d4e5f6a7b8c9d0e2  name: required
  incidents  65b2c3d4e5f6a7b8c9d0e1f2  category: not an allowed value
Fields not copied (not in today's schemas):
  incidents  priority (3), location.floor (1)
```
Exit codes: 0 when nothing was skipped with an error; 1 when any record was skipped with an error; 2 when the script cannot connect to MongoDB or Supabase, or a connection drops during the run. Running it again is safe in every case. Connection failures print `MongoDB connection failed: <reason>` or `Supabase connection failed: <reason>`, both through `safeMessage`.

### Changes Required

Assuming our root cause analysis is correct:

**File**: `server/package.json`
- Remove `mongoose` and `mongodb-memory-server`; add `pg`, `@electric-sql/pglite`, `@electric-sql/pglite-socket`, and `mongodb@^6.20.0` as in D10; add the `migrate:mongo` script.

**File**: `server/.env.example` (2.9)
- Rewrite with placeholders only, keeping the existing keys and comments:
```
PORT=4000
JWT_SECRET=change-this-to-a-long-random-string
# Browser origins allowed to call the API: staff dashboard (5173) and Expo web (8081).
# If another device opens the app in a browser, add http://YOUR-LAPTOP-IP:8081 here.
CLIENT_ORIGIN=http://localhost:5173,http://localhost:8081
SMS_WEBHOOK_SECRET=change-me
SEED_RESPONDER_EMAIL=nurse@cvsu.edu.ph
SEED_RESPONDER_PASSWORD=nurse
# Supabase Postgres (server only). Dashboard > Connect > Session pooler. Format:
# postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres
# Percent-encode special characters in the password. Query parameters such as sslmode are ignored.
DATABASE_URL=
# Server root certificate from Database Settings > SSL Configuration. Required unless the host is localhost.
DATABASE_CA_CERT=./supabase-ca.crt
# Used only by `npm run migrate:mongo` to copy the old MongoDB data. Leave empty otherwise.
MONGODB_URI=
```

**File**: `server/db/schema.sql` (new): the SQL above.

**Files**: `server/src/db/{client,pg,ids,cast,fields,serialize,users,incidents}.js` (new): as specified above.

**File**: `server/src/lib/enums.js` (new)
- `CATEGORIES`, `PATIENT_STATUSES`, `STATUSES` (moved unchanged), plus `SEXES = ['M', 'F', 'OTHER', 'UNKNOWN']`, `SOURCES = ['APP', 'SMS']`, `ROLES = ['user', 'responder', 'admin']`.

**File**: `server/src/lib/deviceId.js`
- `normalizeDeviceId`: remove U+0000 before trimming and checking the length (2.25).
- Comment: the `typeof` check rejects objects such as `{ "$ne": null }`, and the value reaches SQL only as a bound parameter.

**File**: `server/src/lib/incidentInput.js`
- Import `CATEGORIES` from `./enums.js`. No other change.

**Files**: `server/src/models/User.js`, `server/src/models/Incident.js`: deleted.

**File**: `server/src/middleware/auth.js`
- `signToken`: `{ id: user.id, role: user.role }`.
- `requireAuth`: `findUserById(payload.id)`. The existing `catch` still answers "Session expired. Please log in again." for verification errors, malformed ids, and database errors (3.7).

**File**: `server/src/routes/auth.js`
- Repository calls as in the mapping table, and `publicUser` as in D5. Validation, messages, and status codes unchanged.

**File**: `server/src/routes/incidents.js`
- `POST /`: `createIncident(result.doc)`, then emit and respond with that object.
- `GET /mine`: `listIncidentsByDevice(deviceId)`.
- `GET /`: `listIncidents(req.query)`.
- `PATCH /:id`: `updateIncident(req.params.id, (incident) => { /* today's status, outcome, notes code */ })`, with `incident.handledBy = req.user.id`; 404 when it returns null; then the same `updateTargets` loop and `res.json`.

**File**: `server/src/routes/sms.js`
- Import enums from `../lib/enums.js`, `findUserByPhone`, and `createIncident`. `parseSosSms` is unchanged.

**File**: `server/src/app.js`
- The last-resort handler logs `describeError(err)` and still answers 500 "Something went wrong on the server" (3.24). The comment says the app is built without connecting to the database.

**File**: `server/src/index.js` and `server/src/seed.js`: as in D7.

**Files**: `server/migration/{cli,source,map,run,report}.js` (new): as in "Migration details".

**Files**: `server/test/**`: as in the Testing Strategy.

**File**: `campussos/README.md` (2.11); other sections stay as they are
- Layout block: `server/   Node.js + Express + Supabase (Postgres) + Socket.IO`.
- Prerequisites: a Supabase project instead of MongoDB.
- New "Set up the database": create the project; run `server/db/schema.sql` in the SQL Editor; copy the Session pooler string into `DATABASE_URL`, and why (the direct host needs IPv6); download the server root certificate and point `DATABASE_CA_CERT` at it; leave RLS on and add no policies (the Security Advisor notice is expected).
- "Run the server": `cp .env.example .env`, then edit `DATABASE_URL`, `DATABASE_CA_CERT`, and `JWT_SECRET`; `npm install`, `npm run seed`, `npm run dev`.
- New "Move existing MongoDB data (one time)":
  1. Apply the schema. Put a MongoDB connection string with a changed password, or a new read-only Atlas user, in `MONGODB_URI`. The old password is public in git history.
  2. Optionally rehearse against a scratch Supabase project, or empty the tables before the final run.
  3. Stop the MongoDB-backed server.
  4. Run `npm run migrate:mongo` and read the report. Exit code 1 lists skipped records; it is safe to fix them and run it again.
  5. Start the Supabase-backed server (`npm start`). Run `npm run seed` only after the migration, so a migrated responder keeps its id and password.
  6. Clear `MONGODB_URI` and delete the Atlas user or change its password again.
- "Suggested next steps": replace "never expose MongoDB publicly" with "never expose `DATABASE_URL`; keep RLS on".

**Not changed**: `campussos/web/**`, `campussos-mobile/**`, `server/.env`, `src/socket.js`, `src/lib/rooms.js`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

1. **Before the fix (F).** Add the store harness with its MongoDB body and port the DB-backed suites onto it. Write the exploration test (Property 1), the preservation properties (Property 2), and the deliberate-change properties (Property 4). On F, the ported suites and Property 2 pass, while Property 1 and Property 4 fail with the counterexamples listed below. `incident.property.test.js` is the exception: it is rewritten for the new serializer and runs only on F'.
2. **After the fix (F').** Replace the harness body with PGlite, then delete the MongoDB body, mongoose, and mongodb-memory-server. Property 1, Property 4, and the new migration, schema, adapter, and secrets suites pass, and the ported suites and Property 2 still pass without edits. Import-path changes, such as `CATEGORIES` from `src/lib/enums.js`, land with the fix.

Store harness (`test/helpers/store.js`), same exports in both phases:
```js
export async function openStore({ listen = false } = {})   // starts the store and points the app at it
store.reset()                        // empty users and incidents
store.insertUser(fields)             // bcrypt-hashes `password` unless `passwordHash` is given; returns { id, ...fields }
store.insertLegacyIncident(doc)      // a Mongo-shaped document with explicit _id and timestamps
store.getIncident(id)                // stored record: hex ids, Date values, null and missing fields left out
store.countIncidents()
store.deleteUser(id)
store.childEnv()                     // env for spawned processes: MONGODB_URI before the fix, DATABASE_URL after
store.close()
```
Before the fix it uses mongodb-memory-server and raw collection writes. After the fix it uses `createTestDb()` from `test/helpers/db.js` (PGlite plus `db/schema.sql`), and `insertLegacyIncident` runs the migration's `mapIncident`, link resolution, and `insertIncidentRow`, so every legacy fixture also exercises the 2.13 mapping. `childEnv()` then points at a pglite-socket server with a loopback `DATABASE_URL` and `DATABASE_POOL_MAX=1`. Tests that spawn a process do not query PGlite directly while the child is inside a transaction.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: `test/supabase.bugcondition.property.test.js` ("Property 1: Bug Condition - Data operations run on Supabase") checks the repository files and runs the server's operations against a PGlite store with no MongoDB available. Run it on the UNFIXED code to observe failures.

**Test Cases**:
1. **Import scan**: no file under `src/` imports `mongoose` or `mongodb` (will fail on unfixed code and list the files).
2. **Startup**: spawn `node src/index.js` with `PORT=0`, a pglite-socket `DATABASE_URL` that has the schema, and no `MONGODB_URI`; expect the listen line. Also expect "Supabase connection failed:" and exit 1 for a closed port, a missing `DATABASE_URL`, a remote host without `DATABASE_CA_CERT`, and a database without the tables (will fail on unfixed code).
3. **Seed**: spawn `node src/seed.js` twice against pglite-socket; expect "Created responder: <email>", then "Responder already exists: <email>", one row in `public.users`, and exit 0 both times (will fail on unfixed code).
4. **Requests**: with `setDb(pglite)` and no MongoDB connection, generated sequences of register, login, me, app SOS, `/mine`, list, PATCH, and SMS calls must succeed, and every returned `_id` or `id` must exist as a row with the same values (will fail on unfixed code).
5. **Repository files**: `.env.example` has only `KEY=value` lines and comments, the expected keys, no URL with real credentials, and `MONGODB_URI=` marked as migration-only; `db/schema.sql` applies to PGlite twice; `npm run migrate:mongo` exists; the README has no instruction to edit `MONGODB_URI` and describes the Supabase setup (will fail on unfixed code).
6. **Offline**: `package.json` lists neither `mongoose` nor `mongodb-memory-server`, and no test imports them (will fail on unfixed code).
7. **Deliberate-change cases** from Property 4, run on F: `status[$ne]=PENDING`, `PATCH /api/incidents/abc`, an explicit null `accuracy`, and `nature: "a\u0000b"` (will fail on unfixed code).

**Expected Counterexamples**:
- `src/index.js`, `src/seed.js`, `src/models/*.js`, `src/routes/*.js`, and `src/middleware/auth.js` import mongoose.
- Startup without `MONGODB_URI` logs "MongoDB connection failed:" and exits 1 even though a Postgres with the schema is reachable; the seed fails the same way.
- With no MongoDB connection, a register request waits for Mongoose's 10-second buffering timeout and gets 500, and `public.users` stays empty; `src/db/client.js` does not exist.
- `.env.example` line 2 is a credentialed `mongodb+srv://` URL with no key; there is no `db/schema.sql`, no `migration/`, and no `migrate:mongo` script.
- `status[$ne]=PENDING` returns non-PENDING incidents; `PATCH /api/incidents/abc` returns 500; responses contain `"accuracy": null` and `"__v": 0`; `nature` comes back with U+0000.
- If any of these does not show up (for example, if startup does not need `MONGODB_URI`), the root cause analysis is wrong and must be revisited before the fix.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL op WHERE isBugCondition(op) DO
  result := runFixed(op)          // PGlite in-process, or pglite-socket for spawned processes
  ASSERT expectedBehavior(op, result)
END FOR

FOR ALL op WHERE isDeliberateChange(op) OR op has an explicit null optional field DO
  ASSERT the 2.22 to 2.25 result described in Property 4
END FOR

FOR ALL mongoDocs, runs DO        // Property 3
  stats := runMigration(fakeSource(mongoDocs), pgliteTarget)  (repeated, with docs added between runs)
  ASSERT source received only find(); each copied row's normalized API view = apiView(doc);
         no row changed by a later run; link, skip, report, and exit-code rules hold
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function. In this spec the same check also covers inputs inside C, because the fix changes storage and must leave every client-visible result unchanged.

**Pseudocode:**
```
FOR ALL op WHERE NOT isDeliberateChange(op) DO
  ASSERT normalize(observable(runOriginal(op))) = normalize(observable(runFixed(op)))
END FOR
```

F and F' cannot run in one process, because mongoose is removed by the fix. Each preservation property therefore asserts against a model in `test/helpers/model.js`, a plain-JS description of today's behavior: Mongoose's casts, defaults and validators, the filter semantics, the acknowledgement rule, and the `toJSON` shape. The property runs first on F through the MongoDB harness, which checks the model against real Mongoose, and then unchanged on F'. Generated ids and timestamps are compared through relations (`updatedAt === createdAt`, newest first, `responseTimeSec` from the two timestamps) rather than literal values.

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for creates, reads, updates, auth, SMS, and the seed, then write property-based tests capturing that behavior. DB-backed properties use 30 to 50 runs, like the existing suites.

**Test Cases**:
1. **Create preservation** (`test/preservation.create.property.test.js`): observe on F that app SOS bodies and SMS messages with mixed-type optional fields (numbers, booleans, strings with surrounding spaces, `{ _id }` objects, arrays, nulls) give 201 with the modeled JSON or 500 with nothing stored and no `incident:new`, then check the same on F'. Covers trims, casts, defaults, `updatedAt === createdAt`, and the 201 body equal to the emitted payload (3.9 to 3.12, 3.16 to 3.18, 3.20).
2. **Read preservation** (`test/preservation.read.property.test.js`): observe on F that random sets of users and legacy documents (missing fields, explicit nulls, `__v`, deleted or dangling reporters, decimal numbers, millisecond timestamps), combined with `/mine` headers and responder filters (single, repeated, unknown, and case-variant values; `from` and `to` across the whole JS date range; invalid date strings), give the modeled lists, then check the same on F'. Dangling and deleted links are generated only on incidents without a Device_ID, as in real data, because 2.14 and `ON DELETE SET NULL` turn them into null, which `/mine` would show instead of the old id. On F' this test also checks the migration mapping, because the harness inserts legacy documents through it (3.13, 3.14, 3.17 to 3.19, 2.13).
3. **Update preservation** (`test/preservation.update.property.test.js`): observe on F that random PATCH sequences (valid, invalid, non-string, and repeated statuses; outcome and notes with spaces, numbers, and nulls; empty bodies) give the modeled responses, the acknowledgement fields set once, `resolvedAt` on every RESOLVED, `updatedAt` changed only when a stored value changed, and one `incident:update` per room in `updateTargets`, then check the same on F' (3.15, 3.20).
4. **Auth preservation** (`test/preservation.auth.property.test.js`): observe on F that register, login, and `/me` with case and space variants of emails, short passwords, requested roles, phones of various types, wrong passwords, inactive users, and expired, wrong-secret, or garbage tokens give the same statuses, messages, user objects, and JWT claims (`exp - iat` = 7 days), then check the same on F' (3.4 to 3.8, 3.24).
5. **Seed preservation** (`test/preservation.seed.test.js`): spawn the seed through `store.childEnv()` with no responder, then with an existing responder whose email differs only in case and spaces, and compare console lines and stored rows (3.22).

### Unit Tests

- `cast.js`: a table of inputs and the outputs mongoose 8.24.7 gives (probed for this design), for strings, numbers, booleans, and dates, including `''`, `{ _id }` objects, arrays, plain objects, NaN, and Infinity.
- `fields.js` `prepareWrite`: defaults only for undefined, required, enum with null, maxlength after trim, setters on and off, U+0000 removal before validation.
- `ids.js`: `newId` format and order within one process; `toId` for null, uppercase hex, ObjectId instances, and malformed input.
- `pg.js`: `poolConfigFromEnv` with percent-encoded passwords, IPv6 brackets, ignored `sslmode`, loopback without TLS, a remote host without `DATABASE_CA_CERT` (error), and a remote host with it (`ca` and `rejectUnauthorized: true`); `safeMessage` and `describeError` redaction with no `detail`.
- `serialize.js`: `test/incident.property.test.js` (Property 14 of mobile-remove-auth) rewritten for `incidentJson` with reporter variants (none, populated, populated without phone, joined user missing) and Device_ID variants, plus a JSON round trip.
- `migration/map.js` and `migration/report.js`: example documents for every mapping rule; report text and `exitCodeFor`.
- Kept example tests: the invalid-body cases and the 401 and 403 token cases in `integration.test.js`, and the auth and SMS cases in `regression.test.js`.

### Property-Based Tests

- **Property 1** (`test/supabase.bugcondition.property.test.js`): generated operation sequences on F' land in `public.users` and `public.incidents` with the values the API returned.
- **Property 2** (`test/preservation.*.property.test.js`): the five preservation cases above.
- **Property 3** (`test/migration.map.property.test.js`, `test/migration.run.property.test.js`): generated user and incident documents built with `ObjectId` from `mongodb` (no server), with missing, null, mistyped, and unknown fields, `__v`, U+0000, dangling links, and emails that clash with users created by the seed. Checks:
  - the mapped rows' normalized API view equals the model of Mongoose's hydrate and `toJSON`;
  - a recording source receives only `find`;
  - a second run copies nothing, changes no row, and reports everything as already present, while documents added between runs are copied;
  - link counts and targets, the skip list, the report counts, and the exit code;
  - a JWT signed for a migrated user's id passes `GET /api/auth/me`, and login with the original password works against the copied bcrypt hash (3.6, 3.26).
- **Property 4** (`test/deliberate.property.test.js`):
  - Operator-shaped and other non-scalar values in `status`, `category`, and SMS `from` match nothing, and values with SQL metacharacters (`'`, `;`, `--`, `$1`) match only literally (2.22).
  - Random non-ObjectId strings and unknown 24-hex ids on PATCH give 404 with no emits (2.23).
  - Explicit nulls in every optional field are left out, and `__v` never appears (2.24).
  - Text with U+0000 is stored and returned without it; register and then log in with an email containing U+0000; a Device_ID with U+0000 gets its updates on the matching socket room (2.25).
- **Ported properties**: Properties 4, 5, 6, 9, 10, 11, 12, and 14 of mobile-remove-auth, with the same generators. `rooms.property.test.js` builds its ObjectId variant with `ObjectId` from `mongodb` and its incident id with `newId()`.

### Integration Tests

- `test/integration.test.js` (ported): a full SOS flow over supertest and socket.io-client: create, responder `incident:new`, PATCH, `incident:update` on the device and responder sockets within 2 seconds, nothing on other device rooms, 404 for a missing incident.
- `test/regression.test.js` (ported): auth routes, legacy incidents with populated reporters, filters, the 500 cap, deleted reporters (now `ON DELETE SET NULL`), and the SMS webhook. The index-build test is removed; the migration tests replace it (3.25).
- `test/schema.test.js`: each value of every enum list inserts and one outside value fails with 23514; defaults; unique email (23505); the 128-character `device_id` limit; the id format; the three indexes exist (`pg_indexes`); re-applying the file changes nothing; with simulated `anon` and `authenticated` roles, SELECT returns no rows or "permission denied" and INSERT, UPDATE, and DELETE fail (2.20, 2.21).
- `test/db.adapter.test.js`: the production `createPgDb` pool through pglite-socket. Covers parameter and result types (text, float8 edge values, boolean, null, epoch-millisecond timestamps), commit and rollback, `FOR UPDATE`, error codes 23505 and 23514 with `constraint`, and the pool `error` listener.
- `test/secrets.test.js`: scans tracked files in `server`, `web`, and `campussos-mobile` (excluding `node_modules`) for connection strings with credentials; only `<placeholder>` passwords are allowed (2.9, 2.19). Spawns the server, the seed, and the migration CLI with marker passwords in `DATABASE_URL` and `MONGODB_URI`, makes successful and failing requests, and asserts the markers never appear in stdout, stderr, HTTP bodies, or socket payloads (2.19).
- `test/migration.cli.test.js`: spawns `migration/cli.js` with an unreachable MongoDB (`mongodb://u:<marker>@127.0.0.1:1/?serverSelectionTimeoutMS=1000`) and with an unreachable Supabase, and expects exit code 2 with the right message (2.18, 2.19). A fake `Db` object passed to `mongoSource` records calls, and only `collection(...).find(...)` is allowed (2.12).
- Manual check before the switch (not automated, needs the real data): run the migration against a scratch Supabase project, compare the report with `countDocuments()` in Atlas, log in as the responder, and open the dashboard's records page.

### Test files and clauses

| File | Status | Covers |
|---|---|---|
| `test/helpers/store.js`, `test/helpers/db.js`, `test/helpers/model.js` | new | harness, PGlite and pglite-socket setup, models of today's behavior |
| `test/supabase.bugcondition.property.test.js` | new | Property 1; 1.1 to 1.11, 2.1 to 2.7, 2.9 to 2.11 |
| `test/schema.test.js` | new | 2.20, 2.21, 3.12 |
| `test/db.adapter.test.js` | new | 2.1, 2.19, D1 and D2 contract |
| `test/secrets.test.js` | new | 2.9, 2.19 |
| `test/cast.test.js` | new | 3.10, 3.11, 2.25 |
| `test/preservation.create.property.test.js` | new | Property 2; 3.9 to 3.12, 3.16 to 3.18, 3.20 |
| `test/preservation.read.property.test.js` | new | Property 2; 3.13, 3.14, 3.17 to 3.19, 2.13 |
| `test/preservation.update.property.test.js` | new | Property 2; 3.15, 3.20 |
| `test/preservation.auth.property.test.js` | new | Property 2; 3.4 to 3.8, 3.24 |
| `test/preservation.seed.test.js` | new | Property 2; 2.2, 3.22 |
| `test/deliberate.property.test.js` | new | Property 4; 2.22 to 2.25 |
| `test/migration.map.property.test.js` | new | Property 3; 2.13, 2.17, 2.25 |
| `test/migration.run.property.test.js` | new | Property 3; 2.12, 2.14 to 2.18, 3.6, 3.26 |
| `test/migration.cli.test.js` | new | 2.8, 2.12, 2.18, 2.19 |
| `test/integration.test.js` | ported | 3.1, 3.3, 3.7, 3.9, 3.13, 3.15, 3.21 |
| `test/regression.test.js` | ported, index-build test removed | 3.3, 3.4, 3.5, 3.14, 3.16, 3.19, 3.25 |
| `test/incident.property.test.js` | rewritten for the serializer | 3.17, 3.18 |
| `test/incidents.mine.property.test.js` | ported | 3.13 |
| `test/incidents.roundtrip.property.test.js` | ported | 3.9, 3.13 |
| `test/deviceId.invalid.property.test.js` | ported | 3.3, 3.13 |
| `test/incidentInput.valid.property.test.js`, `test/incidentInput.invalid.property.test.js` | import path only | 3.3, 3.9 |
| `test/rooms.property.test.js` | ObjectId from `mongodb` | 3.15 |
| `test/socket.property.test.js`, `test/setup.test.js` | unchanged | 3.21 |

New property test files start with the header style of the existing suites, for example `// Feature: mongodb-to-supabase, Property 2: Preservation - Clients and operators see the same results` followed by `// **Validates: Requirements ...**`.

## Sources

- Supabase, [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres): connection methods by environment, hosts, ports, IP versions, pooler user names, transaction-mode limits, and SSL modes.
- Supabase, [Connection pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits): the shared pooler is IPv4-only, and the direct connection needs IPv6 without the add-on.
- Supabase, [Connecting with psql](https://supabase.com/docs/guides/database/psql): `verify-full` with the downloaded root certificate against the pooler host.
- Supabase, [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security): enabling RLS on exposed tables, revoking default grants from `anon` and `authenticated`, and error 42501.
- node-postgres, [pg-connection-string README](https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string): how `sslmode`, `sslrootcert`, and `uselibpqcompat` map to the `ssl` option.
- PGlite, [API](https://pglite.dev/docs/api) and [pglite-socket](https://pglite.dev/docs/pglite-socket): query, exec, and transaction APIs; parsers; the single-connection multiplexer and its limits.

Content from these sources was rephrased for compliance with licensing restrictions.
