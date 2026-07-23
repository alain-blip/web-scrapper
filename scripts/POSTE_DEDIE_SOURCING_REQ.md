# Poste dédié — sourcing REQ 5h

> Je n'ai pas accès à une machine physique pour exécuter cette migration —
> ce document est le runbook pour qui la fera (toi, ou une prochaine session
> sur cette machine-là). Rien ci-dessous n'a été exécuté.

## Pourquoi un poste dédié

Le job tourne en local exprès (IP résidentielle → passe Cloudflare ; une Cloud
Function sur IP datacenter se ferait bloquer). Ça exige une machine allumée,
en session graphique, à 5h00 tous les jours — pas un poste de travail qu'on
éteint le soir.

## Prérequis machine

- macOS (Mac mini ou desktop, peu importe le modèle — rien ici n'est
  spécifique au matériel).
- Google Chrome installé (`channel:'chrome'` dans `sourcingInverse.ts` — pas
  le Chromium embarqué de Puppeteer).
- Node.js (nvm), même version que la machine actuelle (`v20.19.4` — voir
  `run-sourcing-req.sh`, le `PATH` y est câblé en dur sur cette version).
- Une session utilisateur graphique **ouverte en permanence** (le plist a
  `LimitLoadToSessionType=Aqua` — launchd n'exécute PAS le job si personne
  n'est connecté en session Aqua, même si la machine est allumée).

## Étapes de migration

1. **Copier le dépôt** `code/` (ce dossier) sur le nouveau poste, avec son
   historique git si possible (`git clone`, pas juste une copie de fichiers —
   plus simple pour les mises à jour futures).
2. **Installer les dépendances** : `npm install` dans `code/` (installe
   `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth` déjà
   déclarés dans `package.json`).
3. **Copier la clé du compte de service** — `~/.config/primexpert/sa-sourcing-req.json`
   (créée cette session, `roles/datastore.user` uniquement sur
   `primexpert-msss-registre`). Transfert **jamais** par email/Slack en
   clair : clé USB chiffrée, ou un gestionnaire de secrets si disponible.
   Sur le nouveau poste : `mkdir -p ~/.config/primexpert && chmod 700
   ~/.config/primexpert`, copier le fichier, `chmod 600` dessus.
   *(Si cette clé est un jour compromise ou si tu préfères repartir propre :
   `gcloud iam service-accounts keys create` en génère une nouvelle sans
   toucher au compte de service lui-même.)*
4. **Adapter les chemins absolus** — `scripts/run-sourcing-req.sh` et
   `scripts/com.primexpert.sourcing-req.plist` contiennent tous les deux le
   chemin absolu `/Users/alainst-jean/03_WEBSCRAPPER/code` et
   `/Users/alainst-jean/.config/primexpert/sa-sourcing-req.json`. À ajuster
   si le nom d'utilisateur ou l'emplacement du dépôt diffère sur le nouveau
   poste (le wrapper s'auto-localise déjà pour `CODE_DIR` via
   `$(dirname "$0")` ; seul le `ProgramArguments` du plist et le
   `GOOGLE_APPLICATION_CREDENTIALS` restent en dur).
5. **Installer le plist** :
   ```bash
   cp scripts/com.primexpert.sourcing-req.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.primexpert.sourcing-req.plist
   ```
6. **Empêcher la mise en veille** (Réglages Système → Économiseur d'énergie →
   « Ne jamais mettre en veille » / ou en ligne de commande :
   `sudo pmset -a sleep 0 disksleep 0`). L'écran peut s'éteindre
   (`displaysleep`), mais le système ne doit jamais dormir à 5h00.
7. **Garder un réveil programmé en filet de sécurité** (déjà en place sur la
   machine actuelle, commit `d7cb71a` : `sudo pmset repeat wake MM/dd/yy
   04:58:00`). Même avec « ne jamais dormir », un réveil programmé reste une
   bonne redondance si la machine s'éteint pour une autre raison (mise à
   jour, coupure de courant avec redémarrage auto à activer aussi :
   Réglages Système → Général → Reprise après coupure de courant).
8. **Vérifier après la première nuit réelle** :
   `tail -50 ~/Library/Logs/sourcing-req.log` — chercher `lancement sourcing
   REQ quotidien` daté du bon matin, puis `fin (code de sortie 0)`.

## Ce qui ne bouge pas dans cette migration

- Le compte de service reste le même (`sourcing-req@primexpert-msss-registre.iam.gserviceaccount.com`,
  `roles/datastore.user`) — une seule clé à gérer, pas un compte par poste.
- Aucun changement à `sourcingInverse.ts`, au champ `enrichissement.sourcingInverse`,
  ni aux docs déjà enrichis.
