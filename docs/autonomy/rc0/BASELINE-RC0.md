# BASELINE-RC0 — figée le 2026-09-29 10:54 (+02:00)

Carte RB00. Mesures faites depuis le worktree `.worktrees/rc0-agent` (`git status --porcelain` vide au départ).

| Branche | SHA (origin) | Relation à `new-ui` (`git rev-list --left-right --count new-ui...b`) |
|---|---|---|
| new-ui | 2c13b7d76d0fdbec33af3952825e6bf84e930df5 | — |
| work-design | 609f2d494064c61d6688b916644560930b72cb79 | ancêtre OK · 660 / 0 |
| dev | 95350647140a382ee6d5d61bc2f6639597d80f0b | ancêtre OK · 1457 / 0 |
| main | 207ff452b8056ae11d1f71e23198e520835f70ed | ancêtre OK · 1466 / 0 |
| voice | f3f7f03f7d167979d7a8492bdc20bb53231ace77 | divergente · 42 / 20 |

Écart avec les valeurs du 29/09 : **aucun**.
Branche par défaut (`gh api repos/Rwanbt/unifia --jq .default_branch`) : `main`.
Protection de `new-ui` : `Branch not protected` (404).
Hypothèse D8 (work-design, dev, main ⊂ new-ui) : **vérifiée**.

Note locale : le `new-ui` local du propriétaire porte 1 commit non poussé (`bdb3941`, docs d'audit) absent de cette baseline.

IMPLEMENTATION_BASELINE_SHA=2c13b7d76d0fdbec33af3952825e6bf84e930df5
