import 'dotenv/config'
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { env } from '../config/env.js'
import { hasRateLimitBypass, RATE_LIMIT_BYPASS_HEADER } from './rateLimit.js'

const KEY = 'k'.repeat(48)
const original = env.rateLimitBypassKey
const reqWith = (value) => ({ headers: value === undefined ? {} : { [RATE_LIMIT_BYPASS_HEADER]: value } })

describe('hasRateLimitBypass', () => {
  afterEach(() => {
    env.rateLimitBypassKey = original
  })

  test('the configured key skips the limit', () => {
    env.rateLimitBypassKey = KEY
    assert.equal(hasRateLimitBypass(reqWith(KEY)), true)
  })

  test('a wrong or missing key does not', () => {
    env.rateLimitBypassKey = KEY
    assert.equal(hasRateLimitBypass(reqWith('k'.repeat(47))), false)
    assert.equal(hasRateLimitBypass(reqWith(undefined)), false)
    assert.equal(hasRateLimitBypass(reqWith(['a', 'b'])), false)
  })

  test('nothing is bypassed while no key is configured', () => {
    env.rateLimitBypassKey = ''
    assert.equal(hasRateLimitBypass(reqWith('')), false)
  })

  test('a key shorter than 32 characters is ignored', () => {
    env.rateLimitBypassKey = 'short-key'
    assert.equal(hasRateLimitBypass(reqWith('short-key')), false)
  })
})
