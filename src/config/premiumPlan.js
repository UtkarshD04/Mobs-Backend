// Single source of truth for the candidate plans: what Basic and Premium
// include, the Premium fee, the free application cap, and the human-delivered
// Premium services a paid candidate can request (see PremiumServiceRequest).
// Served as-is by GET /api/employee/subscription/plan, so the website's plan
// page, the apply gate and the Operations queue can never drift apart.

// One-time, lifetime fee (tax-inclusive — see the GST note in env.js).
export const PREMIUM_FEE = 499

// Lifetime cap on applications for Basic accounts. Withdrawn applications
// still count (see employeeApplicationController.js).
export const FREE_APPLICATION_LIMIT = 10

// Services the MZOBS team delivers by hand. A Premium candidate requests one,
// Operations schedules and works on it, then marks it delivered — see
// PremiumServiceRequest.js for the pipeline stages.
export const PREMIUM_SERVICES = [
  { key: 'cv_enhancement', category: 'resume', label: 'Professional CV enhancement', description: 'A recruiter rewrites and restructures your CV, including role-specific versions for the jobs you are targeting.' },
  { key: 'ats_review', category: 'resume', label: 'ATS score & improvement guidance', description: 'An ATS score for your current CV with clear, line-by-line changes to improve it.' },
  { key: 'profile_enhancement', category: 'resume', label: 'Expert-assisted profile enhancement', description: 'An expert reviews your MZOBS profile, finds skill gaps and helps you present it the way recruiters read it.' },
  { key: 'skill_assessment', category: 'skills', label: 'Verified skill assessment', description: 'A guided Learn → Practice → Test round that ends in a verified skill result on your profile.' },
  { key: 'career_assessment', category: 'career', label: 'Career SWOT & skill-gap analysis', description: 'A personal SWOT and an expert-identified list of skill gaps, with an improvement plan.' },
  { key: 'career_roadmap', category: 'career', label: '30/60/90-day career roadmap', description: 'A personalised roadmap with your next best actions for the coming three months.' },
  { key: 'career_pivot', category: 'career', label: 'Career transition plan', description: 'A human-guided plan for moving into a new role, function or industry.' },
  { key: 'mock_interview', category: 'interview', label: 'Live technical + behavioural mock interview', description: 'A live mock interview with a detailed interviewer scorecard afterwards.' },
  { key: 'hr_mock_interview', category: 'interview', label: 'Live HR mock interview', description: 'A live HR round covering salary, notice period, motivation and culture-fit questions.' },
  { key: 'interview_coaching', category: 'interview', label: 'Interview coaching & storytelling', description: 'Role- and company-specific preparation, including STAR-method storytelling practice.' },
  { key: 'communication_coaching', category: 'interview', label: 'Communication & professional presence coaching', description: '1-to-1 feedback on how you speak, write and present yourself professionally.' },
  { key: 'hr_coaching', category: 'coaching', label: '1-to-1 HR & career coaching', description: 'A session with an experienced HR/career professional, including periodic progress reviews.' },
  { key: 'salary_guidance', category: 'coaching', label: 'Salary & offer guidance', description: 'Help reading an offer, benchmarking the salary and negotiating it.' },
  { key: 'application_strategy', category: 'coaching', label: 'Application strategy & rejection analysis', description: 'A personal application strategy, plus feedback on rejections where information is available.' },
  { key: 'wellbeing_support', category: 'coaching', label: 'Career well-being conversation', description: 'A supportive conversation about job-search stress, with appropriate professional referrals when needed.' },
]

export const PREMIUM_SERVICE_KEYS = PREMIUM_SERVICES.map((s) => s.key)

