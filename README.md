# web-scrapper — Registre des résidences pour aînés (K10 MSSS)

Scraper de la fiche détail du *Registre des résidences privées pour aînés* du
MSSS (site K10 : `k10.pub.msss.rtss.qc.ca`). Il transforme la fiche HTML d'une
résidence en un JSON structuré par section (1 → 9), miroir de la fiche.

## Architecture

| Fichier | Rôle |
|---|---|
| `src/fetch.js` | Télécharge une fiche détail (`K10FormCons.asp?noForm=<id>`) et la décode en **windows-1252** (la page se déclare iso-8859-1 mais ne l'est pas). |
| `src/extract.js` | Parse le HTML → structure brute. Trois méthodes : **LV** (label/valeur `span.libelleLecture`), **QR** (questions numérotées Oui/Non/valeur) et **TBL** (tableaux dédiés). |
| `src/transform.js` | Structure brute → JSON de sortie final (Oui/Non → booléens, nombres, split ÉSSS, etc.). |
| `src/scrape.js` | Orchestrateur : `fetch` (ou fixture) → `extract` → `transform`. |
| `scripts/compare.js` | Compare le JSON produit à un oracle de référence, champ par champ. |

## Usage

```bash
npm install

# Scrape live d'une fiche par noForm
node src/scrape.js --noForm 395 --out output/murray-395.json

# Rejouer hors-ligne depuis une fixture HTML
node src/scrape.js --noForm 395 --fixture fixtures/murray-395.html

# Valider contre l'oracle
node scripts/compare.js --noForm 395 --fixture fixtures/murray-395.html \
     --oracle output/sample/murray-395.json
```

## Validation

La mécanique est validée sur la fiche **Murray (noForm 395)** : le JSON produit
reproduit l'oracle `output/sample/murray-395.json` à 100 % (141/141 champs
identiques), aussi bien en live que depuis la fixture. Voir `MAPPING.md` pour la
cartographie exhaustive champ par champ.

> ⚠️ Le scraper n'a pas vocation à lancer les ~1000 fiches d'un coup : on valide
> d'abord la mécanique sur petit échantillon.
