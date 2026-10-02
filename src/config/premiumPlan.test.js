import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAN_FEATURE_GROUPS, PREMIUM_SERVICES, PREMIUM_SERVICE_KEYS, FREE_APPLICATION_LIMIT, publicPlan } from './premiumPlan.js'

test('every feature row that links a service points at a real one', () => {
  for (const group of PLAN_FEATURE_GROUPS) {
    for (const f of group.features) {
      if (f.service) assert.ok(PREMIUM_SERVICE_KEYS.includes(f.service), `${f.label} -> ${f.service}`)
    }
  }
})

test('every requestable service is offered by at least one feature row', () => {
  const linked = new Set(PLAN_FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.service).filter(Boolean)))
  for (const s of PREMIUM_SERVICES) assert.ok(linked.has(s.key), s.key)
})

test('service keys are unique', () => {
  assert.equal(new Set(PREMIUM_SERVICE_KEYS).size, PREMIUM_SERVICE_KEYS.length)
})

test('the plan states the same free application cap the apply gate enforces', () => {
  const row = publicPlan().groups.flatMap((g) => g.features).find((f) => f.label === 'Job applications')
  assert.match(row.basic, new RegExp(`\\b${FREE_APPLICATION_LIMIT}\\b`))
  assert.equal(publicPlan().basic.applicationLimit, FREE_APPLICATION_LIMIT)
})
