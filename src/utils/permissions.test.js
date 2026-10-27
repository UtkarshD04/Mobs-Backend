import test from 'node:test'
import assert from 'node:assert/strict'
import { can, ROLES, PERMISSIONS, ROLE_PERMISSIONS, permissionsFor } from './permissions.js'

test('every role in the matrix only grants permissions that exist', () => {
  for (const [role, list] of Object.entries(ROLE_PERMISSIONS)) {
    for (const p of list) assert.ok(Object.hasOwn(PERMISSIONS, p), `${role} has unknown permission ${p}`)
  }
})

test('Owner and Admin can do everything; Hiring Manager is a Recruiter', () => {
  for (const p of Object.keys(PERMISSIONS)) {
    assert.ok(can('Owner', p))
    assert.ok(can('Admin', p))
  }
  assert.deepEqual(permissionsFor('Hiring Manager'), permissionsFor('Recruiter'))
})

test('sensitive permissions stay with the right roles', () => {
  assert.equal(can('Recruiter', 'billing.manage'), false)
  assert.equal(can('Recruiter', 'team.manage'), false)
  assert.equal(can('Recruiter', 'audit.view'), false)
  assert.equal(can('Recruiter', 'cv.unlock'), true)
  assert.equal(can('Interviewer', 'cv.unlock'), false)
  assert.equal(can('Interviewer', 'candidates.view'), false)
  assert.equal(can('Interviewer', 'candidates.viewAssigned'), true)
  assert.equal(can('Interviewer', 'interviews.feedback'), true)
  assert.equal(can('Finance', 'billing.manage'), true)
  assert.equal(can('Finance', 'candidates.view'), false)
  assert.equal(can('Finance', 'jobs.publish'), false)
})

test('unknown roles get nothing', () => {
  assert.equal(can('Intern', 'candidates.view'), false)
  assert.deepEqual(permissionsFor(undefined), [])
  assert.equal(ROLES.length, 5)
})
