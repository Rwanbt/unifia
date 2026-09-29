<!-- SPDX-License-Identifier: MIT -->

# Synthèse contradictoire des reviews multi-IA — PLAN R6

Date : 2026-09-17
Décision : **R6 corrigé en R7 ; R7 devient le candidat documentaire final avant exécution A–D.**

## 1. Portée et niveau de preuve

Le lot reçu contient des reviews Claude, DeepSeek, Mistral, MiniMax, Qwen et ChatGPT.
Claude, DeepSeek, Mistral, MiniMax et Qwen sont `DOCUMENT-ONLY`. ChatGPT a interrogé le
dépôt et GitHub en lecture seule, mais n'a pas exécuté les gates inexistants. Aucun rapport
n'autorise donc une implémentation ou une promotion.

Cette synthèse compare chaque objection à R6, puis aux faits reproductibles du checkout :

- repo : `D:/App/unifia/_a7-automate-memory` ;
- branche/HEAD observés : `new-ui` / `8cc914c0ea575ae675d4067e27754b86f4e9171b` ;
- `origin/new-ui` au même SHA lors du contrôle ;
- `origin/work-design` observé à `609f2d494064c61d6688b916644560930b72cb79` ;
- issue #116 ouverte, mais son corps n'est pas encore l'autorité R7 ;
- `new-ui` et `work-design` rapportées `protected:false` par l'API GitHub lors du contrôle ;
- dirty state utilisateur préexistant conservé, sans édition par ce travail.

Le dépôt contient 2 763 fichiers source suivis pour 73 896 017 octets, soit environ
18,5 millions de tokens selon l'heuristique `/4`. Il s'agit d'une review ciblée du contrat,
pas d'un audit exhaustif du produit.

## 2. Findings acceptés et correction R7

| Finding consolidé | Décision | Correction normative dans R7 |
|---|---|---|
| animation continue sans état terminal | accepté P0 | `motion-policy.json` classe `none|finite|continuous`; une animation continue est comparée à phase déterministe et doit fermer son cycle |
| mesure motion trop tardive en S14 | accepté P0 | sampler minimal en S1 ; S14 étend la matrice et couvre reduced-motion/trajectoires complexes |
| deadlock G0 pendant le bootstrap | accepté P0 | quatre modes imposés : bootstrap, pilot, tool-change, full ; seuls pilot/full qualifient selon la phase |
| QF0 avant S2 alors que S2 change tokens/fontes | accepté P0 | DAG normatif `S0 -> S1 -> S2 -> QF0 -> S3` |
| handlers sans oracle exécutable | accepté P0 | inventaire hybride : TypeScript Compiler API pour handlers JSX/TSX et trace runtime installée avant code applicatif |
| P0b auto-signe son enveloppe A/A | accepté P1 | P0a produit deux générations propres et l'étude A/A en CI ; P0b lock-only ne fait que verrouiller le run/hash antérieur |
| rang contradictoire de P1 | accepté P1 | P1 est la quatrième PR PF0/P0a/P0b/P1 et la première PR visuelle ; `prsBeforeFirstVisibleChange=3` |
| contenu des locks devenu implicite | accepté P1 | liste exhaustive plan/ADR/référence, schemas, policies, catalogues, scripts/image, mutations et A/A |
| planCommit confondu avec commit outils | accepté P1 | plan lu à `planCommit`; schemas/rules/outils lus au `pilotToolchainCommit` ou `qualificationToolchainCommit` actif |
| manifests de surface après QF0 ambigus | accepté P1 | fragments restent mutables, schema verrouillé ; hash exact enregistré dans chaque `parity-run.json` |
| MotionCase incomplet | accepté P1 | clé complète scène × viewport × thème × état × DPR × locale × motion × timeline |
| identité byte-for-byte impossible avec métadonnées | accepté P1 | `canonical-proof.json` normalise timestamps, run IDs et paths ; identité exigée sur la preuve canonique |
| nœud a11y app-only sans disposition | accepté P1 | disposition dédiée avec owner/preuve ; skip link atteignable accepté, focusable décoratif rejeté |
| pilote et qualification produits par runners différents | accepté P1 | commits outils exacts, relecture par `git show`, replay full à S3 et delta commun des locks explicite |
| promotion possible avec `notRun` | accepté P0 | résultats pass/notRun/fail par surface, anchorKind et global ; fermeture/promotion exige `notRun=0` |
| MotionCase alias de StaticCase | accepté P0 | échantillon intermédiaire obligatoirement distinct ; sinon `motionAliasToStatic > 0` |
| fontes seulement déclarées, non résolues | accepté P1 | `fc-list` dans l'image et fontSet de toutes les fontes effectivement résolues, avec hash/provenance/licence |
| collision de PR sans mécanique | accepté P1 | overlap défini par path, fragment ID ou clé de contrat ; sérialisation queue GitHub ou manuelle |
| branches non protégées | accepté P1 | snapshot PF0 ; tant qu'elles restent non protégées, `MANUAL_MERGE_ONLY` et autorisation humaine par opération |
| définition d'incident externe trop large | accepté P2 | limitée aux pull image/réseau, panne runner ou OOM avec logs et deux retries du même commit |
| compteur source manuel divergent | accepté P2 | aucun total recopié ; S0 le calcule depuis le manifest et les fichiers suivis |
| mutations d'interaction comparées par ordre | accepté P2 | comparaison des ensembles de nœuds touchés jusqu'à stabilité, pas de l'ordre des records |
| source du libellé Design ambiguë | accepté P2 | `design-ownership.status` est la source unique ; `blocksQualifications` ne décide que les gates affectés |

