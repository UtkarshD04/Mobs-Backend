// Maps a notification's `category` to the page a push notification's click
// should land on, per audience — passed through as `data.url` in the push
// payload (see utils/push.js) and read by each app's public/sw.js on
// notificationclick. One map per audience since the same category name can
// mean different things (or not exist at all) in different apps; a category
// with no dedicated page yet falls back to that app's main authenticated
// screen rather than a path that doesn't exist.

// Employee notifications are served by Landing-Frontend (Website/Frontend,
// the old standalone candidate dashboard, was removed — see its git
// history) — src/pages/EmployeeProfile.jsx is the one page that currently
// covers all of these, so every category lands there until dedicated
// per-category pages exist.
const EMPLOYEE_FALLBACK_URL = '/employees/profile'
export function employeeNotificationUrl() {
  return EMPLOYEE_FALLBACK_URL
}

// Employer-Frontend — verified 1:1 against src/App.jsx's routes.
const EMPLOYER_CATEGORY_URLS = {
  batches: '/batches',
  interviews: '/interviews',
  billing: '/billing',
  jobs: '/jobs',
  candidates: '/candidates',
  offers: '/offers',
  system: '/notifications',
}
export function employerNotificationUrl(category) {
  return EMPLOYER_CATEGORY_URLS[category] ?? '/dashboard'
}

// Company-Frontend (staff/ops tool) — only resumes and interviews have a
// dedicated page today (resumes -> the resume queue, interviews -> mock
// interviews); companies/payments/batches/requirements/system have no page
// of their own yet, so they land on the dashboard rather than a 404.
const STAFF_CATEGORY_URLS = {
  resumes: '/app/resumes',
  'resume-pool': '/app/resumes',
  interviews: '/app/mock-interviews',
}
export function staffNotificationUrl(category) {
  return STAFF_CATEGORY_URLS[category] ?? '/app/dashboard'
}
