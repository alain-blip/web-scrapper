#!/bin/bash
# Wrapper launchd pour l'enrichissement REQ quotidien (5h00).
# Chargé par scripts/com.primexpert.sourcing-req.plist. Voir
# src/local/sourcingQuotidien.ts pour la logique (région du jour, idempotence).
#
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
  echo "===== $(date '+%F %T %Z') — fin (code de sortie $?) ====="
  echo ""
} >> "$LOG" 2>&1
