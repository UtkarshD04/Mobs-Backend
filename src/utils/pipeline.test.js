import test from 'node:test'
import assert from 'node:assert/strict'
import { pipelineStageOf, stageFilter, requirementMatch, matchHighlights, toLpa, toNoticeDays, averageRating } from './pipeline.js'

test('New and Reviewed are both stage "shared", split by reviewedAt', () => {
  assert.equal(pipelineStageOf({ stage: 'shared', reviewedAt: null }), 'new')
  assert.equal(pipelineStageOf({ stage: 'shared', reviewedAt: new Date() }), 'reviewed')
  assert.equal(pipelineStageOf({ stage: 'interviewing' }), 'interview')
  assert.equal(pipelineStageOf({ stage: 'offered' }), 'offer')
  assert.deepEqual(stageFilter('new'), { stage: 'shared', reviewedAt: null })
  assert.equal(stageFilter('nonsense'), null)
})

test('requirementMatch reports only facts', () => {
  const job = { skills: ['React', 'Node'], experienceMin: 2, experienceMax: 5, location: 'Pune, MH', salaryMax: 1500000 }
  const m = requirementMatch({ skills: ['react', 'css'], experienceYears: 6, location: 'Pune', expectedSalary: '12 LPA' }, job)
  assert.deepEqual(m.matchedSkills, ['React'])
  assert.deepEqual(m.missingSkills, ['Node'])
  assert.equal(m.experience, 'above')
  assert.equal(m.location, true)
  assert.equal(m.salary, 'within')
  assert.equal(requirementMatch({}, null), null)
  assert.equal(matchHighlights({ skills: [], experienceYears: 3, location: '' }, { skills: [], experienceMin: 2, experienceMax: 5, location: 'X' })[0].label, 'Experience fits')
})

test('unknown salary / notice stay unknown', () => {
  assert.equal(toLpa(''), null)
  assert.equal(toLpa('₹500000'), 5)
  assert.equal(toNoticeDays(''), null)
  assert.equal(toNoticeDays('2 months'), 60)
  assert.equal(averageRating({}), null)
  assert.equal(averageRating({ a: 4, b: 5 }), 4.5)
})
