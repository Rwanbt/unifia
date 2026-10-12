# Final Security Review before integration into main

**Policy:** NO-GO until the exact candidate receives a verified security review, all required technical checks pass, blocking findings are resolved, and the repository owner explicitly authorizes integration. A passing ordinary CI is not sufficient.

## Candidate

- Repository: `Rwanbt/unifia`.
- Expected source: `dev`; target: `main`.
- Record the exact full `head SHA`, `base SHA`, PR URL and a timestamp.
- Review the *full cumulative diff* since main, not just the last commit.
- A new commit on either side invalidates the earlier sign-off and requires a new review.

## Required review evidence

1. Read every security-sensitive change (and changes to workflow triggers, action permissions, scripts, dependencies and lockfiles).
2. Threat-model relevant trust boundaries and misuse/abuse cases; verify regression and negative/security tests on the actual SHA.
3. Verify SAST/CodeQL where applicable, secrets scanning, dependency/advisory results, unsafe build-chain changes, artifact integrity, and the status of applicable quality gates. Do **not** mark an unavailable scan as passed.
4. For **Unifia**, explicitly consider: TypeScript/Bun unit + E2E, CodeQL, supply-chain, desktop/mobile, memory/vault, server auth/CSRF/CORS/Host, browser/tool permissions, workflow tokens, signing and release pathways.
5. Record each finding with location, severity, reproduction/evidence, mitigation and retest. Unresolved Critical/High or unverifiable required evidence means **NO-GO**.
6. Record an independently accessible, owner-reviewed report or issue **in this repository** that links the exact HEAD/BASE SHAs and all relevant checks.

## Human sign-off and GitHub gate

After the full review, with the PR no longer draft, the repository owner `Rwanbt` may comment **exactly one line** in the candidate PR:

```text
SECURITY-REVIEW-APPROVED head=<FULL_HEAD_SHA> base=<FULL_BASE_SHA> evidence=https://github.com/Rwanbt/unifia/issues/<SECURITY_REVIEW_REPORT_ISSUE_NUMBER>
```

The `promotion-security-review` workflow validates the identity of the commenter and matches both SHAs. **Posting an attestation is not a substitute for performing the review.** After posting, rerun the failed PR check (comments alone do not rerun the `pull_request` workflow). Updating a SHA invalidates prior approval. **Do not post approval if any required test or security review remains missing.**

## Enforcement that must be configured in GitHub

Before calling this gate mandatory, configure a ruleset on `main` requiring PRs, the `security-promotion` check and other necessary CI security/test checks, disallowing bypasses and direct pushes as appropriate, and requiring independent review if available. Without GitHub branch protection this workflow is advisory even if red.

Do not automatically merge, force push, tag or release during these steps. If the project uses a formal milestone approval, that authorization must also be recorded separately.
