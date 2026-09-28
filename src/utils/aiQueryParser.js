import { env } from '../config/env.js'

const SYSTEM = `You convert a recruiter's plain-English candidate search (or a pasted job description) into structured search filters.
Reply with a single JSON object using only these optional keys:
role (string, job title e.g. "Python Developer"), skills (string[]), keywords (string[]: important terms that fit no other field), exclude (string[]: things the recruiter does NOT want),
locations (string[]: cities), expMin (number, years), expMax (number, years), salaryMin (number, LPA), salaryMax (number, LPA), noticeMax (number, days; 0 = immediate joiner),
workMode ("Remote" | "Hybrid" | "Onsite"), industry (string), verifiedOnly (boolean).
Rules: only include a key when the text clearly states it, and copy the recruiter's own words — never invent or infer skills, roles or keywords they did not write.
Anything already captured by another key (experience, notice, salary, location, work mode, "verified") must NOT be repeated in keywords. Use keywords only for leftover terms that fit no other key.
Set role whenever a job title is written, even lowercase or plural ("data analyst", "React developers" → "Data Analyst", "React Developer").`

const STR_ARRAYS = ['skills', 'keywords', 'exclude', 'locations']
const NUMBERS = ['expMin', 'expMax', 'salaryMin', 'salaryMax', 'noticeMax']
const STRINGS = ['role', 'industry']

/** Keeps only known fields with the right types, so a odd model reply can never reach the search engine. */
export function sanitizeFilters(raw = {}) {
  const out = {}
  for (const k of STR_ARRAYS) {
    if (Array.isArray(raw[k])) out[k] = raw[k].filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 60)).slice(0, 25)
  }
  for (const k of NUMBERS) if (Number.isFinite(raw[k]) && raw[k] >= 0) out[k] = raw[k]
  for (const k of STRINGS) if (typeof raw[k] === 'string' && raw[k].trim()) out[k] = raw[k].trim().slice(0, 80)
  if (['Remote', 'Hybrid', 'Onsite'].includes(raw.workMode)) out.workMode = raw.workMode
  if (raw.verifiedOnly === true) out.verifiedOnly = true
  return out
}

const TITLE_NOUN = /\b(developer|engineer|designer|analyst|manager|architect|lead|consultant|administrator|executive|officer|specialist|scientist|tester|intern|recruiter|accountant|associate|director|head|writer|editor|coordinator|technician|supervisor|assistant|programmer|marketer|strategist|representative|agent|operator|advisor|planner|auditor|trainer|teacher|nurse|driver)s?$/i
const norm = (str) => str.toLowerCase().replace(/[^a-z0-9+#. ]+/g, ' ').replace(/\bdevs?\b/g, 'developer').replace(/\bengg?\b/g, 'engineer').replace(/\s+/g, ' ').trim()
const stem = (w) => w.replace(/^\.+|\.+$/g, '').replace(/s$/, '')

/** The model sometimes invents a role or keyword. Keep them only if the recruiter's own words back them up. */
export function groundFilters(filters, text) {
  const words = new Set(norm(text).split(' ').map(stem))
  const seen = (phrase) => norm(phrase).split(' ').every((w) => words.has(stem(w)))
  const out = { ...filters }
  if (out.role) {
    const plain = out.role.replace(/\b(senior|sr|junior|jr|lead)\b\.?/gi, '')
    // Not something the recruiter wrote → drop it. Written but not a job title ("plumber", "ROS") → require it as a keyword instead of losing it.
    if (!seen(plain)) delete out.role
    else if (!TITLE_NOUN.test(out.role)) {
      const kws = out.keywords ?? []
      if (!kws.some((k) => norm(out.role).includes(norm(k)))) out.keywords = [...kws, out.role]
      delete out.role
    }
  }
  if (out.keywords) out.keywords = out.keywords.filter(seen)
  if (out.exclude) out.exclude = out.exclude.filter(seen)
  return out
}

// Same search text twice (refresh, re-run, back button) shouldn't cost a model call.
const cache = new Map()
const CACHE_MAX = 200
const CACHE_TTL_MS = 60 * 60 * 1000

export async function parseSearchQuery(text) {
  const key = norm(text)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.filters
  const filters = groundFilters(await callModel(text), text)
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, { at: Date.now(), filters })
  return filters
}

async function callModel(text) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.groq.apiKey}` },
    body: JSON.stringify({
      model: env.groq.model,
      temperature: 0,
      max_tokens: 2000,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
    }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}`)
  const data = await res.json()
  let raw
  try { raw = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') } catch { raw = {} }
  return sanitizeFilters(raw)
}
