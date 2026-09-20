import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingProfileFields } from './employeeProfileController.js'

const complete = {
  name: 'Asha Rao',
  phone: '9876543210',
  dob: '2000-05-05',
  gender: 'Female',
  currentCity: 'Lucknow',
  state: 'Uttar Pradesh',
  pincode: '226001',
  experience: 'fresher',
  education: [{ degree: 'B.Com', institute: 'LU', year: '2022' }],
  skills: ['SQL'],
  preferredRole: 'Analyst',
  preferredLocations: ['Lucknow'],
  resumeHeadline: 'Aspiring analyst',
}

test('a fully filled fresher profile has nothing missing', () => {
  assert.deepEqual(missingProfileFields(complete), [])
})

test('an empty profile lists every required field', () => {
  const missing = missingProfileFields({ name: 'A', phone: '' })
  assert.ok(missing.includes('date of birth'))
  assert.ok(missing.includes('pincode'))
  assert.ok(missing.includes('at least one skill'))
})

test('experienced candidates also need company, designation and experience', () => {
  const missing = missingProfileFields({ ...complete, experience: 'experienced' })
  assert.deepEqual(missing, ['current company', 'designation', 'total experience'])
  assert.deepEqual(missingProfileFields({ ...complete, experience: 'experienced', currentCompany: 'TCS', designation: 'BA', experienceYears: 2.5 }), [])
})

test('a malformed pincode or mobile number is rejected', () => {
  assert.deepEqual(missingProfileFields({ ...complete, pincode: '12345' }), ['pincode'])
  assert.deepEqual(missingProfileFields({ ...complete, phone: '12345' }), ['mobile number'])
})
