# Guide de déploiement — Planificateur de collecte MSSS

Pour **Alain** (non-développeur). On déploie la fonction planifiée dans le projet
Firebase **`primexpert-msss-registre`**, région **`northamerica-northeast1`**.

> ⚠️ **Ne déploie pas seul si tu n'es pas sûr.** On peut faire ces étapes ensemble.
> Rien ici ne touche `primexpert-app-v2`.

---

## 0. Ce dont tu as besoin (une seule fois)

1. **Node.js** installé (vérifie : `node -v` → doit afficher v18, v20 ou plus).
2. **L'outil Firebase** (Firebase CLI). Installe-le :
   ```bash
   npm install -g firebase-tools
   ```
   Vérifie : `firebase --version`.

---

## 1. Se connecter à Firebase

```bash
firebase login
```
Une page web s'ouvre → connecte-toi avec le compte Google qui possède le projet
`primexpert-msss-registre`, et autorise l'accès.

Vérifie que tu vois bien le projet :
```bash
firebase projects:list
```
Tu dois voir `primexpert-msss-registre` dans la liste.

---

## 2. ⚡ Vérifier le plan **Blaze** sur CE projet (important)

Le plan Blaze (paiement à l'usage) est **par projet**. L'avoir activé sur un autre
projet ne suffit PAS : il faut le **rattacher aussi à `primexpert-msss-registre`**.
Blaze est obligatoire ici (les fonctions 2ᵉ génération + l'accès Internet sortant
l'exigent).

1. Va sur la console : **https://console.firebase.google.com/project/primexpert-msss-registre/usage/details**
2. En haut, regarde le forfait :
   - Si c'est déjà **« Blaze »** → parfait, passe à l'étape 3.
   - Si c'est **« Spark »** (gratuit) → clique **« Modifier le forfait »** /
     **« Upgrade »**, choisis **Blaze**, puis sélectionne **ton compte de
     facturation existant** (le même que ton autre projet) et confirme.
3. (Recommandé) Mets un **budget d'alerte** quand on te le propose (ex. 5 $/mois) :
   la collecte est légère, mais ça te prévient en cas d'imprévu.

> Coût attendu : très faible (quelques exécutions courtes par mois). Le budget
> d'alerte est une sécurité, pas une dépense.

---

## 3. Installer les dépendances de la fonction

Depuis le dossier du dépôt `web-scrapper` :
```bash
cd functions
npm install
node copy-scraper.mjs      # embarque le parseur validé (aussi fait au déploiement)
cd ..
```

---

## 4. Déployer

Depuis la **racine** du dépôt `web-scrapper` :
```bash
firebase deploy --only functions
```

- Au premier déploiement, Firebase peut demander d'**activer des services Google**
  (Cloud Functions, Cloud Build, Cloud Scheduler, Artifact Registry, Eventarc,
  Pub/Sub) → **accepte** (réponds « oui »).
- À la fin, tu dois voir `Deploy complete!` et la fonction
  **`collecteQuotidienne`** listée.

C'est tout : la fonction s'exécutera **automatiquement chaque jour à 03:00 (heure
de Montréal)** et collectera la région correspondant au jour du mois.

---

## 5. Où voir les résultats

Console Firestore :
**https://console.firebase.google.com/project/primexpert-msss-registre/firestore**

- **`residences`** : une fiche par résidence (document indexé par `noForm`).
- **`_collectionLog`** : un enregistrement par exécution
  (`AAAA-MM-JJ_jJJ`), avec : régions collectées, `nbEcrites`, `nbErreurs`,
  `nbSkips`, `bloque`, `statut` (`ok` / `ok_avec_erreurs` / `partiel` /
  `bloque` / `hors_calendrier`), durée. **C'est ici que tu vérifies si une
  région a manqué.**

---

## 6. Avant de tout automatiser : MESURER une région (sans déployer)

Pour mesurer le rendement réel (fiches consultables vs redirections du serveur
MSSS) et le temps, **en local, sans rien écrire dans Firestore** :
```bash
node src/collector/runLocal.js --cdRSS 05 --limit 15
```
(`--limit` garde la mesure douce. Retire-le pour une région complète.)

Cela nous dira si une grosse région (Montréal/Montérégie) tient dans la limite de
60 min, ou s'il faudra la découper plus tard (Cloud Tasks). **On décide après la
mesure, pas avant.**

> Note : la fonction planifiée ne « tourne » que le bon jour du mois. Pour tester
> la chaîne complète vers Firestore à la demande (n'importe quel jour), je peux
> ajouter un petit déclencheur manuel temporaire — dis-le-moi si tu veux.

---

## En cas de souci

- `firebase deploy` échoue en demandant la facturation → refais l'**étape 2** (Blaze).
- « Permission denied » → vérifie que tu es connecté au **bon compte Google**
  (`firebase login --reauth`).
- Une région à `statut: bloque` dans `_collectionLog` → le serveur MSSS a
  temporairement bloqué le scraping ; on relancera (la collecte est idempotente,
  aucun doublon).
