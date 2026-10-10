/* SPDX-License-Identifier: MIT */
/**
 * The linked-issue rule of the pr-standards workflow.
 *
 * GitHub resolves closing references (`closingIssuesReferences`) only for pull requests whose base is
 * the repository's default branch. A pull request into an integration branch such as `dev` never shows
 * a closing reference, whatever its description says. For those, this rule reads the closing keywords
 * of the description and checks that each referenced issue exists in the same repository.
 *
 * Nothing here relaxes the policy: the referenced issue must exist, must be an issue and not a pull
 * request, and must belong to this repository. The exemption by title is unchanged.
 */

/** Titles whose pull requests need no linked issue (docs, refactor and feat). */
const EXEMPT_TITLE = /^(docs|refactor|feat)\s*(\([a-zA-Z0-9-]+\))?\s*:/

/** Fenced and inline code is not read: a keyword quoted in code does not link an issue. */
const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g
const INLINE_CODE = /`[^`\n]*`/g

/**
 * GitHub's closing keywords, followed by whitespace and a reference: `#123` or `owner/repo#123`.
 * Whitespace is required: `Closes#123` is not read, which keeps the rule conservative.
 */
const CLOSING_REFERENCE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[ \t]+(?:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+))?#(\d+)\b/gi

export function isExemptTitle(title) {
  return EXEMPT_TITLE.test(title)
}

/** Every closing reference of a description, in order, without the code it may quote. */
export function closingReferences(body) {
  const text = String(body ?? "").replace(FENCED_CODE, " ").replace(INLINE_CODE, " ")
  return [...text.matchAll(CLOSING_REFERENCE)].map((match) => ({
    owner: match[1] ?? null,
    repo: match[2] ?? null,
    number: Number(match[3]),
  }))
}

function refersToThisRepository(reference, repository) {
  if (reference.owner === null) return true
  return `${reference.owner}/${reference.repo}`.toLowerCase() === repository.toLowerCase()
}

/**
 * Decide whether a pull request is linked to an issue.
 *
 * - `closingIssuesCount` is GitHub's own answer, authoritative when it is positive.
 * - The description is read only when the base is not the default branch, which is the case GitHub
 *   does not resolve. For the default branch, a description keyword does not link anything.
 * - `lookupIssue(number)` returns `null` when the issue does not exist, or `{ isPullRequest }`.
 *   Any other failure propagates: a failed lookup must fail the check, not pass it silently.
 */
export async function resolveLinkedIssue({
  closingIssuesCount,
  baseRef,
  defaultBranch,
  body,
  repository,
  lookupIssue,
}) {
  if (closingIssuesCount > 0) return { linked: true, source: "github" }
  if (baseRef === defaultBranch) return { linked: false, source: "none" }

  for (const reference of closingReferences(body)) {
    if (!refersToThisRepository(reference, repository)) continue
    if (reference.number < 1) continue
    const issue = await lookupIssue(reference.number)
    if (issue !== null && !issue.isPullRequest) {
      return { linked: true, source: "description", issue: reference.number }
    }
  }
  return { linked: false, source: "none" }
}
