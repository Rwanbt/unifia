# Unifia — index exécutable condensé des 78 lots GP

> Extraite des champs `train`, `dependencies`, `gates`, `requirements` et `github_issues` de la matrice des user stories, recoupée avec le pack **v1.5.4 CORRIGÉ**. **Cet index est une projection de lecture, pas un registre canonique et ne prouve aucun test produit.** Les IDs de dépendance abrégés `00`, `01`, etc. désignent `GP-00`, `GP-01`. Les quantités sont les **associations d'exigences au lot**, qui se recouvrent entre lots : ne pas sommer pour obtenir 1 251.

- Décisions release 1 et ordre : `docs/autonomy/rc0/DECISIONS.md` et `docs/autonomy/rc0/README.md` (v2.2).
- Inventaire GP-00 du 07/10 : `docs/autonomy/global/GP-00-BASELINE-DELTA-2026-10-07.md`. Ne pas refaire GP-00 à partir d'une ancienne branche `new-ui`.
- Ticket programme [#598](https://github.com/Rwanbt/unifia/issues/598), release 1 [#581](https://github.com/Rwanbt/unifia/issues/581), stabilisation [#597](https://github.com/Rwanbt/unifia/issues/597).
- Le **texte intégral des 78 cartes, les IDs de chaque exigence et les 21 critères de gates** résident encore dans le pack v1.5.4 du propriétaire. Pour un `CLAIMED`, importer/contrôler ces sources ou disposer d'une copie vérifiable avec hashes. Une ligne de cet index ne remplace pas la carte.
- Les issues déjà clôturées peuvent être citées comme antécédents mais **pas comme certification d'un lot** ; les nouvelles #652–#654 portent les écarts Design et upstream.
- Les suites GP hors premier train sont **post-RC-1** lorsque le recouvrement RC-1 a été traité ; ne pas créer deux tickets d'exécution concurrents.

```text
ID | Train | Prérequis GP (n°) | Gates directs | Associations de requirements | Issues (n°)
GP-00|REL-R0|-|BASELINE-GATE|107|597,587,581
GP-01|REL-R0|00|-|65|564,480
GP-02|REL-R0|00|-|44|480,56,545,546
GP-03|REL-R0|00|-|59|576,575
GP-04|REL-R0|00,02|CONVERGENCE-GATE|104|581,564
GP-10|REL-RF|00|K3-INF-AUTHORITY-BRIDGE|160|599
GP-11|REL-RF|10|-|54|600
GP-12|REL-RF|10,11|KERN-K0|55|601
GP-13|REL-RF|12|KERN-M0.9|42|602
GP-14|REL-RF|10,13|-|83|603
GP-15|REL-RF|10,14|-|96|604,567
GP-16|REL-RF|13,14,15|-|65|605
GP-17|REL-RF|10|-|53|568,563,654
GP-18|REL-RF|11,12,13,14,15,16,17|FOUNDATION-GATE,SK-G0|127|606
GP-20|REL-R1|00,04|-|25|116,549,548
GP-21|REL-R1|20|UI-SLICE-GATE|15|551,553,116
GP-22|REL-R1|01,21|UI-SLICE-GATE|10|116,480,549
GP-23|REL-R1|21,22|UI-SLICE-GATE|7|96,558,559
GP-24|REL-R1|21,52|UI-SLICE-GATE|7|580,570,116
GP-25|REL-R1|04,21|UI-SLICE-GATE|9|493,569,470
GP-26|REL-R1|04,21|UI-SLICE-GATE|7|555,556,557
GP-27|REL-R1|15,21|UI-SLICE-GATE|8|97,118,560,561,562
GP-28|REL-R2|22,23,24,25,26,27,35|UI-FULL-GATE|21|549,553,579
GP-30|REL-R2|04,20|-|10|104,552,652
GP-31|REL-R2|21,30|-|8|105,109,552,652
GP-32|REL-R2|31|-|8|107,552,652
GP-33|REL-R2|30,31|-|11|607
GP-34|REL-R2|15,31,32,33|-|14|572,653
GP-35|REL-R2|31,32,33,34,79,80|-|11|552,572,549
GP-40|REL-R3|18|-|29|608,569
GP-41|REL-R3|40|-|14|609
GP-42|REL-R3|41|-|15|610
GP-43|REL-R3|15,40,41|-|14|611
GP-44|REL-R3|11,40,41|-|18|612
GP-45|REL-R3|11,40,41|-|19|613
GP-46|REL-R3|25,41,42|-|12|614
GP-47|REL-R3|18,42,43,44,45,46|SK-G2|32|615
GP-50|REL-R4|18,47|-|9|616
GP-51|REL-R4|47,50|-|13|617
GP-52|REL-R4|04,14,15,16|-|6|580
GP-53|REL-R4|11,16,51|-|11|618
GP-54|REL-R4|51,53|-|8|556
GP-55|REL-R4|15,51,53|-|14|619
GP-56|REL-R4|26,53,54,55|-|10|555,557,570,574
GP-57|REL-R4|47,51,52,53,54,55,56|SK-G3|10|620
GP-60|REL-R5|18,57|-|11|621,574
GP-61|REL-R5|15,57,60|-|8|622
GP-62|REL-R5|14,61|-|18|623,566
GP-63|REL-R5|62|-|11|624
GP-64|REL-R5|27,63|-|13|625
GP-65|REL-R5|15,17,62,63,64|-|18|626
GP-66|REL-R5|57,60,61,62,63,64,65|SK-G4,SK-G5,SK-G6,SK-G7|23|627
GP-70|REL-R6|00,10,11,13|INF-T0|214|628
GP-71|REL-R6|13,18,70|-|92|629
GP-72|REL-R6|11,16,71|-|139|630
GP-73|REL-R6|72|-|152|631
GP-74|REL-R6|72,73|-|130|632
GP-75|REL-R6|15,74,76|INF-BACKEND-GATE|95|633
GP-76|REL-R6|15,71|-|92|634
GP-77|REL-R6|14,15,72,75,76|-|120|635
GP-78|REL-R6|22,26,74,75,76,77|-|100|636,560
GP-79|REL-R7|73,74,75,76,77|INF-BACKEND-GATE|21|637
GP-80|REL-R7|22,26,33,73,79|-|22|638
GP-81|REL-R7|71,72,73,74,76,77|INF-BACKEND-GATE|14|639,117
GP-82|REL-R8|66,74,76,77|-|43|640
GP-83|REL-R8|63,77,82|-|34|641
GP-84|REL-R8|75,76,77,78,79,81,83|INF-BACKEND-GATE|18|642,575
GP-85|REL-R8|71,72,73,74,75,76,77,78,83|INF-BACKEND-GATE|13|643,575
GP-86|REL-R9|15,73,78|-|12|644
GP-87|REL-R9|79,80,86|INF-BACKEND-GATE|14|645
GP-88|REL-R9|65,82,83,86|INF-BACKEND-GATE|18|646
GP-89|REL-R9|76,77,84,85|INF-BACKEND-GATE,SK-G6|11|647
GP-90|REL-R0|00,01,02,03,04|POST-RELEASE-GATE,RELEASE-GATE|46|576,577,578
GP-91|REL-R1|04,21,22,23,24,25,26,27,45,52,90|POST-RELEASE-GATE,RELEASE-GATE|97|577,116,581
GP-92|REL-R2|28,35,80,81,91|POST-RELEASE-GATE,RELEASE-GATE,UI-FULL-GATE|23|549,552,577
GP-93|REL-R10|90|-|61|648
GP-94|REL-R10|47,57,66,78,80,81,83,84,85,86,87,88,89,92|POST-RELEASE-GATE,RELEASE-GATE,SK-G8|734|649
GP-95|REL-R10|93,94|PROGRAM-COMPLETE-GATE|11|650
```

Les 78 lots sont tous identifiés, mais cela ne constitue pas 78 tâches READY : il faut la **carte normative, son contexte SHA et l'atomisation** avant le travail autonome.
