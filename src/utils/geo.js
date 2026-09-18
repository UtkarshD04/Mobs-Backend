// "Nearby jobs" support — Job.location is free text (a city name), not
// coordinates, so distance is computed against a curated city→lat/lng table
// (the same city set hotCities.js already spotlights) rather than requiring
// every job posting to carry geo coordinates. A job whose location string
// doesn't match any known city simply has no distance and sorts last.
import { HOT_CITIES } from './hotCities.js'

export const CITY_COORDS = {
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  'delhi-ncr': { lat: 28.6139, lng: 77.209 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  pune: { lat: 18.5204, lng: 73.8567 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  noida: { lat: 28.5355, lng: 77.391 },
  gurugram: { lat: 28.4595, lng: 77.0266 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
  lucknow: { lat: 26.8467, lng: 80.9462 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  chandigarh: { lat: 30.7333, lng: 76.7794 },
  indore: { lat: 22.7196, lng: 75.8577 },
  kochi: { lat: 9.9312, lng: 76.2673 },
  bhopal: { lat: 23.2599, lng: 77.4126 },
}

function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// HOT_CITIES entries with known coordinates, nearest-first to (lat, lng).
export function citiesByDistance(lat, lng) {
  return HOT_CITIES.map((c) => {
    const coords = CITY_COORDS[c.slug]
    if (!coords) return null
    return { ...c, distanceKm: haversineKm({ lat, lng }, coords) }
  })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm)
}

// Distance (km) from (lat, lng) to the nearest known city whose `match`
// regex the job's location string satisfies — Infinity if none match, so
// jobs in unrecognized locations sort after every geolocated one.
function distanceForLocation(location, orderedCities) {
  const city = orderedCities.find((c) => c.match.test(location ?? ''))
  return city ? city.distanceKm : Infinity
}

// One page of `query`-matching jobs sorted nearest-first to (lat, lng).
// Distance sorting can't be expressed as a Mongo sort stage (it depends on
// regex-matching each job's free-text location against the city table), so
// this fetches up to `hardCap` matches and sorts/paginates in memory —
// mirrors utils/hotCities.js's existing "reduce over an already-fetched job
// list" approach. Fine at this app's job-listing scale; a job count above
// hardCap would under-report `total` and silently drop the excess from
// sorting, which is an acceptable tradeoff here but not one to raise blindly.
export async function nearbyJobsPage(Job, query, { lat, lng, page, limit, hardCap = 500 }) {
  const all = await Job.find(query).populate('company', 'name logo').limit(hardCap)
  const sorted = sortJobsByDistance(all, lat, lng)
  const total = sorted.length
  const start = (page - 1) * limit
  return { jobs: sorted.slice(start, start + limit), total }
}

// Sorts `jobs` (each needs a `.location` and `.postedOn`/`.createdAt`) by
// distance from (lat, lng), nearest first; ties (including "no known city
// match") fall back to newest-first, same as the default sort.
export function sortJobsByDistance(jobs, lat, lng) {
  const orderedCities = citiesByDistance(lat, lng)
  return [...jobs].sort((a, b) => {
    const da = distanceForLocation(a.location, orderedCities)
    const db = distanceForLocation(b.location, orderedCities)
    if (da !== db) return da - db
    const pa = new Date(a.postedOn ?? a.createdAt ?? 0).getTime()
    const pb = new Date(b.postedOn ?? b.createdAt ?? 0).getTime()
    return pb - pa
  })
}
