import { Router } from 'express'
import authRoutes from './authRoutes.js'
import companyRoutes from './companyRoutes.js'
import jobRoutes from './jobRoutes.js'
import teamRoutes from './teamRoutes.js'
import batchRoutes from './batchRoutes.js'
import candidateRoutes from './candidateRoutes.js'
import interviewRoutes from './interviewRoutes.js'
import offerRoutes from './offerRoutes.js'
import notificationRoutes from './notificationRoutes.js'
import billingRoutes from './billingRoutes.js'
import dashboardRoutes from './dashboardRoutes.js'
import supportRoutes from './supportRoutes.js'
import contactRoutes from './contactRoutes.js'
import employeeAuthRoutes from './employeeAuthRoutes.js'
import employeeProfileRoutes from './employeeProfileRoutes.js'
import employeeResumeRoutes from './employeeResumeRoutes.js'
import employeeSubscriptionRoutes from './employeeSubscriptionRoutes.js'
import employeeJobRoutes from './employeeJobRoutes.js'
import employeeApplicationRoutes from './employeeApplicationRoutes.js'
import employeeMockInterviewRoutes from './employeeMockInterviewRoutes.js'
import employeeInterviewRoutes from './employeeInterviewRoutes.js'
import staffAuthRoutes from './staffAuthRoutes.js'
import staffCompanyRoutes from './staffCompanyRoutes.js'
import staffJobRoutes from './staffJobRoutes.js'
import staffResumeRoutes from './staffResumeRoutes.js'
import staffApplicationRoutes from './staffApplicationRoutes.js'
import staffBatchRoutes from './staffBatchRoutes.js'
import staffMockInterviewRoutes from './staffMockInterviewRoutes.js'
import staffEmployeeRoutes from './staffEmployeeRoutes.js'
import staffPaymentRoutes from './staffPaymentRoutes.js'
import staffTeamRoutes from './staffTeamRoutes.js'
import staffDashboardRoutes from './staffDashboardRoutes.js'

const employerRoutes = Router()
employerRoutes.use('/auth', authRoutes)
employerRoutes.use('/company', companyRoutes)
employerRoutes.use('/jobs', jobRoutes)
employerRoutes.use('/team', teamRoutes)
employerRoutes.use('/batches', batchRoutes)
employerRoutes.use('/candidates', candidateRoutes)
employerRoutes.use('/interviews', interviewRoutes)
employerRoutes.use('/offers', offerRoutes)
employerRoutes.use('/notifications', notificationRoutes)
employerRoutes.use('/billing', billingRoutes)
employerRoutes.use('/dashboard', dashboardRoutes)
employerRoutes.use('/support', supportRoutes)

const employeeRoutes = Router()
employeeRoutes.use('/auth', employeeAuthRoutes)
employeeRoutes.use('/profile', employeeProfileRoutes)
employeeRoutes.use('/resume', employeeResumeRoutes)
employeeRoutes.use('/subscription', employeeSubscriptionRoutes)
employeeRoutes.use('/jobs', employeeJobRoutes)
employeeRoutes.use('/applications', employeeApplicationRoutes)
employeeRoutes.use('/mock-interview', employeeMockInterviewRoutes)
employeeRoutes.use('/interviews', employeeInterviewRoutes)

const staffRoutes = Router()
staffRoutes.use('/auth', staffAuthRoutes)
staffRoutes.use('/companies', staffCompanyRoutes)
staffRoutes.use('/jobs', staffJobRoutes)
staffRoutes.use('/resumes', staffResumeRoutes)
staffRoutes.use('/applications', staffApplicationRoutes)
staffRoutes.use('/batches', staffBatchRoutes)
staffRoutes.use('/mock-interviews', staffMockInterviewRoutes)
staffRoutes.use('/employees', staffEmployeeRoutes)
staffRoutes.use('/payments', staffPaymentRoutes)
staffRoutes.use('/team', staffTeamRoutes)
staffRoutes.use('/dashboard', staffDashboardRoutes)

const router = Router()
router.use('/employer', employerRoutes)
router.use('/employee', employeeRoutes)
router.use('/staff', staffRoutes)
router.use('/contact', contactRoutes)

export default router
