import { env } from '../config/env.js'

const SYSTEM = `You convert a recruiter's plain-English candidate search (or a pasted job description) into structured search filters.
Reply with a single JSON object using only these optional keys:
role (string, job title e.g. "Python Developer"), skills (string[]), keywords (string[]: important terms that fit no other field), exclude (string[]: things the recruiter does NOT want),
locations (string[]: cities), expMin (number, years), expMax (number, years), salaryMin (number, LPA), salaryMax (number, LPA), noticeMax (number, days; 0 = immediate joiner),
workMode ("Remote" | "Hybrid" | "Onsite"), industry (string), verifiedOnly (boolean).
Only include a key when the text clearly states it. Never invent values.`

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

export async function parseSearchQuery(text) {
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
