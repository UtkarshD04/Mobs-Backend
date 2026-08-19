import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, setPaginationHeaders } from '../utils/paginate.js'
import Invoice from '../models/Invoice.js'
import Employee from '../models/Employee.js'

// This report merges two different collections in memory, so each source
// query is capped rather than paginated at the DB level — bounded to the
// most recent SOURCE_CAP rows of each type before merging, sorting and
// slicing to the requested page. Prevents an unbounded scan/serialize;
// not exact pagination at extreme scale, which is fine for an admin report.
const SOURCE_CAP = 500

export const listPayments = asyncHandler(async (req, res) => {
  const { type, status } = req.query
  const { page, limit, skip } = paginationParams(req)

  const rows = []

  if (type !== 'candidate') {
    const invoices = await Invoice.find({}).populate('company', 'name').populate('job', 'title').sort({ date: -1 }).limit(SOURCE_CAP)
    for (const inv of invoices) {
      rows.push({
        id: inv._id.toString(),
        type: 'employer',
        party: inv.company?.name ?? '',
        desc: inv.description,
        date: inv.date,
        amount: inv.amount,
        status: inv.status,
        paymentMode: inv.paymentMode,
        reference: inv.reference,
      })
    }
  }

  if (type !== 'employer') {
    const employees = await Employee.find({ 'subscription.amount': { $gt: 0 } })
      .select('name subscription createdAt')
      .sort({ createdAt: -1 })
      .limit(SOURCE_CAP)
    for (const emp of employees) {
      rows.push({
        id: emp._id.toString(),
        type: 'candidate',
        party: emp.name,
        desc: 'Mzobs placement programme — one-time fee',
        date: emp.subscription.paidOn ?? emp.createdAt,
        amount: emp.subscription.amount,
        status: emp.subscription.status === 'paid' ? 'paid' : 'due',
      })
    }
  }

  const filtered = status && status !== 'all' ? rows.filter((r) => r.status === status) : rows
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date))
  const pageRows = filtered.slice(skip, skip + limit)

  setPaginationHeaders(res, { page, limit, total: filtered.length })
  res.json(pageRows)
})

export const recordSubscriptionPayment = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  employee.subscription.status = 'paid'
  employee.subscription.paidOn = new Date()
  await employee.save()

  await logStaffActivity(`Recorded ₹${employee.subscription.amount} subscription payment for ${employee.name}`, 'green')

  res.json(employee.subscription)
})
