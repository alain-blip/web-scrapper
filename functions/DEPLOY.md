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

## 7. 🧪 Déclencheur de TEST temporaire (`collecteTest`) — à retirer après validation

Une 2ᵉ fonction, **`collecteTest`**, permet de tester la chaîne complète
(collecte → écriture Firestore → `_collectionLog`) **à la demande**, sans
attendre le bon jour. Mêmes garde-fous (throttle 1,5 s, back-off, journal),
avec une **limite basse par défaut (5 fiches)**.

### a) Définir le jeton (une fois)
Crée le fichier **`functions/.env`** (copie de `.env.example`) avec un secret long :
```
COLLECTE_TEST_TOKEN=un-secret-long-et-aleatoire-que-toi-seul-connais
```
> Sans ce jeton, l'endpoint répond `403` (désactivé). Le fichier `.env` n'est pas
> versionné (il est dans `.gitignore`).

### b) Déployer (inclut les 2 fonctions)
```bash
firebase deploy --only functions
```
À la fin, Firebase affiche l'**URL** de `collecteTest`, du type :
```
https://collectetest-XXXXXXXX-nn.a.run.app
```
(ou la forme `https://northamerica-northeast1-primexpert-msss-registre.cloudfunctions.net/collecteTest`).

### c) Appeler le test (doux : 5 fiches)
Dans le navigateur ou avec `curl`, en remplaçant l'URL et le jeton :
```bash
curl "https://<URL-de-collecteTest>?token=TON_SECRET&cdRSS=05&limit=5"
```
Paramètres : `cdRSS` (région, 2 chiffres) · `limit` (défaut 5, max 50) ·
`throttle` (ms, défaut 1500). La réponse JSON donne `nbListe / nbVues /
nbEcrites / nbErreurs / nbSkips / bloque / statut / dureeMs`, et un
enregistrement `mode:"test"` apparaît dans `_collectionLog`.

> ⚠️ On lancera ce test **à froid** (après que le serveur MSSS ait « oublié » les
> sondes), avec un `limit` bas, pour rester doux.

### d) RETIRER l'outil après validation
1. Dans `functions/index.js`, **supprimer tout le bloc `collecteTest`** (entre la
   bannière « OUTIL DE TEST TEMPORAIRE » et la fin du fichier) ainsi que les imports
   devenus inutiles (`onRequest`, `defineString`).
2. Redéployer : `firebase deploy --only functions` → Firebase détecte la fonction
   retirée et **demande de la supprimer** → répondre **oui**.
   (ou explicitement : `firebase functions:delete collecteTest --region northamerica-northeast1`)
3. Optionnel : supprimer `functions/.env`.

---

## En cas de souci

- `firebase deploy` échoue en demandant la facturation → refais l'**étape 2** (Blaze).
- « Permission denied » → vérifie que tu es connecté au **bon compte Google**
  (`firebase login --reauth`).
- Une région à `statut: bloque` dans `_collectionLog` → le serveur MSSS a
  temporairement bloqué le scraping ; on relancera (la collecte est idempotente,
  aucun doublon).
