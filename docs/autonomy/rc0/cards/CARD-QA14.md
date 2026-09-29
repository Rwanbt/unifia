# CARD QA14 — Audit du pipeline de release (sans bêta, sans publication)

**But :** s'assurer que les releases **directes** (tag `vX.Y.Z` sur `main`, posé par le propriétaire) passent par `release.yml` sans jamais toucher aux cibles amont, et documenter les effets de bord des pushes sur `dev`. Cette carte produit une **analyse et un plan** ; toute modification de workflow est une seconde tranche validée par le propriétaire.
**Dépend de :** RB03 et P0. **Fichiers autorisés (analyse) :** `docs/autonomy/rc0/RELEASE-PIPELINE.md` (nouveau), `EXECUTION-LOG.md`. **Fichiers de la tranche 2 (après feu vert) :** `.github/workflows/release.yml`, `.github/workflows/publish.yml`, `.github/workflows/containers.yml`. Les workflows de release sont une **ressource sérialisée**.

## Faits vérifiés dans le dépôt
- `.github/workflows/release.yml` : pipeline de release Unifia, déclenché par tags `v*` ou `workflow_dispatch` (entrées `tag`, `draft`) ; `UNIFIA_CHANNEL: latest`. Il n'y a **pas de canal beta et il n'y en aura pas**.
- `.github/workflows/beta.yml` : synchronise des PR étiquetées `beta` avec `script/beta.ts` ; planificateur désactivé ; ne publie rien.
- `.github/workflows/publish.yml` : déclenché par push sur `ci`, `dev`, `beta`, `snapshot-*` ; le job `version` est gardé par `github.repository == 'anomalyco/opencode'` ; pour la branche `beta` il vise `GH_REPO: anomalyco/opencode-beta` et `repo: unifia-beta`. **Hérité de l'amont : ne jamais l'exécuter.**
- `.github/workflows/containers.yml` : sur push vers `dev` (si `packages/containers/**` ou `package.json` changent) construit et **pousse des images** vers `ghcr.io/<propriétaire>`.
- `.github/workflows/generate.yml` : à chaque push sur `dev`, pousse un commit bot.
- Workflows de sécurité de release présents : `release-sign.yml`, `sbom.yml`, `slsa.yml`.

## Étapes (analyse)
1. Lis **en entier** `release.yml`, `release-sign.yml`, `sbom.yml`, `slsa.yml`, `publish.yml`, `containers.yml` et les actions `.github/actions/*` utilisées. Cite les lignes.
2. Recense tout ce qui référence `anomalyco`, `opencode-beta`, `unifia-beta`, `unifia.ai` ou une organisation/dépôt non maîtrisé : `grep -rn "anomalyco\|opencode-beta\|unifia-beta\|unifia\.ai" .github scripts packages/desktop packages/mobile packages/desktop-electron`.
3. Pour `publish.yml` : liste chaque job, son `needs` et son `if`. Conclus (avec preuve) si un push sur `dev` peut exécuter un job de publication ici. Propose : désactiver ou supprimer le chemin, sur décision du propriétaire.
4. Décris dans `RELEASE-PIPELINE.md` le **parcours de release direct** : `dev` prêt → tests manuels → PR `dev` → `main` (propriétaire) → tag `vX.Y.Z` (propriétaire) → `release.yml` construit desktop Windows/Linux et Android signé, sommes SHA-256, SBOM, provenance SLSA → smoke sur installation propre (Windows/Linux/Android) → publication. Pour chaque étape : qui, quel workflow, quelle preuve.
5. **Essai à blanc** (critère QA09) : décris comment déclencher `release.yml` en mode brouillon sur le SHA candidat sans publier ; **ne le lance pas** sans feu vert.
6. Liste les **secrets et identités** nécessaires (signature Android, signature Windows, jetons) **sans jamais lire ni afficher leurs valeurs** ; note ceux qui manquent.
7. Questions au propriétaire : numéro de la première release (`VERSION` = `1.3.15`), acceptation des effets de bord de `containers.yml` et `generate.yml`, sort du chemin `beta` de `publish.yml`.

## STOP
Toute action de publication, de tag, de signature ou de changement de secret. Toute exécution d'un workflow de publication. Si `release.yml` référence un secret ou un dépôt introuvable : rapporte, ne remplace pas.
