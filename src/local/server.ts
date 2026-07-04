import { Firestore } from '@google-cloud/firestore';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { LIBELLES } from '../collector/regions.js'; // table cdRSS → nom (source unique)

// Correction pour l'environnement ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 4000;
const db = new Firestore({ projectId: 'primexpert-msss-registre' });

// Servir les fichiers statiques (l'interface HTML est à côté de ce fichier)
app.use(express.static(__dirname));

// Préfixes de boîtes génériques = ligne de réception, pas un décideur
const PREFIXE_GENERIQUE = /^(info|admin|administration|reception|réception|contact|direction|bureau|rpa|residence|résidence|accueil|comptabilite|comptabilité|location|secretariat|secrétariat|service|dg)s?[0-9._-]*@/i;
const sansAccents = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Classe un courriel K10 par rapport aux dirigeants REQ connus.
 * DECIDEUR = le nom d'un dirigeant apparaît dans l'adresse ; GENERALE = boîte
 * de réception ; PERSO = personnel mais non rattaché ; AUCUN = pas de courriel.
 */
function classifierCourriel(mail, admins) {
  if (!mail) return { code: 'AUCUN', label: '—' };
  if (PREFIXE_GENERIQUE.test(mail)) return { code: 'GENERALE', label: 'Ligne générale' };
  const local = sansAccents(mail.split('@')[0]);
  const matchDirigeant = (admins || []).some(a => {
    const nom = sansAccents(a.nom), pre = sansAccents(a.prenom);
    return (nom.length > 2 && local.includes(nom)) || (pre.length > 2 && local.includes(pre));
  });
  return matchDirigeant
    ? { code: 'DECIDEUR', label: 'Décideur' }
    : { code: 'PERSO', label: 'Perso à confirmer' };
}

/**
 * API : Extrait et fusionne les données K10 et REQ pour l'interface
 */
app.get('/api/residences', async (req, res) => {
  try {
    console.log("📊 Chargement et matching des données K10 / REQ...");
    const snapshot = await db.collection('residences').get();
    
    const residencesAmalgamees = snapshot.docs.map(doc => {
      const data = doc.data();
      const cdRSS = data._regionCdRSS;
      const id1 = data.section1_identification || {};
      const portraits = data.section6_portraits || {};
      const admins = data.enrichissement?.sourcingInverse?.administrateurs || [];
      const courriel = Array.isArray(id1.courriels) && id1.courriels.length ? id1.courriels[0] : null;

      return {
        id: doc.id,
        // 1. Métriques Canoniques K10 [Charte §IV] — chemins réels du schéma
        nom: data.nom || id1.nomResidence || 'Nom inconnu',
        region: data.region || (cdRSS ? (LIBELLES[cdRSS] || `RSS ${cdRSS}`) : 'Non spécifiée'),
        ciusss: data.ciusss || id1.esssNom || 'Non spécifié',
        categorieRPA: data.categorieRPA ?? id1.categorieRPA ?? 'N/A', // Échelle unique 1-4 [Charte §IV]
        capacite: data.capacite ?? portraits.capaciteRPA ?? 0,
        neq: data.section2_titulaires?.personneMorale?.neqNormalise || 'Aucun',

        // 1b. Coordonnées déjà présentes au registre K10 (section1)
        telephone: id1.telephone || null,
        telecopieur: id1.telecopieur || null,
        courriel,
        courriels: Array.isArray(id1.courriels) ? id1.courriels : [],
        courrielQualite: classifierCourriel(courriel, admins).code, // DECIDEUR|GENERALE|PERSO|AUCUN
        personneResponsable: Array.isArray(data.section4_personneResponsable) ? data.section4_personneResponsable : [],

        // 2. Enrichissement Sourcing Inversé REQ
        sourcingStatus: data.enrichissement?.sourcingInverse?.status || 'NON_TRAITE',
        administrateurs: admins,
        erreurREQ: data.enrichissement?.sourcingInverse?.erreur || null
      };
    });

    res.json(residencesAmalgamees);
  } catch (error) {
    console.error("❌ Erreur API:", error);
    res.status(500).json({ error: "Impossible de charger les résidences" });
  }
});

app.listen(port, () => {
  console.log(`🚀 Application de consultation lancée sur : http://localhost:${port}`);
});