const { chromium } = require('playwright');

(async () => {
  // 1. On lance le navigateur en mode "visible" (headless: false) 
  // pour que vous voyiez le robot travailler en direct à l'écran !
  const browser = await chromium.launch({ headless: false });
  
  // Astuce de sioux : on se fait passer pour un vrai utilisateur Windows/Chrome
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  try {
    console.log("🚀 Étape 1 : Ouverture du site Carrefour...");
    await page.goto('https://www.carrefour.fr/', { waitUntil: 'domcontentloaded' });

    console.log("🍪 Étape 2 : Gestion de la bannière de cookies...");
    try {
      // On attend maximum 3 secondes pour voir si le bouton "Accepter" apparaît
      await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 3000 });
      await page.click('#onetrust-accept-btn-handler');
    } catch (e) {
      console.log("  -> Pas de bannière détectée ou déjà acceptée.");
    }

    console.log("🔍 Étape 3 : Recherche du mot 'Nutella'...");
    // On cible la barre de recherche (souvent un input avec le nom 'q')
    await page.fill('input[name="q"]', 'Nutella');
    await page.press('input[name="q"]', 'Enter');

    console.log("⏳ Attente du chargement des produits...");
    // On attend que les "cartes" de produits apparaissent sur la page
    await page.waitForSelector('article', { timeout: 10000 });

    console.log("🎯 Étape 4 : Extraction du premier résultat...");
    const premierProduit = page.locator('article').first();
    
    // ATTENTION : Les classes CSS changent souvent sur ces sites. 
    // Il faudra inspecter le site de Carrefour (F12) si ces sélecteurs ne marchent plus.
    const titre = await premierProduit.locator('h2, .product-card-title').first().innerText();
    const prix = await premierProduit.locator('.product-price__amount-value, .price').first().innerText();

    console.log("\n✅ BINGO ! Voici ce qu'on a trouvé :");
    console.log(`   🛒 Produit : ${titre.trim()}`);
    console.log(`   💶 Prix    : ${prix.trim()} €\n`);

  } catch (error) {
    console.error("\n❌ Aïe, le robot a trébuché. Voici l'erreur :");
    console.error(error.message);
    console.log("C'est peut-être l'anti-bot (Datadome) qui nous a bloqués, ou le design du site a changé !");
  } finally {
    // On laisse la fenêtre ouverte 5 secondes pour que vous ayez le temps d'admirer (ou de pleurer)
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();