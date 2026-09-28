import { asyncHandler } from '../utils/asyncHandler.js'
import { env } from '../config/env.js'
import { parseSearchQuery } from '../utils/aiQueryParser.js'

// POST /employer/ai/parse-query  { text } → { filters }
export const parseQuery = asyncHandler(async (req, res) => {
  if (!env.groq.apiKey) return res.status(503).json({ message: 'AI search is not set up.' })
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 6000) : ''
  if (!text) return res.status(400).json({ message: 'text is required.' })
  const filters = await parseSearchQuery(text)
  res.json({ filters })
})
