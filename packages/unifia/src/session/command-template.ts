// SPDX-License-Identifier: MIT
import { ConfigMarkdown } from "../config/markdown"

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g
const bashRegex = /!`([^`]+)`/g

export function expand(template: string, input: string) {
  const raw = input.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
  const placeholders = template.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) last = Math.max(last, Number(item.slice(1)))
  const withArgs = template.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const offset = position - 1
    if (offset >= args.length) return ""
    if (position === last) return args.slice(offset).join(" ")
    return args[offset]
  })
  const usesArguments = template.includes("$ARGUMENTS")
  let result = withArgs.replaceAll("$ARGUMENTS", input)

  if (placeholders.length === 0 && !usesArguments && input.trim()) result += `\n\n${input}`
  return result
}

export function commands(template: string) {
  return ConfigMarkdown.shell(template)
}

export async function resolveShell(template: string, run: (command: string) => Promise<string>) {
  const matches = commands(template)
  if (matches.length === 0) return template
  const results = await Promise.all(matches.map(([, command]) => run(command)))
  let index = 0
  return template.replace(bashRegex, () => results[index++])
}
