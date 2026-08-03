# M1 — Open Cowork Provenance Detail

**Date**: 2026-08-03
**Snapshot**: `ec5bd270861fd4531bda44554766b8b5bd009242`
**Source**: `D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git`
**Status**: `REVIEW_PER_COMPONENT`

## Reproducible inventory

| Set | Exact path | Tracked paths | Decision |
|---|---|---:|---|
| Claude bundled skills | `.claude/skills/` | 138 | `REVIEW_PER_COMPONENT` |
| Main skill services | `src/main/skills/` | 5 | `ADAPT_CANDIDATE`, contract required |
| Renderer i18n | `src/renderer/i18n/` | 4 | `REVIEW`; not the unavailable user overlay |

Commands used:

```powershell
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git rev-parse HEAD
git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git ls-tree -r --name-only HEAD
```

## Licence evidence

- Root `LICENSE` is MIT, copyright OpenCoworkAI 2026.
- Nested notices exist at:
  - `.claude/skills/docx/LICENSE.txt`
  - `.claude/skills/pdf/LICENSE.txt`
  - `.claude/skills/pptx/LICENSE.txt`
  - `.claude/skills/skill-creator/LICENSE.txt`
  - `.claude/skills/xlsx/LICENSE.txt`
- The root MIT notice is not sufficient to approve every bundled skill; each
  component must retain its notice and receive a provenance record.

## Behavioral boundary

`src/main/skills/plugin-runtime-service.ts` installs marketplace plugins,
copies source directories, persists a registry and materializes runtime content.
This is executable materialization, not a passive catalogue. It cannot be
adopted into Unifia without CapabilityRegistry, PolicyEngine, digest and licence
checks.

`src/renderer/i18n/` contains only `README.md`, `config.ts`, `locales/en.json`
and `locales/zh.json` in this snapshot. The external user-overlay source named
by the plan is unavailable, therefore that overlay remains
`BLOCKED_MISSING_SOURCE`.

## Gate

No Open Cowork file was imported. The evidence is sufficient to keep the
component-level review moving, but not sufficient for blanket adoption.