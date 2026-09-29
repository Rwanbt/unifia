<!-- SPDX-License-Identifier: MIT -->
# Prompt à copier-coller dans la prochaine IA

```
Tu reprends, en pleine autonomie, le programme Unifia RC-0 sur le dépôt GitHub Rwanbt/unifia (fork d'OpenCode, produit Unifia Workbench). Le propriétaire est Erwan (Rwanbt). Réponds en français.

MANDAT : il ne doit rien avoir à faire tant que le plan ne touche pas `main`. Tu ouvres des PR vers `dev`, tu les fusionnes toi-même (squash) quand les 7 checks requis sont verts, y compris pour la sécurité et les workflows. Tu ne pousses JAMAIS sur `main`, ne tagues jamais, ne publies jamais, ne fais jamais de force-push sur une branche partagée, ne réactives pas les workflows containers.yml / generate.yml / nix-hashes.yml (désactivés volontairement). Les tests physiques (Android/Windows), RL03-RL07 (tests manuels, PR dev→main, tag, publication) et les secrets/identités de signature restent au propriétaire : prépare-les, ne les fais pas.

DÉMARRAGE (dans cet ordre, sans rien demander) :
1. Lis `D:\App\unifia\unifia\.worktrees\rc0-agent\docs\autonomy\rc0\HANDOFF.md` en entier, puis `EXECUTION-LOG.md` (mêmes dossier) et `DECISIONS.md`. Ils décrivent l'état exact, les décisions prises, les PR ouvertes, le reste à faire et les pièges (modèle de PR obligatoire, CI très lente, flakes Windows, hook husky SPDX, worktrees).
2. Vérifie l'état réel avant d'agir : `gh pr list --repo Rwanbt/unifia --state open`, `gh pr checks <n>`, `git fetch origin`, `git log origin/dev -5`. Les valeurs du handoff peuvent avoir vieilli.
3. Travaille dans le worktree `D:\App\unifia\unifia\.worktrees\lot` (`git fetch origin && git checkout -B agent/<id> origin/dev`). N'utilise jamais le checkout principal `D:\App\unifia\unifia` (branche main, fichiers non suivis).

PREMIÈRES ACTIONS : fusionne #138, #140, #143, #144 dès que leurs 7 checks requis sont verts (relance les jobs Windows transitoires avec `gh run rerun <run> --failed` une fois le run terminé ; résous les fils CodeQL de revue avec un commentaire si la fusion est BLOCKED alors que tout est vert). Puis suis « Reste à faire » du HANDOFF : CR01 (#77, lire CR01-DIAGNOSIS.md, mesurer avant de corriger), e2e CR04/CR10, lots QA04 restants (CODEQL-TRIAGE.md), réparer la CI de dev (Android, 2 tests Rust runtime.rs, voice-host, check-workbench-security), RB05-RB07, FX00/FX01, PW00/PW01, UI00, QA03/QA09/QA10, puis la gate QA12R et RL00-RL02.

RÈGLES DE TRAVAIL :
- Une PR = un lot cohérent, ≤ 400 lignes modifiées hors fichiers générés/lockfiles (justifie les exceptions). Maximum 3-4 PR en parallèle : chaque push lance la CI complète (unit windows ≈ 30-60 min, e2e ≈ 1 h 45).
- Corps de PR = le modèle `.github/pull_request_template.md` (toutes les sections, un type coché, les 2 cases de la checklist cochées) via `gh pr create --body-file`, sinon le bot ferme la PR en 2 h. Titre `feat|refactor|docs(scope): …` (sur dev, `fix`/`chore` gardent `needs:issue`).
- Commits `type(scope): sujet`, sans ligne d'attribution. Nouveau fichier .ts/.tsx/.rs/.md = en-tête `SPDX-License-Identifier: MIT` (hook husky).
- Cause racine avant correctif ; jamais de sed/regex sur le code source ; après 3 échecs sur le même problème, arrête-toi, écris le diagnostic et propose 2-3 pistes. Après un correctif, cherche le même motif dans tout le dépôt. Une capacité n'est « faite » que si contrat → implémentation → transport → consommateur livré → preuve de bout en bout existent ; cite les commandes et sorties comme preuves.
- Ne masque pas un échec : classe-le (préexistant, flake connu, régression) avec les logs.
- Après chaque lot : ajoute une ligne à `docs/autonomy/rc0/EXECUTION-LOG.md`, recopie-la dans `D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Unifia-RC0\EXECUTION-LOG.md`, et fais parvenir les docs sur dev par petite PR docs. En fin de session mets à jour `_memory/memory.md` du projet et `D:\Documents\Obsidian\IA_Dev_Brain\LOG.md` (format `## AAAA-MM-JJ — [Projet] — résumé` en 3-5 puces).
- Environnement Windows : TEMP et TMP vers `D:\App\unifia\unifia\.worktrees\rc0-agent\.build-temp` ; `bun turbo typecheck --concurrency=1` ; réessaie `bun install` si EBUSY ; teste depuis le dossier du paquet ; le script `test` de packages/workbench-server liste ses fichiers explicitement.

Quand tout ce qui est faisable sans le propriétaire est fusionné sur dev et que la gate QA12R est verte sur un SHA figé, écris le paquet de release (RL01, sans publier) et arrête-toi avec un rapport : ce qui est prêt, ce qui reste à Erwan (tests physiques, RL03-RL07), et les risques restants.
```
