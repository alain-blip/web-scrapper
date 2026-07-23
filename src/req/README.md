# Enrichissement REQ (Registraire des entreprises du Québec) — par NEQ

Couche de collecte **autour** du même patron que le collecteur K10 : elle récupère,
pour un NEQ, la fiche « État des renseignements » du REQ et en produit le champ
`section_req` (structure juridique + organes de direction) à attacher au document
`residences`. C'est ce champ que l'onglet « Sourcing REQ » lira — aujourd'hui vide
parce qu'**aucune collecte REQ n'a jamais existé** (voir l'audit).

| Fichier | Rôle |
|---|---|
| `fetchReq.js` | Télécharge la fiche `AfficherNeq` d'un NEQ. **Méthode/paramètre et encodage à confirmer sur le vrai site** (isolés dans `reqUrl()` / `decodeReq()`). |
| `extractReq.js` | Parse le HTML → structure brute. **STUB** : sélecteurs à câbler sur une fixture réelle. |
| `transformReq.js` | Structure brute → schéma final `section_req` (forme **définitive**, valeurs nulles tant que le parseur est un stub). |
| `collectReq.js` | Orchestrateur : liste de NEQ → `fetchReq` → `extract` → `transform` → `writeReq`. Throttle 1,5 s, canary de blocage réel, marqueur `_incomplete`. |
| `scrapeReq.js` | Orchestrateur unitaire (1 NEQ), live **ou** fixture. Miroir de `src/scrape.js`. |

## Endpoint REQ (fourni par le métier)

```
https://www.registreentreprises.gouv.qc.ca/REQNA/GR/GR03/
  GR03A71.RechercheRegistre.MVC/GR03A71/EtatRenseignements/AfficherNeq
```
Appli **MVC** (pas le vieux WebForms) → probablement UTF-8, requête plus simple.

## ⚠️ Deux blocages à lever (les deux hors de ce dépôt)

1. **Réseau.** Depuis l'environnement d'exécution géré, le domaine REQ est **refusé
   par la politique réseau** (`403` au CONNECT). Le chemin *live* ne marche donc que
   là où la sortie vers `registreentreprises.gouv.qc.ca` est autorisée (poste local,
   ou politique réseau de l'environnement modifiée).
2. **Parseur non calé.** `extractReq.js` est un **stub** : ses sélecteurs sont des
   hypothèses. Il faut une **fixture** pour les câler sur le vrai balisage.

## Workflow « fixture d'abord » (la méthode du repo)

Aucun réseau requis ici une fois la fixture en main — exactement comme la fiche
Murray a validé le K10 à 141/141.

```bash
# 1. (localement, où le REQ répond) sauvegarder la page d'un vrai NEQ :
#    fixtures/req-1162487210.html   ← Ctrl+S « page web complète »
#    + noter, via DevTools → Network, la méthode + le paramètre du NEQ.

# 2. câbler les sélecteurs de extractReq.js sur ce HTML, puis :
node src/req/scrapeReq.js --neq 1162487210 --fixture fixtures/req-1162487210.html

# 3. une fois le mapping validé, brancher fetchReq (live) puis la collecte.
```

## À faire ensuite (après validation du parseur)

- Câbler `reqUrl()` / `decodeReq()` sur la requête réelle mesurée.
- Fixer `CANARY_NEQ` (`collectReq.js`) sur une entreprise stable et active.
- Étape prod : lire les `residences` ayant `neqNormalise`, appeler `collectReq`,
  écrire `section_req` (merge idempotent) + journaliser dans `_collectionLog`,
  branché au planificateur existant (`functions/index.js`) — **pas avant** que le
  parseur soit vert sur fixture.
