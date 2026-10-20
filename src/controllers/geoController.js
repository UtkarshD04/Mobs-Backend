import { asyncHandler } from '../utils/asyncHandler.js'
import { INDIA_STATES } from '../utils/indiaStates.js'
import { isIndianCoord } from '../utils/jobLocation.js'
import { searchPlaces, reversePlace, lookupPincode, GeocoderError } from '../utils/geocoder.js'

// Geocoder failures are expected operational states (provider down / busy / off), not bugs —
// answer them with a clean message instead of letting the generic error handler log a 500.
const withGeoErrors = (fn) =>
  asyncHandler(async (req, res) => {
    try {
      await fn(req, res)
    } catch (e) {
      if (e instanceof GeocoderError) return res.status(e.status).json({ message: e.message })
      throw e
    }
  })

export const listStates = (_req, res) => res.json({ country: 'India', states: INDIA_STATES })

const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, 120) : '')

export const places = withGeoErrors(async (req, res) => {
  const q = clean(req.query.q)
  if (q.length < 3) return res.status(400).json({ message: 'Type at least 3 characters to search.' })
  res.json(await searchPlaces({ q, state: clean(req.query.state), city: clean(req.query.city) }))
})

export const reverse = withGeoErrors(async (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  if (!isIndianCoord(lat, lng)) return res.status(400).json({ message: 'Coordinates are invalid or outside India.' })
  res.json((await reversePlace(lat, lng)) ?? null)
})

export const pincode = withGeoErrors(async (req, res) => {
  const pin = String(req.params.pin ?? '')
  if (!/^[1-9]\d{5}$/.test(pin)) return res.status(400).json({ message: 'PIN code must be 6 digits.' })
  const found = await lookupPincode(pin)
  if (!found) return res.status(404).json({ message: 'No area found for this PIN code.' })
  res.json(found)
})
