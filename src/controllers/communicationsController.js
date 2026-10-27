import mongoose from 'mongoose'
import { asyncHandler } from '../utils/asyncHandler.js'
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, TEMPLATE_VARIABLES, render, unfilledPlaceholders } from '../utils/commTemplates.js'
import { firstName, performOutreach, validateEmailContent } from '../utils/outreach.js'
import { revealedParts } from '../utils/candidateReveal.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'
import { recordEvent } from './applicantsController.js'
import { logger } from '../config/logger.js'
import CommunicationTemplate from '../models/CommunicationTemplate.js'
import Candidate from '../models/Candidate.js'
import CandidateEvent from '../models/CandidateEvent.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import Employee from '../models/Employee.js'
import Interview from '../models/Interview.js'
import Offer from '../models/Offer.js'
import Job from '../models/Job.js'

const isId = (v) => mongoose.isValidObjectId(v)

async function templatesFor(companyId) {
  const custom = await CommunicationTemplate.find({ company: companyId })
  const byKey = new Map(custom.map((t) => [t.key, t]))
  return TEMPLATE_KEYS.map((key) => {
    const own = byKey.get(key)
    const base = DEFAULT_TEMPLATES[key]
    return { key, label: base.label, subject: own?.subject ?? base.subject, body: own?.body ?? base.body, custom: !!own, updatedAt: own?.updatedAt ?? null }
  })
}

export const listTemplates = asyncHandler(async (req, res) => {
  res.json({ templates: await templatesFor(req.company._id), variables: TEMPLATE_VARIABLES })
})

