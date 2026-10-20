// The 28 states and 8 union territories of India (official list, Jan 2020 UT merger
// applied). This is the only static location data — cities, localities and
// coordinates always come from the geocoder or from the employer's own jobs.
export const INDIA_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]

// Spellings geocoders / older records use for the same state.
const ALIASES = {
  'nct of delhi': 'Delhi',
  'national capital territory of delhi': 'Delhi',
  orissa: 'Odisha',
  uttaranchal: 'Uttarakhand',
  pondicherry: 'Puducherry',
  'jammu & kashmir': 'Jammu and Kashmir',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
}

const BY_LOWER = new Map(INDIA_STATES.map((s) => [s.toLowerCase(), s]))

/** Canonical spelling of a state name, or the trimmed input if it isn't a known one. */
export function canonicalState(name) {
  const key = String(name ?? '').trim().toLowerCase()
  return BY_LOWER.get(key) ?? ALIASES[key] ?? String(name ?? '').trim()
}
