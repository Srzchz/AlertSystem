# CampusSOS

SMS/GPS emergency alert system: a mobile app for people who need help, and a web dashboard for the infirmary.

```
campussos/
  server/   Node.js + Express + MongoDB (Mongoose) + Socket.IO   -> REST API, real-time alerts, SMS webhook
  web/      React (Vite) + Leaflet                                -> infirmary dashboard (alarm popup, map, records)
  mobile/   React Native (Expo)                                   -> user app (login, SOS, form, tips, incident log)
```

## 1. Prerequisites
- Node.js 20+ and npm
- MongoDB: a free MongoDB Atlas cluster, or local MongoDB
- Expo Go app on your phone (for testing the mobile app)

## 2. Run the server
```bash
cd server
cp .env.example .env        # then edit MONGODB_URI and JWT_SECRET
npm install
npm run seed                # creates a responder account (see .env)
npm run dev                 # http://localhost:4000
```

## 3. Run the web dashboard
```bash
cd web
npm install
npm run dev                 # http://localhost:5173
```
Log in with the seeded responder account. Click **Enable alarm sound** once (browsers block audio until you interact with the page).

## 4. Set up the mobile app (Expo)
The mobile folder only contains our source files, so let Expo create the project shell first:
```bash
npx create-expo-app@latest campussos-mobile --template blank
cd campussos-mobile
npx expo install expo-location expo-sms expo-secure-store @react-native-community/netinfo @react-native-picker/picker react-native-screens react-native-safe-area-context
npm install @react-navigation/native @react-navigation/native-stack socket.io-client
```
Then copy `mobile/App.js` and `mobile/src/` from this repo over the generated `App.js`, and edit `src/config.js`:
- `API_URL` must be your computer's LAN IP, e.g. `http://192.168.1.10:4000` (not `localhost`; the phone can't reach that).
- `INFIRMARY_NUMBER` is the SMS gateway/infirmary number used for the offline fallback.

Run with `npx expo start` and scan the QR code with Expo Go.

## 5. How an alert flows
1. User logs in, picks **SOS for myself / for someone else**, fills the form, taps **Send SOS**.
2. Online: app POSTs to `/api/incidents` with GPS. Offline: app opens a pre-filled SMS to the infirmary number.
3. Server saves the incident and emits `incident:new` over Socket.IO.
4. Dashboard shows a popup, plays the alarm, and pins the sender on the map.
5. Responder acknowledges / updates status; response time is computed automatically. The user sees tips while waiting and the result in their incident log.

## 6. SMS fallback (offline) notes
`POST /api/sms/inbound` accepts a webhook from your SMS provider (Semaphore, Twilio, etc.) with `{ from, message }`. Message format sent by the app:
```
SOS|FAINTING|UNCONSCIOUS|F|19|14.3294,120.9367|Near gym entrance
```
(prefix | category | patient status | sex | age | lat,lng | note). Point your provider's incoming-message webhook at that route and set `SMS_WEBHOOK_SECRET`.

## 7. Suggested next steps
- [ ] Verify real user data/permissions (school email or student ID check on register)
- [ ] Push notifications to the user when status changes (Firebase Cloud Messaging)
- [ ] Analytics page (response-time averages, common categories, hotspots)
- [ ] Rate limiting + HTTPS before deploying; never expose MongoDB publicly
