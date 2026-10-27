// Built-in message templates and the (pure) renderer. Placeholders are {{snake_case}}; an unknown
// or missing placeholder is left visibly unfilled rather than silently dropped, so a recruiter
// notices it in the preview before sending.

export const TEMPLATE_KEYS = ['application_received', 'shortlist_update', 'interview_invite', 'interview_reminder', 'offer_followup', 'rejection_update']

export const TEMPLATE_VARIABLES = ['candidate_name', 'job_title', 'company_name', 'recruiter_name', 'interview_date', 'interview_mode', 'interview_link_or_location', 'offer_expiry']

export const DEFAULT_TEMPLATES = {
  application_received: {
    label: 'Application received',
    subject: 'We received your application for {{job_title}}',
    body: 'Hi {{candidate_name}},\n\nThank you for applying for {{job_title}} at {{company_name}}. Our team is reviewing your profile and we will get back to you with the next steps.\n\nRegards,\n{{recruiter_name}}\n{{company_name}}',
  },
  shortlist_update: {
    label: 'Shortlist update',
    subject: 'Update on your application for {{job_title}}',
    body: 'Hi {{candidate_name}},\n\nGood news: your profile has been shortlisted for {{job_title}} at {{company_name}}. We will be in touch shortly about the next step.\n\nRegards,\n{{recruiter_name}}\n{{company_name}}',
  },
  interview_invite: {
    label: 'Interview invite',
    subject: 'Interview invitation: {{job_title}} at {{company_name}}',
    body: 'Hi {{candidate_name}},\n\nWe would like to invite you to an interview for {{job_title}}.\n\nWhen: {{interview_date}}\nMode: {{interview_mode}}\nWhere / link: {{interview_link_or_location}}\n\nPlease reply to confirm your availability.\n\nRegards,\n{{recruiter_name}}\n{{company_name}}',
  },
  interview_reminder: {
    label: 'Interview reminder',
    subject: 'Reminder: your interview for {{job_title}}',
    body: 'Hi {{candidate_name}},\n\nA reminder about your interview for {{job_title}} at {{company_name}}.\n\nWhen: {{interview_date}}\nMode: {{interview_mode}}\nWhere / link: {{interview_link_or_location}}\n\nRegards,\n{{recruiter_name}}\n{{company_name}}',
  },
  offer_followup: {
    label: 'Offer follow-up',
    subject: 'Following up on your offer for {{job_title}}',
    body: 'Hi {{candidate_name}},\n\nWe are following up on the offer we shared for {{job_title}} at {{company_name}}. The offer is valid until {{offer_expiry}}. Please let us know if you have any questions.\n\nRegards,\n{{recruiter_name}}\n{{company_name}}',
  },
  rejection_update: {
    label: 'Rejection update',
    subject: 'Your application for {{job_title}}',
    body: 'Hi {{candidate_name}},\n\nThank you for your interest in {{job_title}} at {{company_name}} and for the time you spent with us. After careful consideration we will not be moving forward with your application this time. We wish you the very best in your search.\n\nRegards,\n{{recruiter_name}}\n{{company_name}}',
  },
}

export function render(text, vars) {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name) => {
    const value = vars?.[name]
    return value === undefined || value === null || value === '' ? match : String(value)
  })
}

export const unfilledPlaceholders = (text) => [...new Set([...String(text ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))]
