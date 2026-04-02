const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const path = require('path');
const fs = require('fs');
const { scanReceipt } = require('./utils/scanner');

// 🛠️ 1. CHARGEMENT SÉCURISÉ DES SCRAPERS
const scrapersDir = path.join(__dirname, 'scrapers');
const scrapers = {};

if (fs.existsSync(scrapersDir)) {
  fs.readdirSync(scrapersDir).forEach(file => {
    if (file.endsWith('.js')) {
      try {
        const scraperName = file.replace('.js', '');
        scrapers[scraperName] = require(path.join(scrapersDir, file));
      } catch (err) {
        console.error(`\x1b[31m❌ Erreur lors du chargement du scraper ${file} : ${err.message}\x1b[0m`);
      }
    }
  });
}

if (Object.keys(scrapers).length === 0) {
  console.error("\x1b[31m❌ Aucun scraper n'a été trouvé dans le dossier 'scrapers/'. Fin du programme.\x1b[0m");
  process.exit(1);
}

// 🚀 2. FONCTION PRINCIPALE
(async () => {
  console.log('\x1b[36m⚡ COMPARATEUR IA DÉMARRÉ\n\x1b[0m');
  const imagePath = path.join(__dirname, 'ticket.jpg');

  // Scanner le ticket
  const articles = await scanReceipt(imagePath);
  
  if (!articles || !Array.isArray(articles) || articles.length === 0) {
    return console.log("\x1b[31m❌ Aucun article trouvé sur le ticket.\x1b[0m");
  }

  console.log('\n\x1b[32m📋 PANIER DÉTECTÉ :\x1b[0m');
  console.table(articles);

  // Lancement du navigateur (Headless = true pour aller plus vite)
  const browser = await chromium.launch({ headless: true });

  // Initialisation des compteurs financiers
  let totalTicketOriginal = 0;
  const totauxMagasins = {};
  for (const name of Object.keys(scrapers)) {
    totauxMagasins[name] = 0; 
  }

  // 🛒 3. BOUCLE SUR LES ARTICLES DU TICKET
  for (const item of articles) {
    // Sécurité : si l'IA n'a pas réussi à lire le prix, on ignore l'article
    if (!item.prix) {
      console.log(`\n\x1b[33m⚠️ Article ignoré (prix illisible) : "${item.nom}"\x1b[0m`);
      continue;
    }

    // Conversion du format français "X,YY" en nombre JavaScript
    const pTicket = parseFloat(item.prix.replace(',', '.'));
    if (isNaN(pTicket)) continue;

    totalTicketOriginal += pTicket;

    console.log(`\n🔎 \x1b[1mRecherche : "${item.nom}"\x1b[0m (${pTicket.toFixed(2).replace('.', ',')}€)`);
    const results = {};

    // ⚡ NOUVEAU : PARALLÉLISATION DES SCRAPERS
    // Au lieu d'attendre chaque supermarché l'un après l'autre, on lance tout en même temps !
    const scraperPromises = Object.entries(scrapers).map(async ([name, scraperFn]) => {
      try {
        const res = await scraperFn(browser, item.nom);
        
        // NB : La validation du titre (validateTitle) est déjà faite à l'intérieur de tes scrapers, 
        // pas besoin de la refaire ici.
        if (res && res.status === 'found') {
          const scrapedPrix = parseFloat(res.product.prix.replace(',', '.'));
          
          // TA RÈGLE DES 30% DE DIFFÉRENCE MAX
          const differenceRatio = Math.abs(scrapedPrix - pTicket) / pTicket;
          
          if (differenceRatio <= 0.30) {
            results[name] = { titre: res.product.titre, prix: scrapedPrix };
          } else {
            console.log(`   \x1b[33m⚠️ [${name}] Rejeté : Prix trop différent (${scrapedPrix.toFixed(2)}€ au lieu de ${pTicket.toFixed(2)}€)\x1b[0m`);
          }
        }
      } catch (e) { 
        console.log(`   \x1b[31m⚠️ Erreur scraper [${name}] : ${e.message}\x1b[0m`); 
      }
    });

    // On attend que TOUS les supermarchés aient fini de chercher ce produit
    await Promise.all(scraperPromises);

    // 🧮 4. CALCULS ET FALLBACK
    for (const name of Object.keys(scrapers)) {
      if (results[name]) {
        // Trouvé et validé !
        totauxMagasins[name] += results[name].prix;
      } else {
        // Introuvable ou rejeté -> Fallback au prix du ticket
        totauxMagasins[name] += pTicket;
      }
    }

    // Affichage du meilleur prix pour cet article
    const magasinsTrouves = Object.keys(results);
    if (magasinsTrouves.length > 0) {
      const sorted = magasinsTrouves.sort((a, b) => results[a].prix - results[b].prix);
      const best = results[sorted[0]];
      console.log(`   🏆 Moins cher trouvé chez : \x1b[32m${sorted[0].toUpperCase()}\x1b[0m (${best.prix.toFixed(2).replace('.', ',')}€) -> "${best.titre}"`);
    } else {
      console.log(`   \x1b[31m❌ Introuvable partout\x1b[0m (On garde le prix de base : ${pTicket.toFixed(2).replace('.', ',')}€)`);
    }
  }

  // Fermeture propre du navigateur
  await browser.close();

  // 🏆 5. LE GRAND CLASSEMENT FINAL !
  console.log('\n\x1b[44m\x1b[37m=========================================\x1b[0m');
  console.log('\x1b[1m🛒 BILAN DES COURSES (Total des paniers)\x1b[0m');
  console.log('\x1b[44m\x1b[37m=========================================\x1b[0m');
  console.log(`🧾 Ticket original : \x1b[1m${totalTicketOriginal.toFixed(2).replace('.', ',')}€\x1b[0m\n`);
  
  // Tri du moins cher au plus cher
  const classementFinal = Object.keys(totauxMagasins).sort((a, b) => totauxMagasins[a] - totauxMagasins[b]);
  
  for (let i = 0; i < classementFinal.length; i++) {
    const magasin = classementFinal[i];
    const total = totauxMagasins[magasin];
    const diff = totalTicketOriginal - total;
    
    // Formatage avec des couleurs pour rendre le verdict lisible
    const isWinner = i === 0 && diff > 0;
    const prefix = isWinner ? '🥇' : '🏪';
    const color = diff > 0 ? '\x1b[32m' : (diff < 0 ? '\x1b[31m' : '\x1b[33m');
    
    let message = `${prefix} ${magasin.toUpperCase().padEnd(10)} : \x1b[1m${total.toFixed(2).replace('.', ',')}€\x1b[0m`;
    
    if (diff > 0) {
      message += ` ${color}(💡 Économie : ${diff.toFixed(2).replace('.', ',')}€)\x1b[0m`;
    } else if (diff < 0) {
      message += ` ${color}(💸 Perte : ${Math.abs(diff).toFixed(2).replace('.', ',')}€)\x1b[0m`;
    } else {
      message += ` ${color}(⚖️ Prix identique)\x1b[0m`;
    }
    
    console.log(message);
  }
  console.log('\x1b[44m\x1b[37m=========================================\x1b[0m\n');

})();