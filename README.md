# StaySphere — Backend API

REST API for StaySphere, a role-based rental marketplace for affordable
accommodation in tier-2 and tier-3 Indian cities.

Built with Node.js, Express 5, MongoDB and Mongoose. Authentication uses JWT
with bcrypt-hashed passwords.

> **Build status:** Phases 1–4 of the backend plan are implemented and tested
> (foundation, database models, authentication, role authorization).
> Property CRUD, search, bookings, payments and the admin APIs are **not built
> yet** — see [Roadmap](#roadmap).

---

## Getting started

You need Node.js 20+ and a MongoDB server running locally on port 27017.

```bash
cd backend
npm install
cp .env.example .env      # then edit the values
npm run seed:admin        # creates the one admin account
npm run seed:demo         # optional: the demo accounts the UI advertises
npm run dev               # starts on http://localhost:5000
```

Check it is alive:

```bash
curl http://localhost:5000/health
```

```json
{ "success": true, "status": "ok", "database": "connected", ... }
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` / `production`. Controls error detail and rate limits. |
| `PORT` | HTTP port. Defaults to `5000`, which is what the frontend expects. |
| `MONGODB_URI` | Connection string, e.g. `mongodb://127.0.0.1:27017/staysphere`. |
| `JWT_SECRET` | Signing secret. Use a long random string outside development. |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d`. |
| `CLIENT_ORIGINS` | Comma-separated browser origins allowed through CORS. |
| `SEED_ADMIN_*` | Values used by `npm run seed:admin`. |

`.env` is git-ignored. Only `.env.example` is committed, and it holds no real
secrets.

---

## Project structure

```
backend/
  src/
    config/       env.js (validated config), db.js (single connection)
    controllers/  thin request/response handlers
    middleware/   auth, roles, validation, rate limits, central errors
    models/       User, Property, Booking, Payment (+ index.js barrel)
    routes/       route tables, mounted through routes/index.js
    services/     business rules — the part worth reading
    utils/        AppError, generateToken
    scripts/      seedAdmin.js
    app.js        builds the Express app (no side effects)
    server.js     connects the DB, then starts listening
  tests/          Node built-in test runner
```

The request path is deliberately boring and always the same:

```
route → validators → middleware (auth, role) → controller → service → model
```

Errors are never handled in controllers. Anything thrown lands in
`errorMiddleware.js`, which is the only place that formats an error response.
Express 5 forwards rejected promises automatically, so controllers need no
`try/catch` wrapper.

---

## Response shape

Every endpoint answers in one of two shapes, so the frontend never has to
guess.

Success:

```json
{ "success": true, "message": "Logged in successfully.", "data": { "...": "..." } }
```

Failure:

```json
{
  "success": false,
  "message": "Some fields need your attention.",
  "errors": { "email": "Enter a valid email address." }
}
```

`errors` is present only for validation failures, keyed by field name, which is
what the React forms need to show messages inline.

---

## Implemented endpoints

### `GET /health`

Liveness plus database state. No authentication.

### `POST /api/auth/register`

Creates a tenant or landlord account and returns the user with a token.

```json
{
  "name": "Arjun Sharma",
  "email": "arjun@example.com",
  "phone": "9876543210",
  "password": "Password123",
  "role": "tenant"
}
```

- `role` is optional and may only be `tenant` or `landlord`. `admin` is
  rejected — admins exist only via `npm run seed:admin`.
- Password must be at least 8 characters with a letter and a number.
- `phone` must be a 10-digit Indian mobile number.
- Returns `201`, or `409` if the email is taken.

### `POST /api/auth/login`

```json
{ "email": "arjun@example.com", "password": "Password123" }
```

Returns `200` with the user and a token. A wrong password and an unknown email
both return the same `401` message, so the endpoint cannot be used to discover
which emails are registered.

### `GET /api/auth/me`

Requires `Authorization: Bearer <token>`. Returns the caller's own record.
Returns `401` for a missing, malformed or expired token, and `403` if the
account has since been suspended.

---

## Roles and permissions

Roles are `tenant`, `landlord` and `admin`.

Authentication and authorization are two separate middlewares, and routes
compose them:

```js
router.get('/dashboard', protect, authorize('admin'), getDashboard)
```

- `protect` answers *who are you?* — verifies the token and loads the user
  fresh from the database on every request, so a suspended account stops
  working immediately rather than when its token expires.
- `authorize(...roles)` answers *what may you do?* — and reads the role from
  the database record, never from the request body or a query parameter.

---

## Database models

All four schemas are defined and indexed, so later phases only add endpoints,
not migrations.

- **User** — name, email (unique), phone, `passwordHash` (`select: false`),
  role, status, favorites. Hashing lives in the model, so no controller can
  save a plain-text password.
- **Property** — landlord ref, type, rent, area, occupancy, furnishing,
  amenities, images, address, and a GeoJSON `location` point with a
  **2dsphere index** ready for the radius search. Also a compound
  `city + type + rent` index and a text index on title/description/locality.
- **Booking** — tenant, landlord and property refs, plus the status machine.
  `BOOKING_TRANSITIONS` in `models/Booking.js` is the single source of truth
  for which status may follow which:

  ```
  pending ──accept──> payment_pending ──pay──> paid ──> booked ──> occupied
     └──────reject───> rejected
     └──────cancel───> cancelled
  ```

  Rent is copied onto the booking at request time, so a later rent edit cannot
  change what the tenant agreed to.
- **Payment** — booking/tenant/property refs, server-derived amount, and a
  partial unique index allowing only one *successful* payment per booking
  while still permitting repeated failed attempts.

`provider` on a payment is `demo`. **This project has no real payment gateway
integrated** — the field records that honestly.

---

## Security

- Passwords hashed with bcrypt (10 rounds); the hash is never selected or
  returned.
- Secrets live in `.env`, which is git-ignored; `env.js` fails at startup if a
  required one is missing.
- Helmet security headers; CORS restricted to `CLIENT_ORIGINS`.
- Rate limiting on the auth endpoints (relaxed in development so Postman
  testing does not lock you out).
- JSON body capped at 1 MB.
- Validation on every input via express-validator.
- Central error handling; stack traces and driver messages never reach
  clients in production.
- Identity is always taken from `req.user`, never from the request body.

---

## Testing

```bash
npm test
```

Runs the Node built-in test runner (no extra dependencies) against a separate
`staysphere_test` database, which is dropped afterwards. 23 tests cover the
health route, JSON 404s, registration (including duplicate email, weak
password, bad phone and the blocked admin self-registration), password
hashing, login, `/me` with missing/malformed tokens, suspended accounts, and
every role-authorization combination.

---

## Roadmap

Following the project's phase plan:

| Phase | Status |
| --- | --- |
| 1. Foundation — Express, MongoDB, config, health, errors | Done |
| 2. Database models — User, Property, Booking, Payment | Done |
| 3. Authentication — register, login, `/me`, JWT, bcrypt | Done |
| 4. Authorization — role middleware | Done |
| 5. Property CRUD | Not started |
| 6. Search, filters, pagination, nearby | Not started |
| 7. Booking workflow | Not started |
| 8. Payment and confirmation | Not started |
| 9. Profile and favourites | Not started |
| 10. Landlord APIs | Not started |
| 11. Admin APIs | Not started |
| 12. Security, validation and error hardening | Not started |
| 13. Frontend integration | Auth wired up; the rest waits on phases 5–12 |
| 14. Final testing and API docs | Not started |

The ML recommendation service stays a separate Python module and is not part
of these phases.

### Note for frontend integration (phase 13)

The API uses `tenant` for the renter role, matching the project brief. The
current frontend uses `user` for the same role. One side needs to adopt the
other's name during phase 13 — decide before wiring the auth calls up.

---

## Frontend integration

The React app talks to this API through one Axios instance
(`src/services/apiClient.js`), which attaches the token, unwraps the
`data` envelope and normalises errors. Pages never call axios directly.

Currently wired to real endpoints:

| Frontend | Endpoint |
| --- | --- |
| Login page | `POST /api/auth/login` |
| Register page | `POST /api/auth/register` |
| Session restore on page load | `GET /api/auth/me` |

Still running on mock data, because the endpoints do not exist yet:
property search and details, bookings, payments, favourites, landlord and
admin screens, and the password-reset flow.

Two things to know:

- **Role names.** This API calls the renter `tenant`; the frontend calls
  the same role `user` throughout its routes and guards. The translation
  happens in one place — `toApiRole` / `toAppRole` in the frontend's
  `authService.js`. Neither side had to be renamed.
- **Demo accounts.** `npm run seed:demo` creates `user@test.com`,
  `landlord@test.com` and `admin@test.com`, all with the password
  `Password123`. The login screen's hint box lists exactly these. They are
  development fixtures — never seed them in production.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with file watching |
| `npm start` | Start once |
| `npm test` | Run the test suite against `staysphere_test` |
| `npm run seed:admin` | Create/update the admin account from `.env` |
| `npm run seed:demo` | Create/update the three demo accounts |
