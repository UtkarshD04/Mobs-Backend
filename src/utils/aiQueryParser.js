import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

let client
const getClient = () => (client ??= new Anthropic({ apiKey: env.anthropic.apiKey }))

const SYSTEM = `You convert a recruiter's plain-English candidate search (or a pasted job description) into structured search filters.
Only fill a field when the text clearly states it; otherwise leave it out. Salary is in LPA (lakhs per annum), notice in days, experience in years.
Put important terms that fit no other field (tools, domains, certifications) in "keywords". Put things the recruiter does NOT want in "exclude".`

const TOOL = {
  name: 'set_search_filters',
  description: 'Structured candidate search filters extracted from the recruiter text.',
  input_schema: {
    type: 'object',
    properties: {
      role: { type: 'string', description: 'Job title, e.g. "Python Developer"' },
      skills: { type: 'array', items: { type: 'string' } },
      keywords: { type: 'array', items: { type: 'string' } },
      exclude: { type: 'array', items: { type: 'string' } },
      locations: { type: 'array', items: { type: 'string' }, description: 'Cities, canonical spelling' },
      expMin: { type: 'number' },
      expMax: { type: 'number' },
      salaryMin: { type: 'number' },
      salaryMax: { type: 'number' },
      noticeMax: { type: 'number', description: '0 = immediate joiner' },
      workMode: { type: 'string', enum: ['Remote', 'Hybrid', 'Onsite'] },
      industry: { type: 'string' },
      verifiedOnly: { type: 'boolean' },
    },
  },
}

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
  const res = await getClient().messages.create({
    model: env.anthropic.model,
    max_tokens: 1024,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: text }],
  })
  const block = res.content.find((b) => b.type === 'tool_use')
  return sanitizeFilters(block?.input)
}
