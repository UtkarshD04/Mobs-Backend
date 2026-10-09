import { env } from '../config/env.js'
import { GstProviderError, GST_PROVIDER_ERROR_CODES } from './gstProviderError.js'
import gstinapi from './gstProviders/gstinapi.js'

export { GstProviderError, GST_PROVIDER_ERROR_CODES }

// GST lookup provider interface. The verification service
// (utils/gstVerification.js) only ever talks to an adapter through this
// contract, so switching vendors never touches the verification rules.
//
// An adapter is an object:
//
//   {
//     name: 'vendor-key',                // stored on the company as `provider`
//     isConfigured(): boolean,           // true only when its env credentials are set
//     async lookup(gstin, { signal }),   // one GSTIN → GstLookupResult (below)
//   }
//
// GstLookupResult — the adapter maps the vendor's own response onto this
// shape; nothing else from the vendor payload is kept:
//
//   {
//     gstin: string,                     // as returned by the vendor (must echo the request)
//     legalName: string,                 // "Legal Name of Business"
//     tradeName: string | '',            // "Trade Name", if any
//     registrationStatus: 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | 'INACTIVE' | 'UNKNOWN',
//     address: string | '',              // principal place of business, single line
//     providerReference: string | '',    // vendor's request/transaction id, for support/audit
//   }
//
// Failures must be thrown as GstProviderError with one of these codes —
// anything else is treated as UNAVAILABLE:
//
//   NOT_FOUND     the vendor says no such GSTIN exists
//   RATE_LIMITED  the vendor throttled us (HTTP 429 or equivalent)
//   TIMEOUT       no answer in time (the service also enforces its own timeout)
//   AUTH          credentials rejected — an ops problem, not the recruiter's
//   UNAVAILABLE   any other vendor/network failure
//
// The adapter must honour `signal` (pass it to axios/fetch) and must never log
// credentials or the raw response.
//
// Registered adapters, keyed by GST_VERIFICATION_PROVIDER. To add another
// vendor, add `gstProviders/<vendor>.js` implementing the contract above
// from that vendor's documentation and register it here. See
// docs/GST_VERIFICATION.md.
const PROVIDERS = { gstinapi }

// The configured adapter, or null when none is selected/registered or its
// credentials are missing. Callers must treat null as "cannot verify".
export function getGstProvider(registry = PROVIDERS, providerKey = env.gstVerification.provider) {
  const adapter = providerKey ? registry[providerKey] : null
  if (!adapter || typeof adapter.lookup !== 'function') return null
  return adapter.isConfigured?.() ? adapter : null
}
