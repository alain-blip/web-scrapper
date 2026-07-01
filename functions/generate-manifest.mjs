// Génère functions/functions.yaml avant firebase deploy pour court-circuiter
// le subprocess HTTP discovery du CLI (qui timeout si les credentials ADC ne
// sont pas transmis au sous-processus dans cet environnement).
// Lancé en predeploy depuis firebase.json, après copy-scraper.mjs.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, 'functions.yaml');
const ffBin = path.join(here, 'node_modules', '.bin', 'firebase-functions');

const result = spawnSync(process.execPath, [ffBin], {
  env: {
    ...process.env,
    FUNCTIONS_MANIFEST_OUTPUT_PATH: manifestPath,
  },
  cwd: here,
  stdio: 'pipe',
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || '(aucune sortie erreur)\n');
  process.exit(result.status ?? 1);
}

console.log(`Manifest généré : ${path.relative(here, manifestPath)}`);
