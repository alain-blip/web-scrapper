import { Firestore } from '@google-cloud/firestore';
import { extraireAdministrateursREQ } from './parsers/reqParser';

const db = new Firestore({ projectId: 'primexpert-msss-registre' });

async function testerUneFicheLive() {
  console.log("🔍 Récupération d'une fiche témoin dans Firestore...");
  
  const snapshot = await db.collection('residences')
    .where('section2_titulaires.personneMorale.neqNormalise', '!=', '')
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.log("❌ Aucune fiche avec un NEQ normalisé trouvé dans ton Firestore.");
    return;
  }

  const doc = snapshot.docs[0];
  const fiche = doc.data();
  const neq = fiche.section2_titulaires.personneMorale.neqNormalise;

  console.log("🎯 Fiche sélectionnée : " + fiche.section1_identification.nomResidence + " | NEQ : " + neq);
  console.log("📡 Appel du REQ en direct...");

  try {
    const administrateurs = await extraireAdministrateursREQ(neq);
    
    console.log("📊 Résultat de l'extraction Live :");
    console.log(JSON.stringify(administrateurs, null, 2));
    
    if (administrateurs.length > 0) {
      console.log("🎉 SUCCÈS : Le live répond et notre parser extrait la donnée !");
    } else {
      console.log("⚠️ Le live a répondu mais aucun administrateur n'a été extrait (Structure HTML différente ou page vide ?)");
    }
  } catch (error) {
    console.error("💥 Échec de la requête Live. Le REQ bloque peut-être l'appel GET direct ou nécessite des headers spécifiques.");
  }
}

testerUneFicheLive();