# Enrichissement REQ (Registraire des entreprises du Québec) — par NEQ

Récupère, pour un NEQ, la fiche « État des renseignements » du REQ et en produit
le champ `section_req` (structure juridique + organes de direction) à attacher au
document `residences`. C'est ce champ que l'onglet « Sourcing REQ » lira — vide
aujourd'hui parce qu'**aucune collecte REQ n'a jamais existé** (voir l'audit).

| Fichier | Rôle | État |
|---|---|---|
| `extractReq.js` | Parse le HTML « État des renseignements » → structure brute. | **Validé** sur fixture réelle. |
| `transformReq.js` | Structure brute → schéma final `section_req`. | **Validé**. |
| `scrapeReq.js` | Orchestrateur unitaire (1 NEQ), live **ou** fixture. Miroir de `src/scrape.js`. | OK |
| `fetchReq.js` | Récupère la fiche via **navigateur** (Cloudflare). | À valider en local. |
| `collectReq.js` | Orchestrateur : liste de NEQ → fetch → extract → transform → `writeReq`. Throttle, canary, `_incomplete`. | À brancher. |

## Ce que le site impose (mesuré sur captures réelles)

- **Cloudflare « managed challenge »** : un `fetch()` nu récupère « Just a moment… »
  (`test_req.html`), pas les données. Il faut un **vrai navigateur** avec JS+cookies
  — c'est le rôle de `fetchReqBrowser()` (Playwright, Chromium préinstallé). C'est
  ce que faisait le poste **local (VSCode)** : un navigateur *stealth* → d'où les
  captures `stealth_req_*.html`.
- **Flux multi-étapes** avec jeton `__RequestVerificationToken` :
  `RechercheParEntreprise` (Objet = NEQ, Domaines=1, Etendues=4, conditions cochées)
  → résultats → « État des renseignements ».
- **Réseau** : depuis l'environnement d'exécution géré, le domaine REQ est refusé
  par la politique réseau (403 au CONNECT). Le *live* ne tourne donc que **en local**
  (ou dans un environnement dont la politique ouvre `registreentreprises.gouv.qc.ca`).

## Workflow

**A. Parser une capture (aucun réseau requis — validé)** :
```bash
node src/req/scrapeReq.js --neq 1141016072 --fixture fixtures/req-1141016072.html
```
Sort le `section_req` complet (raison sociale, forme juridique, statut,
administrateurs[], actionnaires[], bénéficiaires ultimes, CAE, salariés…).

**B. Live via navigateur (en local, où le host répond)** :
```bash
npm i -D playwright        # Chromium déjà présent (PLAYWRIGHT_BROWSERS_PATH)
node src/req/scrapeReq.js --neq 1141016072
```
`fetchReqBrowser()` est écrit d'après les formulaires observés mais **non validé de
bout en bout** (réseau bloqué côté serveur d'exécution) : ajuster les sélecteurs de
résultat au besoin. Le mode fixture (A), lui, est le socle stable.

## Fixture de référence

`fixtures/req-1141016072.html` — CHÂTEAU PIERREFONDS INC. (capturée via navigateur
stealth en local, renseignements au 2026-07-03). Sert de golden pour le parseur,
comme `murray-395.html` pour le K10.

## À faire ensuite

- Valider `fetchReqBrowser` en local sur quelques NEQ (dont un radié, un actif, un
  introuvable) ; fixer `CANARY_NEQ` (`collectReq.js`) sur une entreprise stable.
- Étape prod : lire les `residences` ayant `neqNormalise`, appeler `collectReq`,
  écrire `section_req` (merge idempotent) + journaliser dans `_collectionLog`,
  branché au planificateur (`functions/index.js`). Le collecteur REQ tourne **en
  local ou dans un env au réseau ouvert**, pas dans une Cloud Function bridée.
