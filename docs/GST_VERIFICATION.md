# Employer GSTIN verification

**GST verification is mandatory.** An employer account is active only when its company's `gstVerification.status` is `VERIFIED`. Until then, the recruiter website and the employer app show only a "Verify your company" screen, and the API refuses everything else. Both clients use the same endpoints and read the same `Company.gstVerification` record.

## Signup (email and Google: `POST /api/employer/auth/signup`, `/auth/google-signup`)

`gstin` and `gstLegalName` are required. A missing or badly formatted value gets a `400` before anything else runs. The paid lookup runs only after every cheap check has passed (fields, phone OTP, email not taken, Google token). Then:

| Lookup result | Signup |
| --- | --- |
| Active, legal name matches, company name = legal or trade name | Account created and **active** (`VERIFIED`) |
| Company (brand) name differs from both legal and trade name | Account created, **pending** `UNDER_REVIEW`. Staff approve it in Ops → Companies. Never auto-rejected. |
| Status unclear (`UNKNOWN`) | Account created, **pending** `UNDER_REVIEW` |
| API down, timeout, rate limited, credits exhausted, bad response | Account created, **pending** `FAILED`. The employer retries from the verification screen. |
| Provider not configured | Account created, **pending** `NOT_SUBMITTED`. Retry later. |
| GSTIN not registered / registration inactive / wrong legal name | **Refused** (`422`, nothing created). The form shows the error on the GST field. |
| GSTIN already held by another company (verified, under review or mid-check) | **Refused** (`409 GSTIN_ALREADY_REGISTERED`). Join that company via a team invite instead. |

The signup response carries `gstVerification: { code, message, status }`, and `company.gstVerification: { status, reason }` (login responses include this too).

**Accounts created without a GSTIN:** pay-first guest checkout (company named "New Employer Account") and staff-onboarded companies. They start `NOT_SUBMITTED` and get the same verification screen on first sign-in. `verify-gst` accepts a `companyName` there, which renames the company only while it has never been verified.

## Access gate (`src/middleware/requireGstVerified.js`)

The gate is mounted once on the whole `/api/employer` router and is **default-deny**: every route, including any added later, needs a signed-in employer whose company is `VERIFIED`. A pending company gets `403 { code: 'GST_VERIFICATION_REQUIRED' }`. The exceptions are:

- **Public:** `/auth/*`, guest checkout (`POST /subscription/guest-order`, `/subscription/guest-verify`), `POST /plan-enquiries`.
- **Signed in, still pending:** `GET /company`, `POST /company/verify-gst`, `/support/*`, `/notifications/*`, `/push/*`.

Both clients react to that 403 by re-reading the company and showing the verification screen. After verification, the company name can't be changed through `PUT /company` (`409 NAME_LOCKED`). Mzobs staff posting jobs on a company's behalf (Ops/Admin) is not affected.

## Provider: gstinapi.in

The connected vendor is **gstinapi.in**. Its adapter is `src/utils/gstProviders/gstinapi.js`, written from the vendor's OpenAPI spec (`https://www.gstinapi.in/openapi.json`).

- **Call:** `GET /v1/gstin/{gstin}` with the `x-api-key` header.
- **Billing:** one credit per successful lookup. Every account gets 100 free lookups; after that the API returns `402` (out of credits), which recruiters see as a provider error and which the server logs as "no credits left". Top up from the gstinapi.in dashboard.
- **Configuration:** set these two variables on the server:
  ```
  GSTINAPI_API_KEY=<key from the gstinapi.in dashboard>
  GSTINAPI_BASE_URL=https://www.gstinapi.in   # optional; defaults to https://gstinapi.in
  ```
  These select the gstinapi adapter automatically. The generic `GST_VERIFICATION_*` variables below override them if set.
- **Sandbox:** the GSTIN `00AAAAA0000A1ZT` is free and answers in the live format. It does not pass the official GSTIN checksum, so the app's own form rejects it; use it only to test the adapter directly.

If no key is set, verification returns `503 GST_NOT_CONFIGURED` and never marks a company verified.

## Adding another provider adapter

1. Create `src/utils/gstProviders/<vendor>.js` exporting an object that meets the contract documented at the top of `src/utils/gstProviders.js`:
   - `name`: a short key, e.g. `'acme'`.
   - `isConfigured()`: returns `true` only when `env.gstVerification.apiKey` (and anything else the vendor needs) is set.
   - `lookup(gstin, { signal })`: calls the vendor and passes `signal` to axios so timeouts cancel the request. It maps the vendor's response to `{ gstin, legalName, tradeName, registrationStatus, address, providerReference }`.
     - `registrationStatus` must be one of `ACTIVE`, `CANCELLED`, `SUSPENDED`, `INACTIVE` or `UNKNOWN`. Map anything you aren't sure about to `UNKNOWN`; it goes to staff review.
   - On failure it throws `new GstProviderError(code)`, where `code` is one of `NOT_FOUND`, `RATE_LIMITED`, `TIMEOUT`, `AUTH` or `UNAVAILABLE`. Vendors that report errors inside an HTTP 200 body must be checked explicitly (see `utils/msg91.js` for the same pattern).
   - Never log credentials or the raw response.
