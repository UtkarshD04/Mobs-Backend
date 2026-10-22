import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { uploadPhoto } from '../middleware/photoUpload.js'
import { uploadPhotoFile, deletePhoto } from '../controllers/employeePhotoController.js'

const router = Router()

router.post('/', requireEmployeeAuth, uploadPhoto, uploadPhotoFile)
router.delete('/', requireEmployeeAuth, deletePhoto)

export default router
