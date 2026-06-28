# App de consultation — prototype (étape A)

Page web locale pour **consulter** le registre des résidences pour aînés (K10 MSSS).
Lecture seule, pas de base de données, pas d'import Primexpert. Jeu de test : 4 fiches.

## Ouvrir l'appli

**Le plus simple — double-clic :**

1. Ouvre le dossier `app-consultation/`.
2. Double-clique **`index.html`** → il s'ouvre dans ton navigateur.

C'est tout : les données sont embarquées dans `data.js`, aucune installation ni
serveur requis. Fonctionne aussi sur téléphone (mise en page responsive).

> Variante (si tu préfères un petit serveur local) :
> `cd app-consultation && python3 -m http.server 8000` puis ouvre
> `http://localhost:8000`.

## Ce que tu peux faire

- **Liste** des résidences : nom, municipalité, catégorie RPA, nombre d'unités, ÉSSS.
- **3 filtres** en haut, qui se combinent et se mettent à jour en direct :
  - Région / ÉSSS (déroulante)
  - Catégorie RPA (1–4)
  - Nombre d'unités (fourchette min–max)
- **Clic sur une ligne** → fiche complète, toutes les sections (1 → 9), lisible.
- Bouton **« ← Retour à la liste »**.

## Mettre à jour les données

Les fiches affichées sont figées dans `data.js`. Pour les régénérer à partir des
JSON du registre (lecture seule sur les JSON) :

```bash
node app-consultation/build-data.js
```

Jeu de test actuel (modifiable dans `build-data.js`) :
`output/sample/murray-395.json`, `output/estrie/3629.json`,
`output/estrie/6529.json`, `output/estrie/7948.json`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page (filtres, tableau, vue détail). |
| `styles.css` | Mise en forme responsive / mobile. |
| `app.js` | Filtres live, rendu du tableau et de la fiche détail. |
| `data.js` | **Généré** — les fiches embarquées (`window.REGISTRE`). |
| `build-data.js` | Régénère `data.js` depuis les JSON (Node, lecture seule). |

## Hors périmètre (versions futures)

Firebase / base de données, planificateur, comparaison côte à côte, carte,
statistiques, import vers Primexpert, scraping de masse.
