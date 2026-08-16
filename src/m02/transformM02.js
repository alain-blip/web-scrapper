// Structure brute (extractM02Detail) → enregistrement établissement + FILTRE.
//
// Décision PO : ne garder que les CHSLD PRIVÉS À BUT LUCRATIF.
//   - Statut = Privé            (exclut le public « Santé Québec … »)
//   - Mission = CHSLD           (exclut CH, CLSC, CR…)
//   - À but lucratif            (exclut les OSBL — Partie 3 / sans but lucratif)

const strOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

// OSBL : « Partie 3 » / « Troisième partie » de la Loi des compagnies, ou toute
// mention « sans but lucratif ». Détecté sur le Mode de constitution.
export function estOSBL(modeConstitution) {
  const m = (modeConstitution || '').toLowerCase();
  return /partie\s*3|troisi[eè]me\s*partie|sans\s*but\s*lucratif|but\s*non\s*lucratif/.test(m);
}

// À but lucratif : formes de compagnie (Partie 1A / société par actions / S.E.C.).
export function estLucratif(modeConstitution) {
  if (estOSBL(modeConstitution)) return false;
  const m = (modeConstitution || '').toLowerCase();
  return /partie\s*1a|soci[eé]t[eé]\s*par\s*actions|s\.?e\.?c\.?|commandite|loi\s*des\s*ci?es/.test(m);
}

export function estCHSLD(mission) {
  return /chsld/i.test(mission || '');
}

export function estPrive(statut) {
  return /priv/i.test(statut || '');
}

// Capacité « CHSLD 66 Lit(s) … » → nombre de lits (ou null).
function litsDeCapacite(capacite) {
  const m = (capacite || '').match(/(\d+)\s+Lit\(s\)/i);
  return m ? Number(m[1]) : null;
}

export function transformM02(raw = {}) {
  return {
    cdIntervSocSan: strOrNull(raw.cdIntervSocSan),
    numeroPermis: strOrNull(raw.numeroPermis),
    nomLegal: strOrNull(raw.nomLegal),
    adresse: strOrNull(raw.adresse),
    municipalite: strOrNull(raw.municipalite),
    codePostal: strOrNull(raw.codePostal),
    telephone: strOrNull(raw.telephone),
    regionSociosanitaire: strOrNull(raw.regionSociosanitaire),
    mission: strOrNull(raw.mission),
    statut: strOrNull(raw.statut),
    modeConstitution: strOrNull(raw.modeConstitution),
    modeFinancement: strOrNull(raw.modeFinancement),
    lits: litsDeCapacite(raw.capacite),
    installations: raw.installations || [],
    _source: 'M02',
  };
}

// Verdict de rétention + motifs (pour journaliser, jamais deviner en silence).
export function verdictCHSLDPriveLucratif(rec) {
  const motifs = [];
  if (!estPrive(rec.statut)) motifs.push(`statut=${rec.statut} (non privé)`);
  if (!estCHSLD(rec.mission)) motifs.push(`mission=${rec.mission} (non CHSLD)`);
  if (estOSBL(rec.modeConstitution)) motifs.push(`OSBL (${rec.modeConstitution})`);
  else if (!estLucratif(rec.modeConstitution)) {
    motifs.push(`forme non lucrative confirmée ? (${rec.modeConstitution}) — à revoir`);
  }
  return { garder: motifs.length === 0, motifs };
}