2. Register it in the `PROVIDERS` map in `src/utils/gstProviders.js`.
3. Add a unit test for the mapping, using recorded sample responses from the vendor's documentation or sandbox.
4. Set the environment variables below on the server and restart (`npm run pm2:reload`).
5. Smoke-test in the vendor's sandbox: one active GSTIN, one cancelled GSTIN, and one wrong legal name.

## Environment variables (server only; never in any frontend build)

| Variable | Purpose |
| --- | --- |
| `GST_VERIFICATION_PROVIDER` | Key of the registered adapter, e.g. `acme`. Blank turns the feature off (503). |
| `GST_VERIFICATION_API_KEY` | Vendor API key. |
| `GST_VERIFICATION_API_SECRET` | Vendor secret / client secret, if the vendor uses one. |
| `GST_VERIFICATION_BASE_URL` | Vendor API base URL (sandbox or production). |
| `GST_VERIFICATION_TIMEOUT_MS` | Per-lookup timeout, default `10000`. |

`.env.example` has placeholders only.

## API

`POST /api/employer/company/verify-gst` with an employer bearer token and the body `{ "gstin": "27AAPFU0939F1ZV", "legalName": "Acme Private Limited" }`.

- **Who can call it:** only the company's **Admin** role. Other team members can see the status but get `403` if they try to verify.
- **Rate limit:** 5 attempts per company per hour (`429 RATE_LIMITED`). This is on top of the general API limit.
- **Response:** always `{ code, message, gstVerification }`.

| HTTP | `code` | Record status |
| --- | --- | --- |
| 200 | `VERIFIED` | VERIFIED |
| 200 | `NAME_MISMATCH`, `INACTIVE_REGISTRATION`, `GSTIN_NOT_FOUND` | FAILED (can retry) |
| 200 | `PROFILE_NAME_DIFFERS`, `GSTIN_IN_USE`, `STATUS_UNKNOWN` | UNDER_REVIEW |
| 400 | `INVALID_GSTIN`, `INVALID_LEGAL_NAME` | unchanged |
| 403 | `FORBIDDEN` | unchanged |
| 409 | `IN_PROGRESS`, `ALREADY_VERIFIED`, `UNDER_REVIEW` | unchanged |
| 429 | `RATE_LIMITED` (our limit) / `PROVIDER_RATE_LIMITED` (vendor's) | unchanged / FAILED |
| 502 / 504 | `PROVIDER_ERROR` / `PROVIDER_TIMEOUT` | FAILED (can retry) |
| 503 | `GST_NOT_CONFIGURED` | unchanged |

`GET /api/employer/company` returns `gstVerification` along with the rest of the company.

### Decision rules (`src/utils/gstVerification.js`)

1. The GSTIN format and check digit must be valid. This alone **never** verifies a company.
2. The vendor's answer must echo the same GSTIN and include a legal name. Otherwise it's treated as a provider error.
3. The registration must be `ACTIVE`. Anything else → FAILED. `UNKNOWN` → UNDER_REVIEW.
4. The legal name the recruiter typed must match the registered legal name. The comparison ignores case, punctuation, "M/s" and "Pvt/Private, Ltd/Limited". Otherwise → FAILED `NAME_MISMATCH`.
5. If the GSTIN is already verified for another company → UNDER_REVIEW.
6. The company's **profile name** must equal the GST legal name or trade name. Otherwise → UNDER_REVIEW. This stops anyone claiming a well-known company's GSTIN just by typing its public legal name.
7. Otherwise → VERIFIED. The verified GSTIN is also copied to `Company.gstin`, which the staff portals already display.

One attempt runs at a time per company: an atomic `PENDING` claim, with stale claims reclaimable after timeout + 30 s. A FAILED result can be retried and updates the same record.

## Staff review

The Operations portal's **Companies** page shows each company's GST status. UNDER_REVIEW cases show **Approve GSTIN / Reject** buttons, which call `PATCH /api/staff/companies/:id/gst-review` with `{ decision: 'approve' | 'reject', note }`.

GST verification does **not** change `Company.verificationStatus`, the staff KYC decision behind the public "Verified employer" badge. Staff can use a VERIFIED GSTIN as evidence when they choose the existing "GSTIN + PAN cross-check" method.

## Data kept

On `Company.gstVerification`:
- status, last submitted GSTIN and legal name, reason code
- legal name, trade name, registration status, registered address (all only for VERIFIED or UNDER_REVIEW)
- provider key and reference, attempt count, timestamps, reviewer

No raw provider payload and no credentials are stored.

**Audit trail:** the `gstverificationattempts` collection has one row per attempt (including refused ones) and per staff decision: company, user or staff name, GSTIN, outcome, reason, provider reference, duration.

## Migration

No data migration is needed, but **every existing employer is gated on deploy**. Existing companies have no `gstVerification` field, so they read as `NOT_SUBMITTED`. On their next sign-in they see the verification screen and can't post jobs or use the workspace until their GSTIN is verified (or approved by staff). Tell existing employers before deploying. Mongoose creates the new `{ 'gstVerification.gstin', 'gstVerification.status' }` index on boot (`autoIndex`), or you can create it by hand in production if `autoIndex` is off.
