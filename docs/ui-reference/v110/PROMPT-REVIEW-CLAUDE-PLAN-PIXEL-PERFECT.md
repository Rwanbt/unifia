<!-- SPDX-License-Identifier: MIT -->

# PROMPT — Review indépendante par Claude du plan pixel-perfect v110

> À utiliser dans `claude` (Claude Code) lancé **dans le worktree** :
> `cd D:\App\unifia\_a7-automate-memory` puis `claude`, et coller le prompt ci-dessous.
> Sortie attendue : collée en commentaire de l'issue **#116**.

---

```
Tu es un reviewer indépendant. Tu ne valides pas un plan écrit par une autre IA :
tu le CHALLENGES, tu vérifies ses faits, tu cherches ce qui le ferait échouer.
Lecture seule stricte : tu ne modifies AUCUN fichier, tu n'implémentes rien.

## Contexte

- Repo : Rwanbt/unifia, worktree `D:\App\unifia\_a7-automate-memory`, branche `new-ui`
  (base `work-design`, portée par la PR #115 déjà fusionnée).
- Objectif du plan : portage VISUEL **pixel-perfect** de la maquette v110 dans l'app.
- La maquette est l'AUTORITÉ D'APPARENCE, gelée le 2026-09-10, jamais modifiable.
- L'app actuelle est jugée, par le propriétaire, SANS similitude visuelle avec la maquette
  sur l'accueil — le plan part de ce constat.

## Documents à lire (tout est dans le repo)

1. `docs/ui-reference/v110/PLAN-PIXEL-PERFECT-PORT-2026-09-17.md`  ← le plan à reviewer
2. `docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html`  ← la maquette (2,4 Mo :
   cible les sections par `id`/classes, ne la lis pas linéairement)
3. `docs/ui-reference/v110/RESPONSIVE-MATRIX.md`, `INTERACTIONS.md`, `VISUAL-GATES.md`
4. ADR : `docs/adr/ADR-038-*`, `docs/adr/ADR-039-*`, ADR-1033 (cherche-le : `grep -ri "1033" docs/adr`)
5. Code concerné : `packages/app/src/{styles,shell,pages,tokens}`, `packages/ui/src/components`,
   `packages/app/e2e/v110/` (fixtures, harnais existants)

## Mission

### A. Vérification des faits du plan (obligatoire, avec commandes et résultats)
Le plan affirme notamment (vérifie ou réfute, cite fichier:ligne ou commande) :
1. 0 occurrence dans `packages/app/src` de : « Commencer avec », « Aucun projet ouvert »,
   `home-mode-pill`, et le placeholder d'accueil de la maquette.
2. `packages/ui/src/assets/fonts/` est vide (donc Inter non packagée).
3. Les tokens `:root` cités au §2 du plan existent EXACTEMENT dans la maquette (compare valeur par valeur).
4. Les ancrages maquette cités au §13 existent (`.rail-btn`, `.rail-btn .label{display:none}`,
   `.home-mode-pill`, `#view-*` ×8, `--topbar/--rail/--context/--inspector`).
5. ADR-1033 contredit bien le rail 6 modes de la maquette (résume la contradiction exacte).
6. `v110.css` actuel ne règle QUE du chrome (bordures/fonds/hover/focus), pas de la composition.

### B. Review du plan selon la grille §8 (4 volets, verdicts séparés)
- **Design** : la méthode garantit-elle réellement le pixel-perfect ? Manque-t-il des états
  de la maquette (present, overlays, modales, settings, light/dark) ? Les exceptions §1 sont-elles
  légitimes ou complaisantes ?
- **Eng** : architecture en couches, source unique des tokens, impact sur ADR-039 (le runtime
  Design ne doit pas régresser), budget perf, découpage ≤ 400 LOC réaliste ?
- **QA** : le harnais S0 est-il déterministe et falsifiable ? Les seuils sont-ils atteignables
  (polices, DPR, scrollbars) ? La CI bloquante arrive-t-elle au bon moment ?
- **DX** : les slices S0-S14 sont-elles VRAIMENT autonomes (contexte suffisant, ancrages précis,
  critères de sortie binaires) ? Un worker sans contexte historique peut-il exécuter S3 ou S7
  sans poser de question ?

### C. Attaque adversariale (au moins 5 scénarios d'échec)
Exemples à creuser (trouve-en d'autres) : polices non identiques malgré S1 ; maquette non
déterministe malgré le freeze ; données réelles ≠ fixtures ; 17 locales de copy ;
maquette 2,4 Mo (temps de capture, mémoire) ; Automate/Browser sans runtime (« pas de fake »
vs « écran visible ») ; diff jamais réductible sans casser des tests ; D1/D2 non tranchées.
Pour chaque scénario : probabilité, impact, et ce que le plan devrait ajouter.

### D. Verdict et corrections
- Verdict : `GO` / `NO-GO` / `GO sous conditions`.
- Liste numérotée de corrections, chacune rattachée à une section du plan (`§5 S3`, `§1`, …).
- Risques classés P0/P1/P2.
- 3 questions fermées maximum au propriétaire (uniquement les décisions qu'un reviewer ne peut pas trancher).

## Contraintes de sortie
- Français, structuré A/B/C/D, prêt à coller en commentaire de l'issue #116.
- Chaque constat cite `fichier:ligne` ou la commande exécutée. Si une info n'est pas
  vérifiable, écris « non vérifiable » — n'invente rien.
- Pas de reformulation du plan sans justification ; pas de recommandations génériques.
```

---

## Rappel d'usage

- Si `claude` n'est pas disponible localement, le même prompt marche avec Codex/Gemini :
  seuls changent le nom du reviewer et, éventuellement, la grille prioritaire.
- Deux reviews indépendantes `GO` sans condition bloquante ⇒ le plan est adopté (§8 du plan) ;
  les conditions sont intégrées au §10 du plan puis re-review des deltas uniquement.
