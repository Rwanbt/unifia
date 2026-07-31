# UPSTREAM-PROVENANCE — Provenance upstream pour Unifia

**Phase :** -2 (Audit licences et provenance)
**Statut :** `DRAFT` — à enrichir en Phase -1
**Date :** 2026-07-31

Ce fichier documente la **chaîne de provenance** de chaque portion de code intégrée dans Unifia. Le plan V3 §8.6 « Provenance obligatoire » exige ces 6 informations minimales pour tout import :

1. Dépôt source
2. Commit source
3. Chemin source
4. Licence
5. Copyright
6. Modifications + responsable

## 1. Provenance du fork Unifia/OpenCode (parent direct)

| Champ | Valeur |
|---|---|
| Dépôt source | `https://github.com/Rwanbt/opencode.git` |
| Commit source (baseline) | `207ff452b8056ae11d1f71e23198e520835f70ed` |
| Branche | `main` (la branche `Dev` n'a pas été fetchée en --depth 1) |
| Chemin source | ensemble du dépôt (fork complet) |
| Licence | MIT |
| Copyright | (c) 2025 opencode (upstream), (c) 2025-2026 Rwanbt contributors (fork) |
| Modifications Unifia | (à démarrer Phase 0) |
| Responsable import | (utilisateur) |

## 2. Provenance upstream d'OpenCode (grand-parent)

| Champ | Valeur |
|---|---|
| Dépôt source | `https://github.com/anomalyco/opencode.git` |
| Commit source (HEAD upstream) | (à vérifier — `git log origin/main` une fois la remotes configurée) |
| Branche | `main` |
| Licence | MIT |
| Copyright | (c) 2025 opencode (équipe anomalyco) |
| Statut dans Unifia | ancêtre ; à tracker via upstream-sync/opencode (Plan V3 §12) |

## 3. Provenance OpenWork (cible Phase -1)

| Champ | Valeur | Statut |
|---|---|---|
| Dépôt probable | `https://github.com/different-ai/openwork` | `CANDIDATE` (19k stars, "powered by opencode", conforme au plan V3 §3.1) |
| Alternatives | `WILSCH-AI-SERVICES/openwork`, `ehsky/openwork`, `iRaez/openwork` | à disqualifier (clones vides) |
| Commit | (à cloner pour audit Phase -1) | `BLOCKED_BD-8` |
| Licence probable | (à vérifier) | `BLOCKED_BD-8` |
| Présence `/ee` | (à vérifier explicitement) | `BLOCKED_BD-8` |
| Note | OpenWork a une couche « Den /ee » propriétaire selon Plan V3 §3.1 ; à exclure par défaut | |

## 4. Provenance Open Cowork (cible Phase -1)

| Champ | Valeur | Statut |
|---|---|---|
| Dépôt candidat A | `https://github.com/eigent-ai/eigent` | `CANDIDATE` (14.7k stars, Apache-2.0, plus gros) |
| Dépôt candidat B | `https://github.com/OpenCoworkAI/open-cowork` | `CANDIDATE` (1.9k stars, MIT, mentionne explicitement Skills + MCP + sandbox) |
| Dépôt candidat C | `https://github.com/AIDotNet/OpenCowork` | `CANDIDATE` (589 stars, Apache-2.0) |
| Commit | (à cloner pour audit Phase -1) | `BLOCKED_BD-8` |
| Licence probable | Apache-2.0 ou MIT | (à confirmer) |
| Note | Le Plan V3 §3.2 attend Skills PPTX/DOCX/XLSX/PDF, sandbox WSL2/Lima, computer use, Slack/Feishu. OpenCoworkAI/open-cowork matche le mieux sur Skills+Feishu/Slack. | |

## 5. Modèle d'en-tête d'attribution (à appliquer en Phase 0)

Pour chaque nouveau fichier importé ou créé dans Unifia :

```ts
// Copyright (c) 2026 Unifia contributors
// Derived from <upstream-repo>@<commit-sha>
// Original path: <upstream-path>
// Original license: <SPDX-id>
// Original copyright: <copyright-holder>
// Modifications: <description des changements>
// SPDX-License-Identifier: <SPDX-id>
```

Pour les fichiers Markdown (docs) :

```md
<!--
Copyright (c) 2026 Unifia contributors
Derived from <upstream-repo>@<commit-sha>
Original path: <upstream-path>
Original license: <SPDX-id>
Original copyright: <copyright-holder>
Modifications: <description>
-->
```

Pour les fichiers Rust :

```rust
// Copyright (c) 2026 Unifia contributors
// Derived from <upstream-repo>@<commit-sha>
// Original path: <upstream-path>
// Original license: <SPDX-id>
// Original copyright: <copyright-holder>
// Modifications: <description>
// SPDX-License-Identifier: <SPDX-id>
```

## 6. Procédure d'import (à appliquer dès Phase 0)

1. **Identifier** la source (URL + commit + chemin).
2. **Vérifier la licence** : compatible MIT ? copyleft ? propriétaire ?
3. **Si copyleft ou propriétaire** → bloquer, escalader à l'utilisateur.
4. **Si MIT/Apache/BSD** → continuer.
5. **Extraire** le minimum nécessaire (un fichier ou un sous-ensemble, JAMAIS un repo entier).
6. **Ajouter l'en-tête d'attribution** (modèle §5).
7. **Commit séparé** avec message :
   ```
   import(<chemin-unifia>): from <upstream-repo>@<commit-sha>
   
   Source: <upstream-path>
   License: <SPDX-id>
   Copyright: <copyright-holder>
   Modifications: <description>
   
   Unifia-Card: <CARD-ID>
   Upstream-Repo: <url>
   Upstream-Commit: <sha>
   Upstream-Path: <path>
   Upstream-License: <SPDX-id>
   ```
8. **Mettre à jour ce fichier** (UPSTREAM-PROVENANCE.md) avec la nouvelle entrée.

## 7. Verrous de sécurité

- Hook pre-commit qui refuse tout fichier sans en-tête SPDX dans `packages/` (Phase 0).
- Scanner CI qui vérifie qu'aucun chemin `**/ee/**` n'est présent (Phase 1).
- `cargo deny` et `npm sbom` en CI (Phase 1).
- `UPSTREAM-SOURCES.lock.json` versionné, mis à jour à chaque import (Phase 0/1).

## 8. Conclusion

La chaîne de provenance est en place pour le fork opencode. OpenWork et Open Cowork restent à auditer (Phase -1, bloquée par BD-8 = URLs manquantes). Le modèle d'en-tête d'attribution et la procédure d'import sont définis et prêts à être appliqués dès la Phase 0.
