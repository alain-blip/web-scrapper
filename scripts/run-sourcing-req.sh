#!/bin/bash
# Wrapper launchd pour l'enrichissement REQ quotidien (5h00).
# Chargé par scripts/com.primexpert.sourcing-req.plist. Voir
# src/local/sourcingQuotidien.ts pour la logique (région du jour, idempotence).
#
# launchd ne fournit PAS le PATH d'une session de login : on l'établit ici
# (nvm) et on gère le cas où le disque externe serait démonté.

export PATH="/Users/alainst-jean/.nvm/versions/node/v20.19.4/bin:/usr/local/bin:/usr/bin:/bin"

CODE_DIR="/Volumes/SAUVEGARDE GRIS/03_WEBSCRAPPER/code"
FALLBACK_LOG="$HOME/sourcing-req-erreurs.log"

# Garde-fou : si le disque externe est démonté, le dossier n'existe pas.
if [ ! -d "$CODE_DIR" ]; then
  echo "$(date '+%F %T %Z') ❌ Dossier introuvable ($CODE_DIR) — disque externe démonté ? Sourcing annulé." >> "$FALLBACK_LOG"
  exit 1
fi

LOG_DIR="$CODE_DIR/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/sourcing-req.log"

cd "$CODE_DIR" || { echo "$(date '+%F %T %Z') ❌ cd impossible vers $CODE_DIR" >> "$FALLBACK_LOG"; exit 1; }

{
  echo "===== $(date '+%F %T %Z') — lancement sourcing REQ quotidien ====="
  npx tsx src/local/sourcingQuotidien.ts
  echo "===== $(date '+%F %T %Z') — fin (code de sortie $?) ====="
  echo ""
} >> "$LOG" 2>&1
