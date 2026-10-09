// Error every GST provider adapter throws (see the contract in gstProviders.js).
// Its own module so adapters and the registry can both import it without a cycle.
export const GST_PROVIDER_ERROR_CODES = ['NOT_FOUND', 'RATE_LIMITED', 'TIMEOUT', 'AUTH', 'UNAVAILABLE']

export class GstProviderError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.name = 'GstProviderError'
    this.code = GST_PROVIDER_ERROR_CODES.includes(code) ? code : 'UNAVAILABLE'
  }
}
