// Table des régions sociosanitaires (RSS) du registre K10 et calendrier de
// collecte « jour du mois → régions à collecter ».
//
// Particularités du registre (vérifiées sur le site) :
//   - Montréal (06) est éclaté en 5 CIUSSS : 61, 62, 63, 64, 65.
//   - Montérégie (16) est éclatée en 3 CISSS : 71, 72, 73.
//   - Régions 17 (Nunavik) et 18 (Terres-Cries-de-la-Baie-James) : 0 résidence
//     dans le registre → collecte légitimement vide (ce n'est PAS une erreur).
//
// Le `cdRSS` est le code passé au moteur de recherche du site.

export const LIBELLES = {
  '01': 'CISSS du Bas-Saint-Laurent',
  '02': 'CIUSSS du Saguenay – Lac-Saint-Jean',
  '03': 'CIUSSS de la Capitale-Nationale',
  '04': 'CIUSSS de la Mauricie-et-du-Centre-du-Québec',
  '05': "CIUSSS de l'Estrie – CHUS",
  '61': "CIUSSS de l'Ouest-de-l'Île-de-Montréal",
  '62': "CIUSSS du Centre-Ouest-de-l'Île-de-Montréal",
  '63': "CIUSSS du Centre-Sud-de-l'Île-de-Montréal",
  '64': "CIUSSS du Nord-de-l'Île-de-Montréal",
  '65': "CIUSSS de l'Est-de-l'Île-de-Montréal",
  '07': "CISSS de l'Outaouais",
  '08': "CISSS de l'Abitibi-Témiscamingue",
  '09': 'CISSS de la Côte-Nord',
  '10': 'CRSSS de la Baie-James',
  '11': 'CISSS de la Gaspésie / Îles-de-la-Madeleine',
  '12': 'CISSS de Chaudière-Appalaches',
  '13': 'CISSS de Laval',
  '14': 'CISSS de Lanaudière',
  '15': 'CISSS des Laurentides',
  '71': 'CISSS de la Montérégie-Centre',
  '72': 'CISSS de la Montérégie-Est',
  '73': 'CISSS de la Montérégie-Ouest',
  '17': 'Nunavik',
  '18': 'Terres-Cries-de-la-Baie-James',
};

// Calendrier : jour du mois (1..31) → liste de cdRSS à collecter ce jour-là.
export const CALENDRIER = {
  1: ['01'], 2: ['02'], 3: ['03'], 4: ['04'], 5: ['05'],
  6: ['61', '62', '63', '64', '65'],          // Montréal éclaté
  7: ['07'], 8: ['08'], 9: ['09'], 10: ['10'],
  11: ['11'], 12: ['12'], 13: ['13'], 14: ['14'], 15: ['15'],
  16: ['71', '72', '73'],                      // Montérégie éclatée
  17: ['17'],                                  // 0 résidence attendue
  18: ['18'],                                  // 0 résidence attendue
  // 19 à 31 : aucune collecte (les 18 régions sont déjà passées ce mois-ci).
};

// Régions à collecter pour un jour donné (tableau vide si hors calendrier).
export function regionsPourJour(jour) {
  return CALENDRIER[jour] || [];
}

// Jour du mois courant dans le fuseau America/Montreal.
export function jourDuMoisMontreal(date = new Date()) {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montreal', day: 'numeric',
  }).format(date);
  return parseInt(s, 10);
}

// Date AAAA-MM-JJ dans le fuseau America/Montreal (pour les id de journal).
export function dateMontreal(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montreal', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
