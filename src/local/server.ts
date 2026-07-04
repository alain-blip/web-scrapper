import { Firestore } from '@google-cloud/firestore';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Correction pour l'environnement ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 4000;
const db = new Firestore({ projectId: 'primexpert-msss-registre' });

// Servir les fichiers statiques (l'interface HTML)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * API : Extrait et fusionne les données K10 et REQ pour l'interface
 */
app.get('/api/residences', async (req, res) => {
  try {
    console.log("📊 Chargement et matching des données K10 / REQ...");
    const snapshot = await db.collection('residences').get();
    
    const residencesAmalgamees = snapshot.docs.map(doc => {
      const data = doc.data();
      
      return {
        id: doc.id,
        // 1. Métriques Canoniques K10 [Charte §IV]
        nom: data.nom || data.section1_identification?.nomResidence || 'Nom inconnu',
        region: data.region || 'Non spécifiée',
        ciusss: data.ciusss || 'Non spécifié',
        categorieRPA: data.categorieRPA || 'N/A', // Échelle unique 1-4 [Charte §IV]
        capacite: data.capacite || 0,
        neq: data.section2_titulaires?.personneMorale?.neqNormalise || 'Aucun',
        
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