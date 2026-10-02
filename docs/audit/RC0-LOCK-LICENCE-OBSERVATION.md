<!-- SPDX-License-Identifier: MIT -->
# RC-0 lockfile licence observation

## Frozen measurement

Observed on 2026-10-01 at docs head 05043d8d4c, with dev 84d4030c59 fetched.
Bun lock SHA-256: 93210f26ec7d00a5178f4893ef08d0d924130f3ca07b2dd8eb9ae99fb28bfea2.
The earlier sampled audit and draft notices do not qualify this distribution.

JSONC parsing enumerates every lock key, including nested installations:
3088 keys = 3030 registry + 57 workspace + 1 Git source. Installed manifest
name/version matches exist for 2768 keys; 320 are absent on this Windows host.
Absence includes platform variants and does not establish an install defect.
238 matched manifests have no root LICENSE/NOTICE file observed.

Exact public npm version metadata covers 317 additional unique identities,
all matching the lock's dist.integrity. Metadata hashes and source URLs are
retained. This verifies declared metadata, not downloaded archive contents.
Legacy licence arrays remain arrays; no AND/OR expression is invented.

The first parser incorrectly treated workspace and Git locators as npm versions.
Its HTTP 405 observations are preserved. Corrected classification separates
these sources; the summary excludes the erroneous ghostty npm request explicitly.
No package is changed by this observation.

## Unresolved declarations and reachability

Fourteen exact registry identities have no licence declaration: openauth's
snapshot, Solid Start alpha, buffers, exif-parser, opencontrol, sst and its eight
platform packages. Owned expression-runtime and Storybook manifests also lack
a declaration. Missing fields do not establish absence of licence rights.

ghostty-web declares MIT locally; the pinned Git reference resolves to
83c0a07b8628b748aed073b232cb4b52a6ca11c1. The source LICENSE Git blob is
bd8d5933fe3733723f0bc9fdd24431176848a7d4. Installed commit integrity remains unverified.

Sharp's Windows package declares Apache-2.0 AND LGPL-3.0-or-later; platform
libvips declarations include LGPL-3.0-or-later. App declares sharp as a dev
dependency, with imports in visual-diff tooling/tests. bun pm why sharp records
the wider graph. This does not prove exclusion from every shipped artifact.

## Qualification boundary

Raw inventories, metadata hashes, parser corrections and reachability output
remain in rc0-agent/.build-temp/rc0-*licence*-20261001.* and
rc0-sharp-reachability-20261001.log. These are observations, not an approved SBOM.
RB06 still needs shipped artifact closure, Cargo/Python/model/asset coverage,
notice contents and distribution obligations. QA12R and release approval remain open.
