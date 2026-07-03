// Config Firebase de l'appli de consultation.
//
// Config réelle (Web App Firebase enregistrée le 2026-07-03,
// `firebase apps:create web "Consultation MSSS"`) — apiKey non secrète,
// protégée par les règles Firestore (deny-all déjà actives) et par le mur
// applicatif de consultationApi (token + liste blanche), pas par le secret
// de cette clé.
export const firebaseConfig = {
  apiKey: 'AIzaSyCk49xkDRQecbKDPfqZMAFbVbxI76oHDkg',
  authDomain: 'primexpert-msss-registre.firebaseapp.com',
  projectId: 'primexpert-msss-registre',
  appId: '1:1027331344779:web:5e8d955c1b0335c880c78e',
};

// Bascule unique, explicite — pas de détection automatique.
export const USE_EMULATORS = false;

const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099';
const CONSULTATION_API_URL_EMULATEUR =
  'http://127.0.0.1:5001/primexpert-msss-registre/northamerica-northeast1/consultationApi';
const CONSULTATION_API_URL_PROD =
  'https://northamerica-northeast1-primexpert-msss-registre.cloudfunctions.net/consultationApi';

export const AUTH_EMULATOR = USE_EMULATORS ? AUTH_EMULATOR_URL : null;
export const CONSULTATION_API_URL = USE_EMULATORS
  ? CONSULTATION_API_URL_EMULATEUR
  : CONSULTATION_API_URL_PROD;
