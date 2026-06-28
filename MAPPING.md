# Mapping exhaustif K10 MSSS → JSON de sortie

Référence : **vraie fiche Murray (noForm=395)** + cartographie Identité Primexpert V2.
Le JSON de sortie est **organisé par section** (1→9), miroir de la fiche K10.

Légende méthode de parsing :
- **LV** = paire label/valeur (`span.libelleLecture` + texte après `</span><br/>`) — porté du legacy `getFieldValue()`.
- **QR** = question numérotée Oui/Non/valeur (`td.formSeparation` n° + libellé + réponse).
- **TBL** = tableau (parseur de lignes dédié — à écrire/étendre).
- 🎯 = comble un **gap Primexpert** (cartographie « ABSENT »).

---

## En-tête (hors section)
| Champ JSON | Source K10 | Méthode |
|---|---|---|
| `noForm` | URL `?noForm=` | — |
| `numeroInterne` | « Numéro interne : » | LV |
| `numeroRegistre` | titre « Résidence Murray (395-1) » | regex titre |
| `residencesLiees[]` | « …est liée aux résidences : 395-1 395-2 » | regex |
| `statut` | « Active » | texte |
| `detailUrl` | construit | — |

## Section 1 — Identification (`section1_identification`)
| Champ JSON | Label K10 | Méthode |
|---|---|---|
| `nomResidence` | Nom de la résidence | LV |
| `adresse` | Adresse de la résidence | LV |
| `codePostal` | Code postal | LV |
| `esss` / `esssCode` / `esssNom` | **Établissement de santé et de services sociaux** (« 05 - CIUSSS de l'Estrie – CHUS ») | LV + split |
| `municipalite` | Municipalité | LV |
| `territoireCLSC` 🎯 | Territoire CLSC | LV |
| `territoireRLS` 🎯 | Territoire RLS | LV |
| `territoireMRC` 🎯 | Territoire MRC *(absent sur Murray — selon fiche)* | LV |
| `courriels[]` | Adresse courriel (multiples, séparés par `;`) | LV + split |
| `telephone` | Téléphone de la résidence | LV |
| `telecopieur` | Télécopieur de la résidence | LV |
| `dateOuverture` | Date d'ouverture de la résidence | LV |
| `typeResidence` | Type de la résidence (à but lucratif / non) | LV |
| `categorieRPA` | Catégorie de la RPA (1-4) | LV → number |
| `nombreTotalUnitesImmeubles` | Nombre total d'unités du ou des immeubles | LV → number |
| `appartenanceGroupeReseau` | Appartenance à un groupe ou réseau | LV |
| `immeublesAssocies[]` | Nom et adresse des immeubles | TBL |

> ⚠️ **Correction vs legacy** : le vrai label est **« Établissement de santé et de services sociaux »**, pas « Région sociosanitaire ». À ajuster dans le parseur.

## Section 2 — Titulaires (`section2_titulaires`)
| Champ JSON | Label K10 | Méthode |
|---|---|---|
| `personneMorale.nomCompagnie` | Nom de la compagnie | LV |
| `personneMorale.neq` 🎯 | Numéro au registre des entreprises (NEQ) | LV |
| `personneMorale.datePrisePossession` | Date de prise de possession | LV |
| `actionnaires[]` {nom, prenom, mention} | Tableau Nom/Prénom (+ « premier actionnaire »/fiducie) | TBL |

## Section 3 — Autres RPA (`section3_autresRPA`)
| Champ JSON | Source | Méthode |
|---|---|---|
| `proprietaireAutresRPA` | 3.1 (Oui/Non) | QR → bool |
| `nombreAutresResidences` | 3.2 | QR → number |
| `liste[]` {nom, neq, adresse, municipalite, esss, codePostal} | Liste des autres résidences | TBL |

## Section 4 — Personne responsable (`section4_personneResponsable[]`)
| Champ JSON | Source | Méthode |
|---|---|---|
| `[]` {nom, prenom} | Tableau employé responsable | TBL |

## Section 5 — Administrateurs (`section5_administrateurs[]`)
| Champ JSON | Source | Méthode |
|---|---|---|
| `[]` {nom, prenom, occupation, fonction} | Tableau CA (`#tableauAdm`) | TBL |

## Section 6 — Portraits (`section6_portraits`)
| Champ JSON | Source | Méthode |
|---|---|---|
| `capaciteTotaleImmeubles` | 6.1 | QR → number |
| `capaciteRPA` 🎯 | 6.2 (places autorisées ≠ unités) | QR → number |
| `repartitionAges` 🎯 {moins65, de65a74, de75a84, de85plus, totalResidents} | 6.3.1–6.3.5 | TBL |
| `unitesParMission` {rpa, ri, rtf, chsld, autres} ×{chambresSimples, chambresDoubles, logements, total, clientele} | 6.4.1–6.4.5 | TBL |
| `totalUnitesLocatives` | 6.4 (6.4.1+…+6.4.5) | TBL |
| `entente108` | 6.5 (Oui/Non) | QR → bool |
| `employes` 🎯 {semaine{jour,soir,nuit}, finDeSemaine{…}} | 6.6.1 | TBL |
| `personnelAssistance` 🎯 {semaine{…}, finDeSemaine{…}} | 6.6.2 | TBL |
| `personnelInfirmier[]` 🎯 {type, semaine{…}, finDeSemaine{…}, precisions} | 6.6.3 | TBL |

## Section 7 — Services (`section7_services`)
| Champ JSON | Source | Méthode |
|---|---|---|
| `securite.typeAppelAide` | 7.1.1 | QR |
| `securite.clienteleErrance` | 7.1.2 (Oui/Non) | QR → bool |
| `securite.dispositifSecuriteSortie` | 7.1.3 (Oui/Non) | QR → bool |
| `loisirs` | 7.2 | QR → bool |
| `repas` | 7.3 | QR → bool |
| `aideDomestique` | 7.4 | QR → bool |
| `assistancePersonnelle` | 7.5 | QR → bool |
| `soinsInfirmiers` | 7.6 | QR → bool |

## Section 8 — Reconnaissance (`section8_reconnaissance`)
| Champ JSON | Source | Méthode |
|---|---|---|
| `membreAssociation` | 8.1 (Oui/Non) | QR → bool |
| `associations[]` | Associations (ex. RQRA) | LV/TBL |
| `permisMAPAQ` | 8.2 a) | QR → bool |
| `permisRBQ` | 8.2 b) | QR → bool |

