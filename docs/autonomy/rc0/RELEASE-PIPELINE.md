<!-- SPDX-License-Identifier: MIT -->
# RELEASE-PIPELINE — audit du pipeline de release (carte QA14, 2026-09-29)

## Qualification update — 2026-10-03

Historical findings below describe the September29 source. #216 has since
added `!inputs.draft` to publish-npm and publish-docker. Their old draft
publication finding is closed at source level; no workflow was dispatched.
Draft still builds/signs the APK and invokes action-gh-release with tag_name
and contents:write. It can create a release/tag, so the old dispatch command
in section3 is NOT an authorized artifact-only dry run. See RELEASE-PREP.md.
The three disabled workflows remain disabled; no reactivation is requested.

Analyse seulement : aucun workflow modifié ni lancé, aucune valeur de secret lue (noms seuls via `gh secret list`).

## 1. Aucun push sur `dev` ne peut publier ici
`publish.yml` (déclenché sur `ci`, `dev`, `beta`, `snapshot-*`) : `version` (l.36), `build-cli` (l.73) et `sign-cli-windows` (l.122) sont gardés par `github.repository == 'anomalyco/opencode'` → sautés sur `Rwanbt/unifia`. `build-tauri` (l.218), `build-electron` (l.395) et `publish` (l.560) ont `needs: version`/`build-cli` sans `if: always()` → sautés en cascade. **Conclusion : un push sur `dev` n'exécute aucun job de publication.** (Preuve : run `release` du push de P0 = `skipped`.) Le chemin `beta` (l.63 `anomalyco/opencode-beta`, l.365 `unifia-beta`) est mort ici mais hérité de l'amont : à supprimer sur décision du propriétaire (tranche 2, non faite).
Autres références amont : `close-issues.yml:11` (gardé), `stats.yml:12`, `ci-model-intelligence.yml:87` (lecture de licence `models.dev`), `release.yml:188` (commentaire), `unifia.yml:29` (commentaire). Aucune référence à `opencode-beta`/`unifia-beta`/`unifia.ai` exécutable dans `scripts/`.

## 2. Parcours de release direct
| # | Étape | Qui | Workflow / preuve |
|---|---|---|---|
| 1 | `dev` prêt, gate `QA12R` sur SHA immuable | agent | rapport QA12R |
| 2 | tests manuels + physiques | propriétaire | checklist RL00 |
| 3 | PR `dev` → `main` (1 approbation requise, 7 checks requis, historique linéaire) | propriétaire | GitHub |
| 4 | tag `vX.Y.Z` | propriétaire | déclenche `release.yml` (tags `v*`) |
| 5 | build CLI/desktop, SBOM (`sbom.yml`), signature (`release-sign.yml`, OIDC sans secret), provenance (`slsa.yml`) | automatique | artefacts + attestations |
| 6 | smoke installation propre Windows/Linux/Android | propriétaire (RL05) | |
| 7 | publication | propriétaire (RL07) | |

⚠ `release.yml` contient aussi, sur tag : **publication npm** (`publish-to-npm`, l.~132–166, `NPM_TOKEN`) et **image Docker vers `ghcr.io/rwanbt/unifia`** (`publish-docker`, l.~168+). Ce sont des effets de bord de release à accepter explicitement.

## 3. Essai à blanc (QA09)
`release.yml` accepte `workflow_dispatch` avec `tag` et `draft=true`. Procédure : `gh workflow run release.yml --ref <SHA-dev> -f tag=vX.Y.Z-rc.N -f draft=true`. **Non lancé** : les jobs npm/docker s'exécuteraient quand même (leurs gardes sont sur le dépôt, pas sur `draft`) → à traiter en tranche 2 (ajouter `if: !inputs.draft` aux jobs de publication) avant tout essai.

## 4. Secrets (noms uniquement)
Présents : `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `UNIFIA_ANDROID_KEYSTORE_B64`, `UNIFIA_ANDROID_KEYSTORE_PASSWORD`, `UNIFIA_ANDROID_KEY_ALIAS`, `UNIFIA_ANDROID_KEY_PASSWORD`, `GEMINI_API_KEY`.
Manquants pour le pipeline lu : `NPM_TOKEN` (job npm échouerait), secrets Azure Trusted Signing (Windows non signé côté `release.yml` ; utilisés seulement par `publish.yml` amont), certificats Apple (hors périmètre Windows/Linux/Android).

## 5. Questions au propriétaire (décisions non prises par l'agent)
1. Numéro de la première release (`VERSION` = 1.3.15) — O2.
2. `containers.yml`, `generate.yml`, `nix-hashes.yml` : laissés **désactivés** depuis P0 (O5). Les réactiver ?
3. Supprimer le chemin `beta` de `publish.yml` et `beta.yml` ? (tranche 2, workflow)
4. Publier sur npm et ghcr à chaque release (`NPM_TOKEN` absent) ou retirer ces jobs ?
5. Signature Windows : aucune identité configurée pour `release.yml`.
