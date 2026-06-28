// Récupération d'une fiche détail K10 (Registre des résidences pour aînés, MSSS).
//
// La page détail complète est servie par :
//   http://k10.pub.msss.rtss.qc.ca/public/formulaire/K10FormCons.asp?noForm=<id>
//
// Particularité d'encodage : la page se déclare en iso-8859-1 mais utilise en
// réalité des octets Windows-1252 (en-dash « – », apostrophes typographiques…).
// On décode donc en windows-1252 pour ne rien perdre.

export const BASE = 'http://k10.pub.msss.rtss.qc.ca';

export function detailUrl(noForm) {
  return `${BASE}/public/formulaire/K10FormCons.asp?noForm=${noForm}`;
}

// Décode un Buffer de réponse en texte, en respectant le charset réel (cp1252).
export function decodeCp1252(buffer) {
  return new TextDecoder('windows-1252').decode(buffer);
}

// Télécharge le HTML brut (déjà décodé en chaîne) d'une fiche par noForm.
export async function fetchFiche(noForm, { timeoutMs = 30000 } = {}) {
  const url = detailUrl(noForm);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} pour ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return decodeCp1252(buf);
  } finally {
    clearTimeout(t);
  }
}
