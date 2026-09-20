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

// Cities beyond the homepage's HOT_CITIES spotlight list — distance sorting only, so
// adding one here never changes what "Hot Jobs by City" shows. Kept in sync with
// Mobile-App/src/lib/jobDistance.js (which mirrors this whole table).
export const EXTRA_CITIES = [
  { city: 'Surat', slug: 'surat', match: /surat/i, lat: 21.1702, lng: 72.8311 },
  { city: 'Nagpur', slug: 'nagpur', match: /nagpur/i, lat: 21.1458, lng: 79.0882 },
  { city: 'Visakhapatnam', slug: 'visakhapatnam', match: /visakhapatnam|vizag/i, lat: 17.6868, lng: 83.2185 },
  { city: 'Vadodara', slug: 'vadodara', match: /vadodara|baroda/i, lat: 22.3072, lng: 73.1812 },
  { city: 'Patna', slug: 'patna', match: /patna/i, lat: 25.5941, lng: 85.1376 },
  { city: 'Ranchi', slug: 'ranchi', match: /ranchi/i, lat: 23.3441, lng: 85.3096 },
  { city: 'Coimbatore', slug: 'coimbatore', match: /coimbatore/i, lat: 11.0168, lng: 76.9558 },
  { city: 'Thiruvananthapuram', slug: 'thiruvananthapuram', match: /thiruvananthapuram|trivandrum/i, lat: 8.5241, lng: 76.9366 },
  { city: 'Mysuru', slug: 'mysuru', match: /mysuru|mysore/i, lat: 12.2958, lng: 76.6394 },
  { city: 'Mangaluru', slug: 'mangaluru', match: /mangaluru|mangalore/i, lat: 12.9141, lng: 74.856 },
  { city: 'Nashik', slug: 'nashik', match: /nashik/i, lat: 19.9975, lng: 73.7898 },
  { city: 'Kanpur', slug: 'kanpur', match: /kanpur/i, lat: 26.4499, lng: 80.3319 },
  { city: 'Varanasi', slug: 'varanasi', match: /varanasi|banaras/i, lat: 25.3176, lng: 82.9739 },
  { city: 'Prayagraj', slug: 'prayagraj', match: /prayagraj|allahabad/i, lat: 25.4358, lng: 81.8463 },
  { city: 'Agra', slug: 'agra', match: /\bagra\b/i, lat: 27.1767, lng: 78.0081 },
  { city: 'Meerut', slug: 'meerut', match: /meerut/i, lat: 28.9845, lng: 77.7064 },
  { city: 'Ghaziabad', slug: 'ghaziabad', match: /ghaziabad/i, lat: 28.6692, lng: 77.4538 },
  { city: 'Faridabad', slug: 'faridabad', match: /faridabad/i, lat: 28.4089, lng: 77.3178 },
  { city: 'Dehradun', slug: 'dehradun', match: /dehradun/i, lat: 30.3165, lng: 78.0322 },
  { city: 'Amritsar', slug: 'amritsar', match: /amritsar/i, lat: 31.634, lng: 74.8723 },
  { city: 'Ludhiana', slug: 'ludhiana', match: /ludhiana/i, lat: 30.901, lng: 75.8573 },
  { city: 'Jalandhar', slug: 'jalandhar', match: /jalandhar/i, lat: 31.326, lng: 75.5762 },
  { city: 'Jodhpur', slug: 'jodhpur', match: /jodhpur/i, lat: 26.2389, lng: 73.0243 },
  { city: 'Udaipur', slug: 'udaipur', match: /udaipur/i, lat: 24.5854, lng: 73.7125 },
  { city: 'Kota', slug: 'kota', match: /\bkota\b/i, lat: 25.2138, lng: 75.8648 },
  { city: 'Raipur', slug: 'raipur', match: /raipur/i, lat: 21.2514, lng: 81.6296 },
  { city: 'Bhubaneswar', slug: 'bhubaneswar', match: /bhubaneswar/i, lat: 20.2961, lng: 85.8245 },
  { city: 'Guwahati', slug: 'guwahati', match: /guwahati/i, lat: 26.1445, lng: 91.7362 },
  { city: 'Vijayawada', slug: 'vijayawada', match: /vijayawada/i, lat: 16.5062, lng: 80.648 },
  { city: 'Madurai', slug: 'madurai', match: /madurai/i, lat: 9.9252, lng: 78.1198 },
  { city: 'Tiruchirappalli', slug: 'tiruchirappalli', match: /tiruchirappalli|trichy/i, lat: 10.7905, lng: 78.7047 },
  { city: 'Goa', slug: 'goa', match: /\bgoa\b|panaji|panjim/i, lat: 15.4909, lng: 73.8278 },
  { city: 'Jamshedpur', slug: 'jamshedpur', match: /jamshedpur/i, lat: 22.8046, lng: 86.2029 },
  { city: 'Gorakhpur', slug: 'gorakhpur', match: /gorakhpur/i, lat: 26.7606, lng: 83.3732 },
  { city: 'Aligarh', slug: 'aligarh', match: /aligarh/i, lat: 27.8974, lng: 78.088 },
  { city: 'Bareilly', slug: 'bareilly', match: /bareilly/i, lat: 28.367, lng: 79.4304 },
  { city: 'Moradabad', slug: 'moradabad', match: /moradabad/i, lat: 28.8386, lng: 78.7733 },
  { city: 'Srinagar', slug: 'srinagar', match: /srinagar/i, lat: 34.0837, lng: 74.7973 },
  { city: 'Jammu', slug: 'jammu', match: /\bjammu\b/i, lat: 32.7266, lng: 74.857 },
  { city: 'Shimla', slug: 'shimla', match: /shimla/i, lat: 31.1048, lng: 77.1734 },
  { city: 'Rajkot', slug: 'rajkot', match: /rajkot/i, lat: 22.3039, lng: 70.8022 },
  { city: 'Aurangabad', slug: 'aurangabad', match: /aurangabad/i, lat: 19.8762, lng: 75.3433 },
  { city: 'Thane', slug: 'thane', match: /\bthane\b/i, lat: 19.2183, lng: 72.9781 },
]

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

// Every city with known coordinates (HOT_CITIES + EXTRA_CITIES), nearest-first to (lat, lng).
export function citiesByDistance(lat, lng) {
  const known = [
    ...HOT_CITIES.map((c) => ({ ...c, coords: CITY_COORDS[c.slug] })),
    ...EXTRA_CITIES.map((c) => ({ ...c, coords: { lat: c.lat, lng: c.lng } })),
  ]
  return known
    .filter((c) => c.coords)
    .map(({ coords, ...c }) => ({ ...c, distanceKm: haversineKm({ lat, lng }, coords) }))
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
