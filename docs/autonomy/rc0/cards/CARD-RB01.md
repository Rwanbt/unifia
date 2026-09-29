# CARD RB01 — Réconciliation audits/issues/exigences et périmètres exacts (taille L)

**But :** (1) attribuer une **disposition** à chaque issue ouverte ; (2) résoudre les **périmètres de fichiers exacts** des tâches du train 1 (le v2.0 les laisse génériques) ; (3) vérifier qu'aucune exigence n'est orpheline.
**Dépend de :** RB00. **Fichiers autorisés :** `docs/autonomy/rc0/ISSUE-DISPOSITION.md`, `docs/autonomy/rc0/WRITE-SCOPES.md`, `EXECUTION-LOG.md`.
**Décision déléguée :** aucune. Les dispositions `DEFER_APPROVED` et `NOT_APPLICABLE` sont **proposées**, jamais décidées.

## Partie 1 — Issues
1. `gh issue list --repo Rwanbt/unifia --state open --limit 200 --json number,title,labels,updatedAt` (si `gh` absent : **STOP**, demande l'export au propriétaire ; ne devine pas).
2. Pour chaque issue : lis-la, cherche dans le dépôt (`git log --oneline --grep "#N"`, `docs/audit/*`, tests) les preuves de correction partielle ou totale.
3. Disposition parmi : `FIX_REQUIRED`, `PARTIALLY_SUPERSEDED`, `ALREADY_FIXED_CLOSE_WITH_EVIDENCE`, `DEFER_APPROVED`, `NOT_APPLICABLE`. Ajoute la tâche et le train (voir `ISSUE-MAP-v2.1.md`).
4. Une issue ouverte peut contenir des sous-points déjà livrés : ne jamais lire `OPEN = non implémenté`.
5. **Ne ferme, ne commente ni ne crée aucune issue.** Les tickets différés sont déjà rédigés dans `docs/audit/DEFERRED-TICKETS-NEW-UI.md`.

## Partie 2 — Périmètres exacts (train 1 uniquement)
Pour chaque tâche du train 1 : remplace les globs génériques du graphe par des chemins vérifiés (`git ls-files '<glob>'`), signale les chevauchements entre tâches (ressources sérialisées : lockfile, SDK, routeurs, autorité, workflows). Sortie : tableau `ID → fichiers exacts → conflits`.

## Partie 3 — Orphelins
Croise `docs/audit/AUDIT-NON-CONNECTE-NEW-UI-2026-09-29.md`, `AUDIT-CABLAGE-NEW-UI-2026-09-30.md`, `DEFERRED-TICKETS-NEW-UI.md` avec le graphe : toute exigence sans tâche est listée.

## Preuves / STOP
Chaque disposition cite au moins une preuve (SHA, fichier, test). **STOP** si plus de 5 issues ne peuvent pas être dispositionnées faute d'accès : rapporte la liste.
