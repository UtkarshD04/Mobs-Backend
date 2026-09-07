// Curated fallback data for GET /api/employee/jobs/suggestions — used only
// to pad out "popular" title/city suggestions when candidate-visible live
// job data is too sparse on its own. This is the single source of truth:
// the frontend never hardcodes these lists, it only renders whatever the
// API returns.

export const POPULAR_JOB_TITLES = [
  'Software Developer',
  'Frontend Developer',
  'Backend Developer',
  'Data Analyst',
  'Sales Executive',
  'HR Executive',
  'Customer Support Executive',
  'Graphic Designer',
  'Digital Marketing Executive',
  'Business Development Executive',
]

export const POPULAR_CITIES = [
  'Bengaluru',
  'Delhi NCR',
  'Mumbai',
  'Hyderabad',
  'Pune',
  'Chennai',
  'Gurugram',
  'Noida',
  'Ahmedabad',
  'Kolkata',
  'Jaipur',
  'Chandigarh',
  'Indore',
  'Kochi',
  'Lucknow',
]

// Padding for the "skills" group of GET /api/jobs/suggestions (the Landing
// Frontend's combined title/skill/company box) when live, candidate-visible
// job data is too sparse on its own — same rule as POPULAR_JOB_TITLES above.
export const POPULAR_SKILLS = [
  'React',
  'Node.js',
  'Python',
  'Java',
  'SQL',
  'Excel',
  'Communication',
  'Sales',
  'Digital Marketing',
  'Customer Service',
]
