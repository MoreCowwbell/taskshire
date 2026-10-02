/**
 * What the Resume button says. The preference decides where the click goes, so it decides the
 * word; `canOpen` only picks between "Open" (an app already holds this thread) and "Resume"
 * (we are getting back to it some other way).
 *
 * Pure and in `hud-data.js` rather than `hud.js` because that module reads `navigator.platform`
 * at import and so cannot be loaded by `node --test`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { resumeDisabled, resumeLabel } from '../src/ui/hud-data.js'

const desktop = { canOpen: true, resume: 'claude --resume abc' }
const terminal = { canOpen: false, resume: 'claude --resume abc' }
const cursor = { canOpen: false, resume: '' }

test('the editor choice always reads Resume, whatever the thread is', () => {
  for (const thread of [desktop, terminal, cursor]) {
    const got = resumeLabel('ide', thread)
    assert.equal(got.text, 'Resume')
    assert.equal(got.icon, 'open')
    assert.match(got.title, /window/i)
  }
})

test('the app choice reads Open only when an app actually has the thread', () => {
  assert.equal(resumeLabel('app', desktop).text, 'Open')
  assert.equal(resumeLabel('app', desktop).icon, 'open')
  assert.equal(resumeLabel('app', terminal).text, 'Resume')
  assert.equal(resumeLabel('app', terminal).icon, 'copy', 'no record means the clipboard, so say so')
})

test('the copy choice reads Resume with the copy icon, always', () => {
  assert.equal(resumeLabel('copy', desktop).icon, 'copy')
  assert.equal(resumeLabel('copy', desktop).text, 'Resume')
})

test('only a thread with nowhere to go is disabled, and never under the editor choice', () => {
  assert.equal(resumeDisabled('copy', cursor), true, 'nothing to copy and no app record')
  assert.equal(resumeDisabled('app', cursor), true)
  assert.equal(resumeDisabled('ide', cursor), false, 'a window can still be raised on its folder')
  assert.equal(resumeDisabled('copy', terminal), false)
  assert.equal(resumeDisabled('app', desktop), false)
})
