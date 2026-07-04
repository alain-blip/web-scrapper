import { parserHTMLAdministrateurs } from './parsers/reqParser';

// On injecte le HTML de simulation directement
const mockHTML = `
<div class="constitution-bloc" id="etat-administrateurs">
    <table class="table-resultats-req">
        <tbody>
            <tr class="ligne-administrateur">
                <td class="col-nom"><span class="nom-famille">TREMBLAY</span>, <span class="prenom">Jean-Pierre</span></td>
                <td class="col-fonction"><span class="libelle-fonction">Président</span></td>
                <td class="col-adresse">123 Rue de la Couronne<br>Québec (Québec) G1K 9A9<br>Canada</td>
            </tr>
        </tbody>
    </table>
</div>`;

console.log("🧪 Lancement du test unitaire du parser REQ...");
const resultats = parserHTMLAdministrateurs(mockHTML);

console.log("🐊 Résultats de l'extraction :");
console.log(JSON.stringify(resultats, null, 2));

if (resultats.length === 1 && resultats[0].nom === "TREMBLAY") {
    console.log("⌅ TEST rÉUSSI : Les sélecteurs saisissent parfaitement la structure !");
} else {
    console.log("⍌ TEST ÉCHOUÉ : Vérifie les sélecteurs ou le HTML injecté.");
}
