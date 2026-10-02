import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseAssociateInput } from './associateInput.js'

const valid = {
  companyName: ' Rao Placements ',
  contactName: 'A Rao',
  email: 'rao@example.com',
  phone: '98765 43210',
  city: 'Kanpur',
  cityType: 'Small city / town',
  about: 'We place freshers in sales and support roles.',
}

describe('parseAssociateInput', () => {
  test('trims and accepts a complete submission, website optional', () => {
    const { data, error } = parseAssociateInput(valid)
    assert.equal(error, undefined)
    assert.equal(data.companyName, 'Rao Placements')
    assert.equal(data.website, '')
  })

  test('rejects missing required fields', () => {
    assert.match(parseAssociateInput({ ...valid, about: '  ' }).error, /required/)
    assert.match(parseAssociateInput({}).error, /required/)
  })

  test('rejects a bad email, a short phone and an unknown city type', () => {
    assert.match(parseAssociateInput({ ...valid, email: 'nope' }).error, /email/)
    assert.match(parseAssociateInput({ ...valid, phone: '12345' }).error, /phone/)
    assert.match(parseAssociateInput({ ...valid, cityType: 'Village' }).error, /city/)
  })

  test('ignores non-string values instead of throwing', () => {
    assert.ok(parseAssociateInput({ ...valid, email: { $ne: 1 } }).error)
  })
})
