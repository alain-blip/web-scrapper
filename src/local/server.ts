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
        courriel: Array.isArray(id1.courriels) && id1.courriels.length ? id1.courriels[0] : null,
        courriels: Array.isArray(id1.courriels) ? id1.courriels : [],
        personneResponsable: Array.isArray(data.section4_personneResponsable) ? data.section4_personneResponsable : [],

        // 2. Enrichissement Sourcing Inversé REQ
        sourcingStatus: data.enrichissement?.sourcingInverse?.status || 'NON_TRAITE',
        administrateurs: data.enrichissement?.sourcingInverse?.administrateurs || [],
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