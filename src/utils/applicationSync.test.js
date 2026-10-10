import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { applicationStatusForStage, STATUS_UPDATE_MESSAGES } from './applicationSync.js'

describe('applicationStatusForStage', () => {
  test('maps employer pipeline stages to the candidate-facing application status', () => {
    assert.equal(applicationStatusForStage('shortlisted'), 'shortlisted')
    assert.equal(applicationStatusForStage('interviewing'), 'interview')
    assert.equal(applicationStatusForStage('hired'), 'selected')
    assert.equal(applicationStatusForStage('rejected'), 'rejected')
    assert.equal(applicationStatusForStage('shared'), 'shared')
  })

  test('leaves the application alone for stages with no candidate-facing equivalent', () => {
    assert.equal(applicationStatusForStage('offered'), null)
    assert.equal(applicationStatusForStage('nonsense'), null)
  })
})

describe('rejection message', () => {
  test('says how far it got and gives the employer\'s reason', () => {
    const msg = STATUS_UPDATE_MESSAGES.rejected('Sales Executive', { reason: 'Did not clear the technical round', after: 'interview' })
    assert.match(msg, /not selected after the interview/)
    assert.match(msg, /Reason: Did not clear the technical round/)
  })

  test('still reads fine without a reason', () => {
    assert.equal(STATUS_UPDATE_MESSAGES.rejected('Sales Executive'), 'Your application for Sales Executive was not selected this time.')
  })
})
