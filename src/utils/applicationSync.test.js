import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { applicationStatusForStage } from './applicationSync.js'

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
