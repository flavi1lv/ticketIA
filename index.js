const { chromium } = require('playwright');

(async () => {
  console.log("⚡ Mode Turbo activé (Sans fenêtre)...");

  const browser = await chromium.launch({ 
    headless: true, // ON ENLÈVE LA VISION ICI
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // MEGA OPTIMISATION : On bloque tout ce qui est lourd
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      // On bloque même les feuilles de style (CSS) pour n'avoir que le texte pur
      route.abort();
    } else {
      route.continue();
    }
  });

  try {
    console.log("🚀 Accès direct aux résultats (sans images)...");
    
    // On va directement sur la page de recherche
    await page.goto('https://www.carrefour.fr/s?q=Nutella+825g', { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
    });

    console.log("⏳ Lecture du code source...");

    // On attend que l'élément soit présent dans le HTML (même s'il n'est pas "beau")
    const selector = 'article, [data-testid="product-card"]';
    await page.waitForSelector(selector, { state: 'attached', timeout: 30000 });

    // Extraction chirurgicale
    const produit = await page.evaluate(() => {
      const first = document.querySelector('article, [data-testid="product-card"]');
      if (!first) return null;

      // On cherche les textes à l'intérieur
      return {
        titre: first.innerText.split('\n')[0], // On prend souvent la 1ère ligne
        contenu: first.innerText.replace(/\s+/g, ' ') // On nettoie les espaces
      };
    });

    if (produit) {
      console.log("\n✅ DONNÉES RÉCUPÉRÉES :");
      console.log(`📝 Brut : ${produit.contenu.substring(0, 150)}...`);
    } else {
      console.log("❌ Rien trouvé dans le code.");
    }

  } catch (error) {
    console.error("\n❌ Erreur de chargement :", error.message);
  } finally {
    await browser.close();
    console.log("🏁 Navigateur fermé.");
  }
})();