# Migration du dossier v1.5 vers le rebaseline v2.0

Le dossier v1.5 reste une **archive normative/historique**. Le v2.0 ne réécrit pas ses huit sources consolidées ; il remplace l'ordre d'exécution et les statuts à partir du dépôt réel observé le 29 septembre 2026.

| Lots v1.5 | Nouvelle lecture | Action v2.0 |
|---|---|---|
| GP-00..04 | Ancienne baseline devenue obsolète après 725 commits supplémentaires | RB00..RB07 |
| GP-10..18 | Fondations normatives toujours valides, mais leur présence en code ne vaut pas câblage produit | RB04 + PW00..PW11 + QA12 |
| GP-20..28 | Portage fonctionnel très avancé ; restent parité mesurée, Code/Browser/i18n et fonctions SOON | CR08/CR09 + UI00..UI15 + FX00..FX11 |
| GP-30..35 | Design canonique largement livré (ADR-039, canvas natif, persistence workspace) | principalement UI08/UI15 + CR09, pas de reconstruction du canvas |
| GP-40..47 | Memory UI avancée mais governance package non livrée et rename wikilinks ouvert | CR07 + PW04 + UI10 |
| GP-50..57 | Automate Studio réel, workflow runtime injecté, mais autorité/run/graph non-linéaire et Work/Team restent incomplets | CR03..CR06 + FX01..FX04 |
| GP-60..66 | Nombreux moteurs Control Plane encore non atteints par les roots livrés | PW01/PW02/PW07/PW10 puis requalification |
| GP-70..78 | Inference/local model a évolué ; doit être requalifié par consommation réelle, Settings et Voice | FX07 + PW09 + VO00..VO05 |
| GP-79..89 | Voice a fortement avancé sur branche dédiée ; Browser/multimodal/remote restent hétérogènes | BR00..BR10 + VO00..VO05 + PW08..PW10 |
| GP-90..95 | Gates de release v1.5 invalidées par la divergence actuelle des branches | QA12 + RL00..RL08 |
