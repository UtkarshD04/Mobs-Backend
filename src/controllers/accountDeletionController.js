import { asyncHandler } from '../utils/asyncHandler.js'
import { checkPhoneToken } from '../utils/phoneToken.js'
import { deleteEmployeeAccount } from '../utils/accountDeletion.js'
import Employee from '../models/Employee.js'

const PHONE_RE = /^[6-9]\d{9}$/

// Play Store's Account Deletion policy requires a deletion path that works
// without the app installed. This is that page's backend: it reuses the
// same phone-OTP flow signup already uses (POST /employee/auth/send-otp,
// then /verify-otp for a phoneToken) rather than inventing a second one, so
// the public page just needs the phone + the phoneToken it got back.
export const deleteByPhone = asyncHandler(async (req, res) => {
  const { phone, phoneToken } = req.body ?? {}
  if (typeof phone !== 'string' || !PHONE_RE.test(phone.trim())) {
    return res.status(400).json({ message: 'A valid 10-digit mobile number is required.' })
  }
  if (typeof phoneToken !== 'string' || !checkPhoneToken(phoneToken, phone.trim())) {
    return res.status(401).json({ message: 'Phone verification expired or invalid. Please request a new OTP.' })
  }

  const employee = await Employee.findOne({ phone: phone.trim() })
  // Same response whether or not an account exists for this number, so the
  // endpoint can't be used to probe which phone numbers have accounts.
  if (employee) await deleteEmployeeAccount(employee._id)

  res.json({ message: 'If an MZOBS account exists for this number, it and all associated data have been deleted.' })
})
