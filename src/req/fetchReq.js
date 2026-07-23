// Récupération de la fiche « État des renseignements » d'une entreprise au
// Registraire des entreprises du Québec (REQ), par NEQ.
//
// Endpoint moderne (appli MVC) fourni par le métier :
//   https://www.registreentreprises.gouv.qc.ca/REQNA/GR/GR03/
//     GR03A71.RechercheRegistre.MVC/GR03A71/EtatRenseignements/AfficherNeq
//
// ⚠️  DEUX POINTS À CONFIRMER SUR LE VRAI SITE (capture DevTools → Network) avant
//     que le chemin « live » soit fiable — ils sont volontairement isolés ici pour
//     n'avoir qu'un seul endroit à corriger :
//       1. MÉTHODE + PARAMÈTRE du NEQ : GET `?no=<neq>` ? POST form-urlencoded ?
//          (le stub ci-dessous suppose GET avec `?no=`, à valider).
//       2. ENCODAGE de la réponse : l'appli MVC sert normalement de l'UTF-8
//          (contrairement au K10 legacy en windows-1252). On décode donc en UTF-8.
//
// Tant que ce n'est pas confirmé, N'UTILISE PAS ce fetch en masse : valide
// d'abord le parseur hors-ligne sur une fixture (voir src/req/README.md), très
// exactement comme la mécanique K10 l'a été sur la fiche Murray.

export const BASE = 'https://www.registreentreprises.gouv.qc.ca';

export const AFFICHER_NEQ_PATH =
  '/REQNA/GR/GR03/GR03A71.RechercheRegistre.MVC/GR03A71/EtatRenseignements/AfficherNeq';

// Construit l'URL de la fiche « État des renseignements » pour un NEQ.
// TODO(fixture) : confirmer le nom réel du paramètre (`no` ? `noEnt` ? `neq` ?)
// et la méthode. Isolé ici exprès.
export function reqUrl(neq) {
  return `${BASE}${AFFICHER_NEQ_PATH}?no=${encodeURIComponent(neq)}`;
}

// Décode un Buffer de réponse en texte. L'appli MVC est en UTF-8 ; le paramètre
// est laissé explicite pour pouvoir basculer si la capture montre le contraire.
export function decodeReq(buffer, charset = 'utf-8') {
  return new TextDecoder(charset).decode(buffer);
}

// Télécharge le HTML brut (décodé) de la fiche REQ d'un NEQ.
//
// NB : depuis l'environnement d'exécution géré, le domaine REQ est refusé par la
// politique réseau (403 au CONNECT). Ce fetch ne fonctionnera donc QUE là où la
// sortie vers registreentreprises.gouv.qc.ca est autorisée (poste local, ou
// environnement dont la politique réseau ouvre ce host).
export async function fetchReq(neq, { timeoutMs = 30000 } = {}) {
  const url = reqUrl(neq);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Un UA de navigateur réduit le risque de redirection anti-bot ; à
        // ajuster selon ce que le site tolère (mesuré, pas supposé).
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          + ' (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept-Language': 'fr-CA,fr;q=0.9',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} pour ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return decodeReq(buf);
  } finally {
    clearTimeout(t);
  }
}
