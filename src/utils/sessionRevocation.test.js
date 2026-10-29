import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { issuedBeforePasswordChange } from './sessionRevocation.js'

const at = (iso) => Math.floor(new Date(iso).getTime() / 1000)

describe('issuedBeforePasswordChange', () => {
  test('a token from before the password change is refused', () => {
    assert.equal(issuedBeforePasswordChange({ iat: at('2026-10-01T10:00:00Z') }, { passwordChangedAt: new Date('2026-10-02T10:00:00Z') }), true)
  })

  test('a token from after the password change is accepted', () => {
    assert.equal(issuedBeforePasswordChange({ iat: at('2026-10-03T10:00:00Z') }, { passwordChangedAt: new Date('2026-10-02T10:00:00Z') }), false)
  })

  test('a token issued in the same second as the change is accepted', () => {
    assert.equal(issuedBeforePasswordChange({ iat: at('2026-10-02T10:00:00Z') }, { passwordChangedAt: new Date('2026-10-02T10:00:00.900Z') }), false)
  })

  test('an account whose password never changed accepts every token', () => {
    assert.equal(issuedBeforePasswordChange({ iat: at('2026-10-01T10:00:00Z') }, { passwordChangedAt: null }), false)
    assert.equal(issuedBeforePasswordChange({ iat: at('2026-10-01T10:00:00Z') }, {}), false)
  })

  test('a token without iat is not refused by this check', () => {
    assert.equal(issuedBeforePasswordChange({}, { passwordChangedAt: new Date('2026-10-02T10:00:00Z') }), false)
  })
})