// The Basic vs Premium comparison, grouped for display. `basic`/`premium` are
// either true (included), false (not included) or a short description.
// `service` links a row to the request above that delivers it.
export const PLAN_FEATURE_GROUPS = [
  {
    key: 'jobs',
    label: 'Jobs & applications',
    features: [
      { label: 'Browse jobs', basic: 'Unlimited', premium: 'Unlimited' },
      { label: 'Job applications', basic: `First ${FREE_APPLICATION_LIMIT} applications`, premium: 'Unlimited applications' },
      { label: 'Job search filters', basic: 'Basic', premium: 'Advanced: role, salary, location, work mode, experience and more' },
      { label: 'Job alerts', basic: 'Standard', premium: 'Instant & personalised job alerts' },
      { label: 'Urgent hiring jobs', basic: 'Limited visibility', premium: 'Priority access to relevant urgent hiring opportunities' },
      { label: 'Early applicant access', basic: false, premium: 'Early job notifications' },
      { label: 'Location preference', basic: true, premium: 'Personalised location matching' },
      { label: 'Work mode preference', basic: true, premium: 'Remote / Hybrid / On-site preference matching' },
      { label: 'Job matching', basic: 'Basic', premium: 'Personalised job-fit recommendations' },
      { label: 'Application tracking', basic: 'Basic', premium: 'Detailed application status visibility' },
    ],
  },
  {
    key: 'profile',
    label: 'Profile & resume',
    features: [
      { label: 'Profile creation', basic: 'Basic', premium: 'Expert-assisted profile enhancement', service: 'profile_enhancement' },
      { label: 'Profile completion', basic: 'Basic', premium: 'Skill-based profile gap identification + expert guidance', service: 'profile_enhancement' },
      { label: 'Resume upload', basic: true, premium: true },
      { label: 'CV enhancement', basic: 'Basic editing', premium: 'Professional human CV enhancement', service: 'cv_enhancement' },
      { label: 'ATS resume score', basic: false, premium: 'ATS score + improvement guidance', service: 'ats_review' },
      { label: 'Job-specific resume', basic: false, premium: 'Customised CV for relevant roles', service: 'cv_enhancement' },
      { label: 'Profile presentation', basic: 'Basic', premium: 'Recruiter-ready professional presentation', service: 'profile_enhancement' },
      { label: 'Profile verification', basic: 'Basic', premium: 'Mzobs Verified Talent' },
    ],
  },
  {
    key: 'visibility',
    label: 'Recruiter visibility',
    features: [
      { label: 'Recruiter visibility', basic: 'Standard', premium: 'Premium talent visibility' },
      { label: 'Recruiter contact', basic: false, premium: 'Eligible recruiter connection opportunities' },
      { label: 'Talent spotlight', basic: false, premium: 'Opportunity to be featured to relevant employers' },
      { label: 'Referral opportunities', basic: 'Basic', premium: 'Premium referral opportunities where available' },
      { label: 'Internal vacancies', basic: 'Standard', premium: 'Priority access to eligible internal opportunities' },
    ],
  },
  {
    key: 'skills',
    label: 'Skills & career planning',
    features: [
      { label: 'Skill assessment', basic: 'Basic', premium: 'Verified skill assessments', service: 'skill_assessment' },
      { label: 'Learn & test', basic: 'Limited / general', premium: 'Personalised Learn → Practice → Test journey', service: 'skill_assessment' },
      { label: 'SWOT analysis', basic: false, premium: 'Personal career SWOT assessment', service: 'career_assessment' },
      { label: 'Skill gap analysis', basic: false, premium: 'Expert-identified skill gaps + improvement plan', service: 'career_assessment' },
      { label: 'Career roadmap', basic: false, premium: 'Personalised 30/60/90-day roadmap', service: 'career_roadmap' },
      { label: 'Career pivot support', basic: false, premium: 'Human-guided career transition plan', service: 'career_pivot' },
    ],
  },
  {
    key: 'interview',
    label: 'Interview preparation',
    features: [
      { label: 'Mock interview', basic: 'Limited / basic', premium: 'Live human technical + behavioural interviews', service: 'mock_interview' },
      { label: 'HR interview practice', basic: false, premium: 'Live HR mock interview', service: 'hr_mock_interview' },
      { label: 'Interview skills', basic: 'Basic resources', premium: 'Personalised interview coaching', service: 'interview_coaching' },
      { label: 'Storytelling training', basic: false, premium: 'Human-guided storytelling & STAR technique training', service: 'interview_coaching' },
      { label: 'Communication practice', basic: 'Basic resources', premium: '1-to-1 communication feedback', service: 'communication_coaching' },
      { label: 'Personality / professional presence', basic: 'Basic resources', premium: 'Personalised professional presence coaching', service: 'communication_coaching' },
      { label: 'Interview feedback', basic: 'Basic', premium: 'Detailed human interviewer scorecard', service: 'mock_interview' },
      { label: 'Interview preparation', basic: 'General resources', premium: 'Role & company-specific preparation', service: 'interview_coaching' },
      { label: 'Real workshops', basic: 'Selected / free workshops', premium: 'Premium workshops + priority access' },
    ],
  },
  {
    key: 'coaching',
    label: 'Coaching & guidance',
    features: [
      { label: '1-to-1 HR coaching', basic: false, premium: 'Sessions with experienced HR/career professionals', service: 'hr_coaching' },
      { label: 'Career guidance', basic: 'General resources', premium: 'Personalised human career guidance', service: 'hr_coaching' },
      { label: 'Salary guidance', basic: false, premium: 'Human salary & offer guidance', service: 'salary_guidance' },
      { label: 'Application strategy', basic: false, premium: 'Personalised application strategy', service: 'application_strategy' },
      { label: 'Rejection analysis', basic: false, premium: 'Feedback + improvement guidance where information is available', service: 'application_strategy' },
      { label: 'Career progress review', basic: false, premium: 'Periodic career progress review', service: 'hr_coaching' },
      { label: 'Career well-being support', basic: 'General resources', premium: 'Human career-support conversations + appropriate professional referrals when needed', service: 'wellbeing_support' },
      { label: 'Next best action', basic: false, premium: 'Personalised next-step recommendations', service: 'career_roadmap' },
    ],
  },
]

export function publicPlan() {
  return {
    basic: { name: 'Mzobs Basic', price: 0, applicationLimit: FREE_APPLICATION_LIMIT },
    premium: { name: 'Mzobs Premium', price: PREMIUM_FEE, currency: 'INR', billing: 'one_time' },
    groups: PLAN_FEATURE_GROUPS,
    services: PREMIUM_SERVICES,
  }
}
