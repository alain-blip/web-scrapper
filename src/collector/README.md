# Collecteur de régions (étape B)

Couche de collecte **autour** du parseur validé. Elle **n'utilise** que
`fetch.js` / `extract.js` / `transform.js` (jamais modifiés — Règle #0).

| Fichier | Rôle |
|---|---|
| `regions.js` | Table des régions (RSS) + calendrier *jour du mois → cdRSS* (Montréal 06→61-65, Montérégie 16→71-73, jours 19-31 = rien). Helpers fuseau America/Montreal. |
| `regionSearch.js` | Liste les résidences d'une région via le moteur de recherche (`cdRSS`). Renvoie `{registre, nom, municipalite}`. `parseResultats()` est testable hors-ligne. |
| `collectRegion.js` | Orchestre une région : recherche → `fetchFiche` → `extract` → `transform` → callback `writeFiche`. Throttle, détection de redirection-accueil (soft-block) + back-off. |
| `runLocal.js` | Mesure locale **sans Firebase** (rendement + durée). |

## Faits importants sur le site MSSS (mesurés)

- Les résultats de recherche ne donnent que des `Registre=N` ; pour les fiches
  consultables, **`noForm == Registre`** → on récupère le détail directement
  (1 requête/fiche, plus doux).
- Le serveur **redirige vers l'accueil** (« Objet déplacé ») au-delà d'un certain
  débit (soft-block anti-scraping). Le collecteur le détecte (absence de
  `name="lien_1"`), journalise en `skips`, et s'arrête après N redirections
  consécutives (`seuilBlocage`) au lieu de marteler.
- Régions **17 (Nunavik)** et **18 (Terres-Cries)** : 0 résidence → collecte vide
  normale, pas une erreur.

## Mesurer une région (local, ne déploie rien, n'écrit pas dans Firestore)

```bash
node src/collector/runLocal.js --cdRSS 05 --limit 15      # échantillon doux
node src/collector/runLocal.js --jour 5                   # via le calendrier
node src/collector/runLocal.js --cdRSS 05 --throttle 1500 # région complète
```

Le déploiement de la fonction planifiée est décrit dans `functions/DEPLOY.md`.
