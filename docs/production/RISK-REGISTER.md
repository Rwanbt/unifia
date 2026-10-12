<!-- SPDX-License-Identifier: MIT -->
# Registre des risques

| ID | Risque | Probabilité | Impact | Atténuation actuelle | Action suivante |
|---|---|---|---|---|---|
| R-01 | Le vault reste rouge tant que les dossiers racine ne sont pas déplacés. La synchronisation quotidienne ne passe pas et les notes de l'agent ne sont pas poussées | Élevée | Moyen | Sauvegarde vérifiée (`D:\App\vault-backup-2026-10-11`, empreintes SHA-256 identiques) | Décision de l'utilisateur sur le déplacement ; le classificateur a refusé l'opération |
| R-02 | Doublon de la note Seno : original dans `Seno/`, copie frontmatée dans `projects/seno-daw/`. Les deux peuvent diverger | Moyenne | Faible | Octets d'origine identiques dans la copie (vérifié à l'écriture) | Retirer l'original après décision ; ne pas éditer les deux |
| R-03 | Le changement de convention du CLI (#464) modifie le comportement pour un workspace qui gardait des notes dans `<workspace>/memory` | Moyenne | Moyen | ADR-090 documente la rupture ; les notes ne sont pas supprimées | Message de migration ou import contrôlé (D2) |
| R-04 | Un événement de suivi CI peut désigner un run ancien. J'ai déjà traité un échec du run `448ae70dd1` comme s'il concernait le head courant | Moyenne | Faible | Vérification du head et des jobs via l'API avant d'agir | Toujours comparer `headSha` du run et `headRefOid` de la PR |
| R-05 | Les tests Windows dépendent du chemin court (`RUNNER~1`) renvoyé par `mkdtemp`, alors que le produit résout le chemin réel | Moyenne | Faible | Test corrigé dans #464 | Chercher les autres comparaisons de chemins brutes dans les tests |
| R-06 | #456 a été écrit sur une base antérieure (`dev` avant #447, #455 à #462). Une rebase va entrer en conflit avec `openWorkspace` | Élevée | Élevé | Aucune pour l'instant | Découper et rebâtir sur `dev` après #464 |
| R-07 | Orphelins Biome lancés depuis le worktree `knowledge-read`, toujours présents (5 processus). Ils ne tiennent pas `leases.db` | Faible | Faible | Non tués : ils n'ont pas été vérifiés comme nôtres au sens strict | Les arrêter après vérification, à la fin de session |
| R-08 | Affirmations de production sans preuve : la baseline compte des fichiers de test, elle n'a exécuté aucune suite | Élevée si non surveillé | Élevé | `EXECUTION-STATE.md` et `GAP-REGISTER.md` distinguent les statuts | Ne jamais déclarer `GA_READY` sans preuve au SHA |
| R-09 | Auto-merge désactivé : les fusions se font à la main, sur SHA exact. Une erreur de SHA fusionnerait un code non revu | Faible | Élevé | `gh pr merge --match-head-commit <sha>` | Toujours passer le SHA lu juste avant la fusion |
| R-10 | Dépassement de la limite de 400 lignes non expliqué (G-14) | Moyenne | Faible | Le check passe | Expliquer l'écart de comptage |
