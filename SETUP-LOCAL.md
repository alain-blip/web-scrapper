# Guide d'installation locale — pour Alain (non-développeur)

Ce guide t'explique, pas à pas, comment mettre le projet **web-scrapper**
(Registre des résidences pour aînés, K10 MSSS) sur **ton propre ordinateur**, et
comment y lancer **Claude**.

> 💡 **À lire d'abord — la différence entre « ici » et « chez toi »**
>
> Quand tu écris à Claude sur le **web** (dans ton navigateur), le projet tourne
> sur un **ordinateur dans le nuage**, pas sur le tien. C'est pour ça qu'une
> commande comme `cd ~/Documents/rpaavendre-local` ne trouve rien : ce dossier
> est sur **ta** machine, que le nuage ne voit pas.
>
> Les commandes ci-dessous (`cd`, `ls`, `claude`, …) se tapent dans le
> **Terminal de ton ordinateur**, une fois que tu as installé les outils. Pas
> dans la fenêtre de chat de Claude.

---

## 0. Ce dont tu as besoin (une seule fois)

Trois outils à installer sur ton ordinateur :

1. **Node.js** — vérifie dans le Terminal : `node -v`
   (doit afficher v20 ou plus). Sinon : https://nodejs.org → bouton **LTS**.
2. **Git** — vérifie : `git --version`.
   Sur Mac, tape simplement `git --version` : s'il n'est pas là, macOS proposera
   de l'installer. Sinon : https://git-scm.com.
3. **Claude Code** — vérifie : `claude --version`. Pour l'installer :
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

### Ouvrir le Terminal

- **Mac** : `Cmd + Espace`, tape « Terminal », `Entrée`.
- **Windows** : menu Démarrer → « PowerShell » ou « Terminal ».

---

## 1. Récupérer le projet sur ton ordinateur (une seule fois)

Dans le Terminal, place-toi dans ton dossier **Documents**, puis télécharge le
projet. Il arrivera dans un dossier nommé `rpaavendre-local` :

```bash
cd ~/Documents
git clone https://github.com/alain-blip/web-scrapper.git rpaavendre-local
```

> Le mot après l'adresse (`rpaavendre-local`) est juste le **nom du dossier** que
> tu veux. Tu peux en choisir un autre, mais garde le même dans la suite.

Puis entre dans le dossier et installe les dépendances :

```bash
cd ~/Documents/rpaavendre-local
npm install
```

Maintenant `ls` (qui veut dire « liste les fichiers ») devrait te montrer :

```
MAPPING.md   README.md   app-consultation   functions
package.json   scripts   src   ...
```

✅ Si tu vois ça, le projet est bien installé.

---

## 2. Lancer Claude sur le projet

À chaque fois que tu veux travailler avec Claude sur ce projet :

```bash
cd ~/Documents/rpaavendre-local
claude
```

C'est exactement les deux lignes du guide de départ. La première te place **dans
le dossier du projet**, la seconde **démarre Claude** dedans. Claude voit alors
tous les fichiers du projet et peut t'aider.

Pour quitter Claude : tape `/exit` (ou `Ctrl + C` deux fois).

---

## 3. Choses utiles que tu peux faire en local

Ces commandes se lancent **hors ligne**, sans rien déployer ni toucher à
Firebase. Tape-les dans le Terminal depuis le dossier du projet.

### a) Ouvrir l'appli de consultation (le plus simple)

Aucune commande : ouvre le dossier `app-consultation/` dans ton explorateur de
fichiers et **double-clique `index.html`**. Il s'ouvre dans ton navigateur.
Détails dans `app-consultation/README.md`.

### b) Rejouer une fiche du registre (le scraper)

```bash
node src/scrape.js --noForm 395 --fixture fixtures/murray-395.html
```

Ça transforme une fiche HTML enregistrée en JSON, sans aller sur Internet.

### c) Mesurer une région (le collecteur, lecture seule)

```bash
node src/collector/runLocal.js --cdRSS 05 --limit 15
```

Ça mesure le rendement d'une région **sans écrire dans Firestore**. Voir
`src/collector/README.md`.

---

## 4. Et pour déployer en ligne ?

Le déploiement (mettre la collecte automatique en ligne dans Firebase) est une
étape **séparée**, décrite dans son propre guide : **`functions/DEPLOY.md`**.
Tu n'en as pas besoin pour travailler en local.

---

## Aide-mémoire

| Je veux… | Commande |
|---|---|
| Voir où je suis | `pwd` |
| Lister les fichiers | `ls` |
| Entrer dans le projet | `cd ~/Documents/rpaavendre-local` |
| Démarrer Claude | `claude` |
| Récupérer la dernière version | `git pull` |

> Si une commande « ne trouve pas » le dossier : tu n'es probablement pas au bon
> endroit. Tape `cd ~/Documents/rpaavendre-local` pour y retourner, puis
> réessaie.
