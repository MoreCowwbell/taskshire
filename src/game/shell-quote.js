/**
 * A folder, quoted for the terminal it will be pasted into.
 *
 * "Copy command" hands the clipboard `cd <folder>; claude`, and the folder is whatever the
 * project's directory happens to be called. Inside double quotes a shell still expands `$(…)`,
 * backticks and `$name`, so a directory named for a command would run it on paste. Single
 * quotes expand nothing in either shell, which is the whole reason to use them; what differs is
 * how a quote inside the name gets through:
 *
 *   PowerShell → the quote is doubled:          it's  →  'it''s'
 *   POSIX sh   → close, escaped quote, reopen:  it's  →  'it'\''s'
 *
 * PowerShell counts the curly and low single quotes (U+2018, U+2019, U+201A, U+201B) as single
 * quotes too, so each of those is doubled the same way. And PowerShell's `cd` reads its argument
 * as a wildcard pattern, where `[1]` or `*` would name some other folder or none, so the
 * PowerShell line uses `Set-Location -LiteralPath` instead.
 *
 * The POSIX form is for sh, bash and zsh. fish treats `\'` inside single quotes as an escape, so
 * fish is not covered.
 *
 * The page cannot see which terminal the user will open, so the folder decides: a drive letter
 * or a network `\\` or `//` prefix means Windows, and the terminal there is PowerShell; anything
 * else is a POSIX path and gets a POSIX shell. cmd.exe is not served — it has no single quotes at
 * all, and the `;` the command already relies on is not a separator there either.
 *
 * Pure and browser-free, so the node tests can pin the quoting without a page.
 */

/** A drive-letter path (`C:\`, `C:/`) or a network one (`\\server\share`, `//server/share`). */
const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/

/** Every character PowerShell reads as a single quote: the straight one and its four typographic kin. */
const PS_SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/g

/** True when the folder is shaped like a Windows path, so the paste lands in PowerShell. */
export const isWindowsPath = (folder) => WINDOWS_PATH.test(folder)

/** The folder as one single-quoted word for the shell its shape implies; nothing inside expands. */
export function quoteFolder(folder) {
  const text = String(folder)
  return isWindowsPath(text) ? `'${text.replace(PS_SINGLE_QUOTES, '$&$&')}'` : `'${text.replaceAll("'", "'\\''")}'`
}

/**
 * `<change folder>; <command>` — `;` rather than `&&`, since Windows PowerShell has no `&&`. The
 * change is `Set-Location -LiteralPath` for PowerShell, for the wildcard reason above, and `cd`
 * everywhere else.
 */
export function cdThen(folder, command) {
  const to = isWindowsPath(String(folder)) ? 'Set-Location -LiteralPath' : 'cd'
  return `${to} ${quoteFolder(folder)}; ${command}`
}
