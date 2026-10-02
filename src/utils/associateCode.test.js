import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatAssociateCode } from './associateCode.js'

describe('formatAssociateCode', () => {
  test('MZ26 plus a two-digit serial', () => {
    assert.equal(formatAssociateCode(1), 'MZ2601')
    assert.equal(formatAssociateCode(2), 'MZ2602')
    assert.equal(formatAssociateCode(10), 'MZ2610')
    assert.equal(formatAssociateCode(99), 'MZ2699')
  })

  test('keeps growing past 99', () => {
    assert.equal(formatAssociateCode(100), 'MZ26100')
  })
})
