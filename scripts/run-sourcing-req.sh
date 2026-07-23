#!/bin/bash
# Wrapper launchd pour l'enrichissement REQ quotidien (5h00).
# Chargé par scripts/com.primexpert.sourcing-req.plist. Voir
# src/local/sourcingQuotidien.ts pour la logique (région du jour, idempotence).
#
# Un échec interne DOIT remonter comme code de sortie du wrapper (sinon launchd
# croit le job sain — c'était le bug : le groupe { ... } se terminait sur le
# dernier `echo`, toujours 0, quel que soit le sort de `npx tsx`).
set -o pipefail

# launchd ne fournit PAS le PATH d'une session de login : on l'établit ici (nvm).
export PATH="/Users/alainst-jean/.nvm/versions/node/v20.19.4/bin:/usr/local/bin:/usr/bin:/bin"

# Auto-localisation : CODE_DIR = le dossier parent de scripts/. Le wrapper reste
# ainsi valable où que soit déplacé le projet (interne, externe, autre chemin).
CODE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Log sur le disque interne : toujours visible, indépendant de l'emplacement du code.
LOG_DIR="$HOME/Library/Logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/sourcing-req.log"

# Garde-fou : code introuvable/illisible → on le note et on sort proprement.
if [ ! -r "$CODE_DIR/package.json" ]; then
  echo "$(date '+%F %T %Z') ❌ Code illisible ($CODE_DIR). Sourcing annulé." >> "$LOG"
  exit 1
fi

cd "$CODE_DIR" || { echo "$(date '+%F %T %Z') ❌ cd impossible vers $CODE_DIR" >> "$LOG"; exit 1; }

{
  echo "===== $(date '+%F %T %Z') — lancement sourcing REQ quotidien ====="
  npx tsx src/local/sourcingQuotidien.ts
  CODE=$?
  echo "===== $(date '+%F %T %Z') — fin (code de sortie $CODE) ====="
  echo ""
} >> "$LOG" 2>&1

# Le groupe { ... } n'est pas un sous-shell : $CODE reste visible ici. C'est ce
# code — celui de `npx tsx`, pas celui du dernier `echo` — que launchd verra.
exit "$CODE"
