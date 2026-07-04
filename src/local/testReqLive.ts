import { extraireAdministrateursREQ, parserHTMLAdministrateurs } from './parsers/reqParser';
import fs from 'fs';

async function main() {
  const html = fs.readFileSync('stealth_req_result.html', 'utf8');
  const offline = parserHTMLAdministrateurs(html);
  console.log('🧪 Offline (Château Pierrefonds HTML sauvegardé):');
  console.log(JSON.stringify(offline, null, 2));

  console.log('\n📡 Live NEQ 1141016072...');
  const live = await extraireAdministrateursREQ('1141016072');
  console.log(JSON.stringify(live, null, 2));

  if (live.length > 0) {
    console.log('\n🎉 SUCCÈS — CloudFront contourné, administrateurs extraits.');
  } else {
    console.log('\n⚠️ Live OK mais aucun administrateur parsé.');
  }
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
