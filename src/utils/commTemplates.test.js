import test from 'node:test'
import assert from 'node:assert/strict'
import { render, unfilledPlaceholders, DEFAULT_TEMPLATES, TEMPLATE_KEYS, TEMPLATE_VARIABLES } from './commTemplates.js'

test('render fills known values and leaves missing ones visible', () => {
  assert.equal(render('Hi {{candidate_name}}, {{interview_date}}', { candidate_name: 'Asha' }), 'Hi Asha, {{interview_date}}')
  assert.deepEqual(unfilledPlaceholders('Hi {{candidate_name}} {{ job_title }} {{candidate_name}}'), ['candidate_name', 'job_title'])
})

test('values are inserted as text, never re-interpreted', () => {
  assert.equal(render('Hi {{candidate_name}}', { candidate_name: '{{job_title}}' }), 'Hi {{job_title}}')
})

test('all six built-in templates exist and only use known placeholders', () => {
  assert.equal(TEMPLATE_KEYS.length, 6)
  for (const key of TEMPLATE_KEYS) {
    const t = DEFAULT_TEMPLATES[key]
    assert.ok(t.label && t.subject && t.body, key)
    for (const p of unfilledPlaceholders(`${t.subject}\n${t.body}`)) assert.ok(TEMPLATE_VARIABLES.includes(p), `${key}: ${p}`)
  }
})