La maquette justifie le traitement des mouvements continus : elle contient notamment
`computeScan`, `v59AgentPulse`, `v59RunPulse`, `a60dash`, `a62TargetPulse` et `m69Pulse` en
animation infinie. Il ne s'agit donc pas d'un cas théorique.

## 3. Objections rejetées ou reclassées

### 3.1 Exempter les animations continues des pixels — rejeté

Une région animée continue ne sort pas de `anchorDiffPixels`. Cela recréerait un angle mort
précisément sur les pixels visibles. R7 fige une phase de façon déterministe, compare référence
et application à la même phase, puis vérifie la fermeture du cycle. Géométrie, structure,
styles et pixels restent tous qualifiants.

### 3.2 Imposer 100 paires A/A — rejeté

Les propositions de 100 runs ou de scripts qui cherchent la chaîne `100 paires` ne reposent
sur aucune mesure du bruit du runner. R7 conserve un minimum borné de vingt paires réparties
sur quatre processus/contextes frais, une union spatiale, puis un batch de validation séparé.
Le bon correctif est une enveloppe falsifiable et un rerun dédié lors de toute hausse, pas un
nombre arbitraire présenté comme preuve statistique.

### 3.3 Déclarer P0a > 400 LOC avant implémentation — reclassé en risque contrôlé

R6 chargeait trop P0a parce qu'il y plaçait aussi ADR et gouvernance. R7 déplace plan,
synthèses, ADR-042 et ownership Design dans PF0. P0a conserve une limite dure de 400 LOC et
doit s'arrêter si elle ne tient pas. Sans diff réel, affirmer qu'elle dépassera le seuil reste
une hypothèse ; créer préventivement une PR supplémentaire ferait encore reculer le premier
pixel sans preuve.

### 3.4 Exclure tous les `tabindex=-1`/`display:none` — rejeté tel quel

Un `tabindex=-1` peut être la cible légitime d'un skip link ou d'une séquence déclarée ; un
nœud masqué peut devenir actif dans un état ouvert. R7 compte ces nœuds s'ils sont atteints
par une interaction déclarée, et distingue amélioration a11y utile de focusabilité décorative.

### 3.5 Census absent de l'image — reclassé en clarification

R6 imposait déjà G1/G2 dans l'image. R7 rend la règle locale et explicite dans G0 afin qu'un
agent froid ne dépende pas d'une inférence entre sections.

## 4. Arbitrages de faisabilité

- P0a reconstruit l'image depuis un checkout propre et régénère deux fois les sorties ; P0b
  ne peut pas produire ni modifier l'outil qu'il verrouille.
- Une slice qui modifie le toolchain utilise `G0-tool-change`, reste non qualifiante, puis une
  PR lock-only distincte crée ou tourne le lock.
- Les sorties de run sont des artifacts CI, pas des milliers de lignes ajoutées au diff.
- Le pilote reste volontairement limité à trois ancres Home, mais aucun `notRun` ne peut être
  transformé en PASS ni survivre à la fermeture d'une surface ou à la promotion globale.
- Les branches distantes non protégées ne sont pas maquillées en sécurité : le plan encode
  explicitement la contrainte procédurale `MANUAL_MERGE_ONLY`.

## 5. Décision et condition d'arrêt documentaire

R7 ferme les défauts structurels démontrés par les reviews R3 à R6 sans ajouter une nouvelle
architecture de preuve. Le prochain travail utile est l'exécution froide A–D, pas une sixième
boucle de reformulation.

Après R7, un rapport `DOCUMENT-ONLY` ne rouvre pas le plan en répétant un finding déjà arbitré.
Il faut une preuve nouvelle, reproductible, liée au dépôt ou à une exécution, avec confiance
au moins 0,7. Un échec réel de bootstrap, un diff >400 LOC, une mutation non détectée ou un
run non déterministe reste au contraire bloquant et doit être corrigé avant P1.

## 6. Verdict critic

```json
{
  "passed": false,
  "summary": "R7 est documentairement complet, mais aucune chaîne A-D exécutable ni gate de parité n'existe encore.",
  "plan_completeness": "complete",
  "blocking": true,
  "required_next_step": "Committer PF0, exécuter les rôles A-D avec accès dépôt, puis synthétiser E avant toute implémentation visuelle."
}
```

`passed:false` ne signifie pas que le plan doit encore être réécrit. Il signifie que le plan
n'est pas une preuve d'exécution et que les préconditions autorisantes restent à produire.
