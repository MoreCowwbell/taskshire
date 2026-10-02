/**
 * The "Copy command" line: a folder that goes to the clipboard single-quoted for the shell its
 * shape implies, so that nothing in its name can expand when the line is pasted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cdThen, isWindowsPath, quoteFolder } from '../src/game/shell-quote.js'

test('isWindowsPath: drive letters and network shares, either slash, nothing else', () => {
  assert.equal(isWindowsPath('C:\\Users\\me'), true)
  assert.equal(isWindowsPath('d:/work/repo'), true)
  assert.equal(isWindowsPath('\\\\server\\share\\repo'), true)
  assert.equal(isWindowsPath('//srv/share'), true)
  assert.equal(isWindowsPath('/home/me/repo'), false)
  assert.equal(isWindowsPath('~/repo'), false)
  assert.equal(isWindowsPath('C:repo'), false, 'a drive-relative path is not the shape we key on')
})

test('quoteFolder: PowerShell doubles an embedded quote', () => {
  assert.equal(quoteFolder("C:\\a b\\it's"), "'C:\\a b\\it''s'")
  assert.equal(quoteFolder("\\\\srv\\share\\'x'"), "'\\\\srv\\share\\''x'''")
  assert.equal(quoteFolder("//srv/share/it's"), "'//srv/share/it''s'", 'a forward-slash share is PowerShell too')
})

test('quoteFolder: PowerShell doubles each typographic single quote as well', () => {
  for (const q of ['\u2018', '\u2019', '\u201A', '\u201B']) {
    const code = `U+${q.codePointAt(0).toString(16).toUpperCase()}`
    assert.equal(quoteFolder(`C:\\a${q}b`), `'C:\\a${q}${q}b'`, code)
  }
  assert.equal(quoteFolder('/home/me/a\u2019b'), "'/home/me/a\u2019b'", 'POSIX shells give them no meaning')
})

test("quoteFolder: POSIX closes, escapes and reopens around an embedded quote", () => {
  assert.equal(quoteFolder("/home/me/it's"), "'/home/me/it'\\''s'")
  assert.equal(quoteFolder("/tmp/''"), "'/tmp/'\\'''\\'''")
})

test('quoteFolder: $(…), backticks, $vars and spaces stay inside the single quotes, verbatim', () => {
  for (const name of ['$(rm -rf ~)', '`whoami`', '$HOME', 'a b  c', '${env:PATH}', 'x; calc', 'x & y | z']) {
    const posix = quoteFolder(`/srv/${name}`)
    assert.equal(posix, `'/srv/${name}'`, 'nothing to escape without a quote in it')
    const ps = quoteFolder(`C:\\srv\\${name}`)
    assert.equal(ps, `'C:\\srv\\${name}'`)
  }
})

test('cdThen: one change of folder, a `;`, then the harness', () => {
  assert.equal(cdThen("C:\\a b\\it's", 'claude'), "Set-Location -LiteralPath 'C:\\a b\\it''s'; claude")
  assert.equal(cdThen('//srv/share/repo', 'claude'), "Set-Location -LiteralPath '//srv/share/repo'; claude")
  assert.equal(cdThen('/home/me/$(x)', 'codex'), "cd '/home/me/$(x)'; codex")
})

test('cdThen: PowerShell takes brackets in a name literally, not as a pattern', () => {
  assert.equal(cdThen('C:\\work\\repo[1]', 'claude'), "Set-Location -LiteralPath 'C:\\work\\repo[1]'; claude")
  assert.equal(cdThen('/work/repo[1]', 'claude'), "cd '/work/repo[1]'; claude")
})
