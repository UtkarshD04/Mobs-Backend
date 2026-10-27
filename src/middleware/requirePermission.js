import { can } from '../utils/permissions.js'

// Use after requireAuth. `any` of the listed permissions is enough.
export const requirePermission = (...permissions) => (req, res, next) => {
  const role = req.user?.role
  if (permissions.some((p) => can(role, p))) return next()
  return res.status(403).json({ code: 'FORBIDDEN', message: 'Your role does not have permission to do this. Ask a company Admin or Owner.' })
}
