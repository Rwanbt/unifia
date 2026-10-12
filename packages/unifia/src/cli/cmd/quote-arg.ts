// SPDX-License-Identifier: MIT

// Quote one CLI argument so the command-template tokenizer (session/command-template.ts) reads it back as a
// single argument. That tokenizer has no escape syntax: a quoted token ends at the next quote of the same kind,
// so a backslash needs no escaping and a quote character can only be carried inside the other kind of quote.
// An argument containing both kinds of quote has no faithful representation and is returned unquoted.
export function quoteArg(arg: string) {
  if (!arg.includes(" ")) return arg
  if (!arg.includes('"')) return `"${arg}"`
  if (!arg.includes("'")) return `'${arg}'`
  return arg
}
