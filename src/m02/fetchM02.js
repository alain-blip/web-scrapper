// Récupération des pages du répertoire des établissements MSSS (M02).
//
// Comme le K10 : classic ASP, page déclarée iso-8859-1 mais octets windows-1252
// → on décode en cp1252 (cf. src/fetch.js). HTTP nu, GET, aucun anti-robot.
//
// NB : le domaine m02 est refusé par la politique réseau de l'environnement
// d'exécution géré (contrairement au K10, autorisé) — ce fetch tourne donc en
// local, ou dans un environnement dont la politique ouvre ce host. Il tournerait
// sans souci dans une Cloud Function (pas de Cloudflare, contrairement au REQ).

export const BASE = 'https://m02.pub.msss.rtss.qc.ca';

export function listeUrl(tri) {
  // tri optionnel : 'Region' | 'Mission' | 'Clsc' | 'Munic'
  return `${BASE}/M02ListeEtab.asp${tri ? `?Etab=${encodeURIComponent(tri)}` : ''}`;
}

export function detailUrl(cdIntervSocSan) {
  return `${BASE}/M02Etablissement.asp?CdIntervSocSan=${encodeURIComponent(cdIntervSocSan)}`
    + '&PagePrec=M02ListeEtab';
}

export function decodeCp1252(buffer) {
  return new TextDecoder('windows-1252').decode(buffer);
}

async function get(url, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
    return decodeCp1252(Buffer.from(await res.arrayBuffer()));
  } finally {
    clearTimeout(t);
  }
}

export const fetchM02List = (tri, opts) => get(listeUrl(tri), opts);
export const fetchM02Detail = (cdIntervSocSan, opts) => get(detailUrl(cdIntervSocSan), opts);
