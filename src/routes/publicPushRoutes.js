import { Router } from 'express'
import { env } from '../config/env.js'

const router = Router()

// No auth — Landing-Frontend has no account to gate this behind, and every
// other frontend needs this key before it can call pushManager.subscribe().
router.get('/vapid-public-key', (req, res) => res.json({ publicKey: env.vapid.publicKey }))

export default router