function validateTemplate({ subject, body }) {
  const s = String(subject ?? '').replace(/[\r\n]+/g, ' ').trim()
  const b = String(body ?? '').replace(/\r\n/g, '\n').trim()
  const errors = {}
  if (!s) errors.subject = 'Add a subject.'
  else if (s.length > 150) errors.subject = 'Keep the subject under 150 characters.'
  if (!b) errors.body = 'Write the message.'
  else if (b.length > 5000) errors.body = 'Keep the message under 5000 characters.'
  const unknown = [...unfilledPlaceholders(`${s}\n${b}`)].filter((p) => !TEMPLATE_VARIABLES.includes(p))
  if (unknown.length) errors.body = `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{{${u}}}`).join(', ')}`
  return Object.keys(errors).length ? { errors } : { value: { subject: s, body: b } }
}

export const saveTemplate = asyncHandler(async (req, res) => {
  const key = req.params.key
  if (!TEMPLATE_KEYS.includes(key)) return res.status(404).json({ message: 'Unknown template' })
  const { value, errors } = validateTemplate(req.body ?? {})
  if (errors) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors })
  await CommunicationTemplate.findOneAndUpdate({ company: req.company._id, key }, { ...value, updatedBy: req.user._id }, { upsert: true, new: true, setDefaultsOnInsert: true })
  res.json((await templatesFor(req.company._id)).find((t) => t.key === key))
})

export const resetTemplate = asyncHandler(async (req, res) => {
  if (!TEMPLATE_KEYS.includes(req.params.key)) return res.status(404).json({ message: 'Unknown template' })
  await CommunicationTemplate.deleteOne({ company: req.company._id, key: req.params.key })
  res.json((await templatesFor(req.company._id)).find((t) => t.key === req.params.key))
})

// Variables we can fill from real records; the recruiter supplies the rest in the preview.
async function variablesFor(req, candidate, overrides = {}) {
  const [job, interview, offer] = await Promise.all([
    candidate.job ? Job.findById(candidate.job).select('title') : null,
    Interview.findOne({ company: req.company._id, candidate: candidate._id, status: { $ne: 'Cancelled' } }).sort({ startsAt: -1 }),
    Offer.findOne({ company: req.company._id, candidate: candidate._id, status: 'pending' }).sort({ sentOn: -1 }),
  ])
  const vars = {
    candidate_name: firstName(candidate.name),
    job_title: job?.title ?? candidate.appliedFor,
    company_name: req.company.name,
    recruiter_name: req.user.name,
  }
  if (interview) {
    vars.interview_date = new Date(interview.startsAt).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })
    vars.interview_mode = interview.mode
    vars.interview_link_or_location = interview.mode === 'Video Call' ? interview.meetingLink : interview.location
  }
  if (offer?.expiresOn) vars.offer_expiry = new Date(offer.expiresOn).toLocaleDateString('en-IN', { dateStyle: 'long' })
  for (const [k, v] of Object.entries(overrides ?? {})) if (TEMPLATE_VARIABLES.includes(k) && typeof v === 'string' && v.trim()) vars[k] = v.trim().slice(0, 300)
  return vars
}

async function compose(req) {
  const { candidateId, templateKey, subject, body, variables } = req.body ?? {}
  if (!isId(candidateId)) return { status: 400, json: { message: 'Choose a candidate.' } }
  if (!TEMPLATE_KEYS.includes(templateKey)) return { status: 400, json: { message: 'Choose a template.' } }
  const candidate = await Candidate.findOne({ _id: candidateId, company: req.company._id })
  if (!candidate) return { status: 404, json: { message: 'Candidate not found' } }
  const template = (await templatesFor(req.company._id)).find((t) => t.key === templateKey)
  const vars = await variablesFor(req, candidate, variables)
  const rawSubject = typeof subject === 'string' && subject.trim() ? subject : template.subject
  const rawBody = typeof body === 'string' && body.trim() ? body : template.body
  const out = { subject: render(rawSubject, vars), body: render(rawBody, vars) }
  return { candidate, template, out, missing: unfilledPlaceholders(`${out.subject}\n${out.body}`) }
}

// POST /communications/preview — the rendered message plus anything still unfilled, and which channels are usable.
export const previewMessage = asyncHandler(async (req, res) => {
  const c = await compose(req)
  if (c.status) return res.status(c.status).json(c.json)
  const unlock = await CandidateUnlock.findOne({ company: req.company._id, candidate: c.candidate._id })
  res.json({
    subject: c.out.subject,
    body: c.out.body,
    missing: c.missing,
    channels: { email: { available: revealedParts(unlock).has('email'), reason: 'View the candidate’s email first (uses a CV credit once).' }, in_app: { available: !!c.candidate.employee, reason: 'Only for candidates who applied through MZOBS.' } },
  })
})

// POST /communications/send { candidateId, templateKey, channel: 'email'|'in_app', subject?, body?, variables? }
// Email goes through the same compliant path as all recruiter outreach (needs the email unlocked, daily per-candidate cap,
// sender footer). Bulk SMS/WhatsApp is intentionally not offered: it needs consent records and DLT-approved templates.
export const sendMessage = asyncHandler(async (req, res) => {
  const channel = req.body?.channel
  if (channel !== 'email' && channel !== 'in_app') return res.status(400).json({ message: 'channel must be email or in_app' })
  const c = await compose(req)
  if (c.status) return res.status(c.status).json(c.json)
  if (c.missing.length) return res.status(400).json({ code: 'UNFILLED_PLACEHOLDERS', message: `Fill in ${c.missing.map((m) => `{{${m}}}`).join(', ')} before sending.`, missing: c.missing })

  const { candidate, template, out } = c
  let status = 'sent'
  if (channel === 'email') {
    const check = validateEmailContent(out)
    if (!check.ok) return res.status(400).json({ code: 'INVALID_MESSAGE', message: check.error })
    const [unlock, employee] = await Promise.all([CandidateUnlock.findOne({ company: req.company._id, candidate: candidate._id }), candidate.employee ? Employee.findById(candidate.employee).select('name email phone') : null])
    const result = await performOutreach({ company: req.company, user: req.user, candidate, employee, unlock, channel: 'email', subject: out.subject, body: out.body })
    if (result.status !== 200) return res.status(result.status).json(result.json)
  } else {
    if (!candidate.employee) return res.status(422).json({ code: 'NOT_A_PLATFORM_CANDIDATE', message: 'This candidate did not apply through MZOBS, so there is no in-app inbox to message.' })
    const employee = await Employee.findById(candidate.employee)
    if (!employee) return res.status(422).json({ code: 'NOT_A_PLATFORM_CANDIDATE', message: 'This candidate’s account is no longer available.' })
    try {
      await notifyEmployee(employee, { category: 'applications', title: out.subject.slice(0, 120), body: out.body.slice(0, 1000) })
    } catch (err) {
      logger.warn({ err }, 'In-app candidate message failed')
      status = 'failed'
    }
    if (status === 'failed') return res.status(502).json({ code: 'SEND_FAILED', message: 'Could not deliver the message right now. Please try again.' })
  }

  await recordEvent(req, candidate, 'comm', `${template.label} sent by ${channel === 'email' ? 'email' : 'in-app message'}`, { templateKey: template.key, channel, status, subject: out.subject })
  res.json({ ok: true, channel, sentAt: new Date().toISOString() })
})

// GET /communications/log?candidateId= — the outbound log, newest first.
export const listLog = asyncHandler(async (req, res) => {
  const query = { company: req.company._id, type: 'comm' }
  if (req.query.candidateId) {
    if (!isId(req.query.candidateId)) return res.status(400).json({ message: 'Invalid candidateId' })
    query.candidate = req.query.candidateId
  }
  const rows = await CandidateEvent.find(query).sort({ createdAt: -1 }).limit(100).populate('candidate', 'name')
  res.json(rows.map((e) => ({ id: e.id, candidateId: String(e.candidate?._id ?? e.candidate), candidateName: e.candidate?.name ?? '', text: e.text, channel: e.meta?.channel, templateKey: e.meta?.templateKey, subject: e.meta?.subject, status: e.meta?.status, sentBy: e.actorName, at: e.createdAt })))
})
