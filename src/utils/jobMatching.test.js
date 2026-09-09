import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { scoreJobForEmployee, rankJobsForEmployee } from './jobMatching.js'

const baseJob = {
  title: 'Frontend Developer',
  skills: ['React', 'JavaScript', 'CSS'],
  location: 'Bengaluru',
  workMode: 'Hybrid',
  employmentType: 'Full-time',
  experienceMin: 1,
  experienceMax: 3,
}

describe('scoreJobForEmployee', () => {
  test('scores zero with no reasons for a completely unrelated profile', () => {
    const employee = { skills: ['Sales'], preferredRole: 'Sales Executive', preferredLocations: ['Mumbai'], experienceYears: 8 }
    const { score, reasons } = scoreJobForEmployee(employee, baseJob)
    assert.equal(score, 0)
    assert.deepEqual(reasons, [])
  })

  test('credits matched skills with a named, specific reason', () => {
    const employee = { skills: ['React', 'Node.js'] }
    const { score, reasons } = scoreJobForEmployee(employee, baseJob)
    assert.ok(score > 0)
    assert.ok(reasons[0].includes('React'))
  })

  test('credits a preferred-role word-overlap match', () => {
    const employee = { preferredRole: 'Frontend Engineer' }
    const { reasons } = scoreJobForEmployee(employee, baseJob)
    assert.ok(reasons.some((r) => r.includes('preferred role')))
  })

  test('credits a preferred-location match', () => {
    const employee = { preferredLocations: ['Bengaluru', 'Pune'] }
    const { reasons } = scoreJobForEmployee(employee, baseJob)
    assert.ok(reasons.some((r) => r.includes('Bengaluru')))
  })

  test('credits work-mode and job-type preference matches', () => {
    const employee = { workModePreference: ['Hybrid'], jobTypePreference: ['Full-time'] }
    const { reasons } = scoreJobForEmployee(employee, baseJob)
    assert.ok(reasons.some((r) => r.includes('Hybrid')))
    assert.ok(reasons.some((r) => r.includes('Full-time')))
  })

  test('credits an experience-range overlap within a half-year tolerance', () => {
    const employee = { experienceYears: 3.4 }
    const { reasons } = scoreJobForEmployee(employee, baseJob)
    assert.ok(reasons.some((r) => r.includes('experience level')))
  })

  test('never exceeds a 100 score even with every signal matching', () => {
    const employee = {
      skills: ['React', 'JavaScript', 'CSS'],
      preferredRole: 'Frontend Developer',
      preferredLocations: ['Bengaluru'],
      workModePreference: ['Hybrid'],
      jobTypePreference: ['Full-time'],
      experienceYears: 2,
      skillTrack: { key: 'tech', label: 'Engineering' },
    }
    const { score } = scoreJobForEmployee(employee, { ...baseJob, track: 'tech' })
    assert.ok(score <= 100)
  })

  test('credits a matching skill track with a named reason', () => {
    const employee = { skillTrack: { key: 'tech', label: 'Engineering' } }
    const { score, reasons } = scoreJobForEmployee(employee, { ...baseJob, track: 'tech' })
    assert.ok(score > 0)
    assert.ok(reasons.some((r) => r.includes('Engineering')))
  })

  test('falls back to a title-cased track key when the employee has no label yet', () => {
    const employee = { skillTrack: { key: 'tech', label: '' } }
    const { reasons } = scoreJobForEmployee(employee, { ...baseJob, track: 'tech' })
    assert.ok(reasons.some((r) => r.includes('Tech')))
  })

  test('does not credit a mismatched skill track', () => {
    const employee = { skillTrack: { key: 'sales', label: 'Sales' } }
    const { score, reasons } = scoreJobForEmployee(employee, { ...baseJob, track: 'tech' })
    assert.equal(score, 0)
    assert.deepEqual(reasons, [])
  })
})

describe('rankJobsForEmployee', () => {
  test('drops jobs with no matching reason instead of padding the list', () => {
    const employee = { skills: ['React'] }
    const jobs = [baseJob, { ...baseJob, title: 'Sales Executive', skills: ['Negotiation'], location: 'Delhi' }]
    const ranked = rankJobsForEmployee(employee, jobs)
    assert.equal(ranked.length, 1)
  })

  test('sorts by score descending', () => {
    const employee = { skills: ['React'], preferredLocations: ['Bengaluru'] }
    const strongMatch = baseJob
    const weakMatch = { ...baseJob, title: 'Backend Developer', location: 'Mumbai', skills: ['React', 'Java'] }
    const ranked = rankJobsForEmployee(employee, [weakMatch, strongMatch])
    assert.equal(ranked[0].job, strongMatch)
  })

  test('caps output to the given limit', () => {
    const employee = { skills: ['React'] }
    const jobs = Array.from({ length: 5 }, () => ({ ...baseJob }))
    const ranked = rankJobsForEmployee(employee, jobs, { limit: 2 })
    assert.equal(ranked.length, 2)
  })
})
