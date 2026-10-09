<!-- SPDX-License-Identifier: MIT -->
# RC-0 provider icon build path validation

Alert496: js/http-to-file-access at packages/ui/vite.config.ts:56 on
dev9f69f9c. Reviewed current source on dev25b3f0bb. The UI Vite plugin obtains
catalog keys over HTTP and inserts each key directly into the output filename.
This is a build/dev-server path, not an end-user runtime file API.

## Measured root cause

On Windows, resolving the original expression with provider
../../../../rc0-outside produces packages/ui/rc0-outside.svg, outside
packages/ui/src/assets/icons/provider. This probe resolved strings only;
no outside file was written. An altered catalog can therefore choose a file
outside the icon directory (the .svg suffix is retained).

The pipeline now validates every provider identifier before downloading an
icon or writing a file. Identifiers are single ASCII filename segments,
starting with an alphanumeric character; dots, hyphens and underscores remain
supported. Separators, colon, control characters and Windows device names are
rejected. Every committed provider SVG basename matches the allowed grammar.
URLs encode the validated segment. Non-success HTTP responses and non-object
catalogs fail explicitly instead of producing assets.

The Vite config registers the same provider-icons-plugin from the owning
src/provider-icons module. Both configureServer and buildStart return its
Promise, so Vite observes validation/download errors. The sink remains in an
analyzed UI source module; no CodeQL path exclusion or suppression is added.

## Evidence

From packages/ui:

- bun test ./src/provider-icons.test.ts:6 pass/0 fail/29 assertions,83ms.
  Actual loopback HTTP and filesystem writes prove valid SVGs, complete
  prevalidation before any malicious-key download/write, non-object rejection,
  failed HTTP propagation and both Vite lifecycle consumers awaiting completion.
- bun test ./src:168 pass/0 fail/502 assertions,17 files,1.415s.
- bun run typecheck:exit0. Targeted Biome processes both new files,exit0.
- Importing the real vite.config reports provider consumer registered:true.
- Whole-repository motif search finds only the new owner/tests and the sprite
  consumer; no second remote provider-to-filename pipeline was found.

Log: rc0-agent/.build-temp/rc0-provider-icons-ui-tests-20261003.log.
The configured catalog endpoint and icon directory are unchanged. This does
not validate SVG content, attest the remote catalog, protect an operator-owned
repository from local symlink replacement, or qualify a full distributable
build. Exact-head CI and a fresh CodeQL inventory remain necessary; no alert
was dismissed and no security-clean/QA12R status is claimed.
