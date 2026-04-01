const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const path = require('path');
const fs = require('fs');
const { scanReceipt } = require('./utils/scanner');
const { validateTitle } = require('./utils/helpers');

const scrapersDir = path.join(__dirname, 'scrapers');
const scrapers = {};
if (fs.existsSync(scrapersDir)) {
  fs.readdirSync(scrapersDir).forEach(file => {
    if (file.endsWith('.js')) scrapers[file.replace('.js', '')] = require(path.join(scrapersDir, file));
  });
}

(async () => {
  console.log('⚡ COMPARATEUR IA DÉMARRÉ\n');
  const imagePath = path.join(__dirname, 'ticket.jpg');

  const articles = await scanReceipt(imagePath);
  if (articles.length === 0) return console.log("❌ Aucun article trouvé.");

  console.log('\n📋 PANIER DÉTECTÉ :');
  console.table(articles);

  const browser = await chromium.launch({ headless: true });

  // NOUVEAU : On prépare nos "paniers virtuels" pour le total final !
  let totalTicketOriginal = 0;
  const totauxMagasins = {};
  for (const name of Object.keys(scrapers)) {
      totauxMagasins[name] = 0; // On met les compteurs à zéro
  }

  for (const item of articles) {
    const pTicket = parseFloat(item.prix.replace(',', '.'));
    totalTicketOriginal += pTicket; // On ajoute le prix au ticket de base

    console.log(`\n🔎 Recherche : "${item.nom}" (${pTicket.toFixed(2)}€)`);
    const results = {};

    for (const [name, scraperFn] of Object.entries(scrapers)) {
      try {
        const res = await scraperFn(browser, item.nom);
        
        if (res.status === 'found' && validateTitle(res.product.titre, item.nom)) {
            const scrapedPrix = parseFloat(res.product.prix.replace(',', '.'));
            
            // NOUVEAU : TA RÈGLE DES 30% DE DIFFÉRENCE MAX !
            const differenceRatio = Math.abs(scrapedPrix - pTicket) / pTicket;
            
            if (differenceRatio <= 0.30) { // Si la différence est de 30% ou moins
                results[name] = { titre: res.product.titre, prix: scrapedPrix };
            } else {
                console.log(`   ⚠️ [${name}] Rejeté : Prix trop différent (${scrapedPrix.toFixed(2)}€ au lieu de ${pTicket.toFixed(2)}€)`);
            }
        }
      } catch (e) { console.log(`   ⚠️ Erreur scraper ${name}`); }
      
      // NOUVEAU : TON IDÉE DE SUBSTITUTION (Fallback)
      if (results[name]) {
          // S'il a trouvé le produit et passé le test des 30%, on ajoute le vrai prix
          totauxMagasins[name] += results[name].prix;
      } else {
          // S'il n'a rien trouvé (ou rejeté), on remplace par le prix du ticket d'origine !
          totauxMagasins[name] += pTicket;
      }
    }

    const magasinsTrouves = Object.keys(results);
    if (magasinsTrouves.length > 0) {
      const sorted = magasinsTrouves.sort((a, b) => results[a].prix - results[b].prix);
      const best = results[sorted[0]];
      console.log(`   🏆 Moins cher trouvé chez : ${sorted[0].toUpperCase()} (${best.prix.toFixed(2)}€)`);
    } else {
      console.log(`   ❌ Produit introuvable ou rejeté (on garde le prix de base).`);
    }
  }

  await browser.close();

  // NOUVEAU : LE GRAND CLASSEMENT FINAL !
  console.log('\n=========================================');
  console.log('🛒 BILAN DES COURSES (Total des paniers)');
  console.log('=========================================');
  console.log(`🧾 Ticket original : ${totalTicketOriginal.toFixed(2)}€`);
  
  // On trie les magasins du moins cher au plus cher sur le total
  const classementFinal = Object.keys(totauxMagasins).sort((a, b) => totauxMagasins[a] - totauxMagasins[b]);
  
  for (const magasin of classementFinal) {
      const total = totauxMagasins[magasin];
      const diff = totalTicketOriginal - total;
      
      let message = `🏪 ${magasin.toUpperCase()} : ${total.toFixed(2)}€`;
      if (diff > 0) message += ` (💡 Économie : ${diff.toFixed(2)}€)`;
      else if (diff < 0) message += ` (💸 Perte : ${Math.abs(diff).toFixed(2)}€)`;
      
      console.log(message);
  }
  console.log('=========================================\n');

})();