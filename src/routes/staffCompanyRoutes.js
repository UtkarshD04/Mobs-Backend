import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import {
  listCompanies,
  getCompany,
  verifyCompany,
  rejectCompany,
  blockCompany,
  unblockCompany,
  deleteCompany,
} from '../controllers/staffCompanyController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listCompanies)
router.get('/:id', getCompany)
router.patch('/:id/verify', verifyCompany)
router.patch('/:id/reject', rejectCompany)
router.patch('/:id/block', blockCompany)
router.patch('/:id/unblock', unblockCompany)
router.delete('/:id', deleteCompany)

export default router