## Section 9 — Caractéristiques de l'immeuble (`section9_immeuble`)
| Champ JSON | Source | Méthode |
|---|---|---|
| `typeConstruction` | 9.1 | QR |
| `sousSol` {present, porteExterieure, residentsHeberges, nombreEtagesHorsSousSol} | 9.2 a/b | QR |
| `rampeAcces` | 9.3 (Oui/Non) | QR → bool |
| `nombreAscenseurs` | 9.4 | QR → number |
| `mitigeurEauChaude` | 9.5 (Oui/Non) | QR → bool |
| `equipementsDetectionAlarme[]` | 9.6 (liste descriptive) | LV/texte |
| `systemeGicleurs` | 9.7 (En totalité / Partiel / Aucun) | QR |
| `sourceEauPotable` | 9.8 | QR |
| `generatrice` | 9.9 (Oui/Non) | QR → bool |
| `climatisation` {ensembleImmeubles, lieuxCommuns, chambresLogements, controleIndependant} | 9.10 | QR |

---

## Comblement des gaps Primexpert (cartographie « ABSENT »)
| Gap Primexpert | Champ K10 (ce mapping) | Statut |
|---|---|---|
| CLSC d'appartenance | `section1.territoireCLSC` | ✅ Comblé |
| RLS | `section1.territoireRLS` | ✅ Comblé |
| MRC | `section1.territoireMRC` | ⚠️ Comblé **si présent** (absent sur Murray) |
| Capacité autorisée (places) | `section6.capaciteRPA` (6.2) vs `nombreTotalUnitesImmeubles` (6.1) | ✅ Comblé (distinction unités ≠ places) |
| Répartition résidents par âge | `section6.repartitionAges` (6.3) | ✅ Comblé |
| Détail quarts employés | `section6.employes` / `personnelAssistance` / `personnelInfirmier` (6.6) | ✅ Comblé |
| Nombre de lits | — | ❌ Pas un champ K10 distinct sur cette fiche |
| **Date d'émission / expiration permis MSSS** | — | ❌ **ABSENT de K10FormCons** (Murray n'affiche ni n° de certificat ni dates de permis) — à vérifier sur la fiche abrégée au test réseau |

> 🔎 **Constat d'honnêteté** : la fiche détail Murray n'expose **pas** de numéro de certificat ni de dates d'émission/expiration de permis (le legacy cherchait ces labels mais ils ne figurent pas ici). Ces 2 gaps « Haute priorité » risquent de **ne pas être comblables** depuis `K10FormCons.asp`. À confirmer sur la fiche abrégée (`K10ConsFormAbg.asp`) lors du test réseau.
