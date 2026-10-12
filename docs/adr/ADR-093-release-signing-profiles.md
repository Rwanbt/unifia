<!-- SPDX-License-Identifier: MIT -->
# ADR-093 — The Windows installer's signing profile: optional only for a dry run

Status: **Accepted** (this change). The Azure identity and its secrets are an operator step, not decided here.
Date: 2026-10-11

## Context

`release.yml` builds the desktop application for Windows. The Tauri production configuration (`tauri.prod.conf.json`) calls `script/sign-windows.ps1` for each binary. That script signs with Azure Trusted Signing when its identity is configured, and otherwise skips with a warning and exits 0.

Before this change the workflow was silent about it in two places:

- the build step had no signing identity, so every run skipped signing;
- the verification step hard-coded `UNIFIA_WINDOWS_SIGNING: optional`. Its comment said an official release sets `required`. No release did, so a tag push could publish an unsigned installer with a warning, and nothing failed.

The only Azure signing steps are in `publish.yml`, which is gated to `anomalyco/opencode` and never runs in this fork. The capability matrix already recorded that `required` was not wired into the release.

## Decision

Three profiles. Only the first may leave the installer unsigned.

| Profile | When | `UNIFIA_WINDOWS_SIGNING` | Publishes? |
|---|---|---|---|
| Non-publishing build | `dry_run` | `optional` | No: no tag, no release, no package, no image |
| Release candidate | `workflow_dispatch` with `draft` | `required` | A draft release |
| Publication | tag push, or `workflow_dispatch` without `draft` or `dry_run` | `required` | A release |

Rules:

1. The profile is the expression `inputs.dry_run && 'optional' || 'required'`. A tag push has no `inputs`, so it is `required`. There is no input that lowers it.
2. The build and the verification read the same profile. The verification must not be looser than the signing it checks.
3. Outside a dry run, the Windows job logs in to Azure before the build (`azure/login`, OIDC), so that `script/sign-windows.ps1` finds the identity. The build job asks for `id-token: write` for that; it is needed only on Windows, and it is granted to the job, not to each step.
4. A build whose signature is missing fails. It does not warn and continue.

## Consequences

- **Until the operator configures the identity**, every tag push and every non-dry-run dispatch fails at the Windows build, and no GitHub release is created. This is intended. The secrets needed are `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME` and `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE`.
- **Not gated by this ADR:** `publish-npm` and `publish-docker` depend on the CLI build, not on the Windows installer, and still run on a tag. They are a separate publication path. Whether they must wait for the same signing decision is an owner decision, and it is recorded as open.
- The build job now holds `id-token: write` for all its matrix legs (Linux too). The login runs only on Windows. Splitting the Windows leg into its own job would narrow this; it is not done here.
- Not verified here: the signing itself. There are no Azure secrets and no Windows runner with `pwsh` in this environment, so `script/sign-windows.ps1` and `verify-windows-signature.ps1` were not run against a real identity.

## Tests

`packages/unifia/test/ci/release-windows-signing.test.ts` reads `release.yml` and checks that:

- the build and the verification both use the release profile;
- no step pins the signature to `optional`;
- the Azure login is before the Windows build, and only outside a dry run;
- the build job may request the OIDC token;
- the signing endpoint, account and certificate profile reach the build.

All five fail against the previous workflow and pass with this change.
