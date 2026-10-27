import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { outreachLimiter } from '../middleware/rateLimit.js'
import { listTemplates, saveTemplate, resetTemplate, previewMessage, sendMessage, listLog } from '../controllers/communicationsController.js'

const router = Router()

router.use(requireAuth)
router.get('/templates', requirePermission('candidates.view'), listTemplates)
router.put('/templates/:key', requirePermission('templates.manage'), saveTemplate)
router.delete('/templates/:key', requirePermission('templates.manage'), resetTemplate)
router.post('/preview', requirePermission('templates.manage'), previewMessage)
router.post('/send', requirePermission('templates.manage'), outreachLimiter, sendMessage)
router.get('/log', requirePermission('candidates.view'), listLog)

export default router
