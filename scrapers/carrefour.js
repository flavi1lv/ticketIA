const { validateTitle, normalizePrice, withRetry, sleep } = require('../utils/helpers');

const scrapeCarrefour = async (browser, searchQuery) => {
  return await withRetry(async () => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR'
    });
    
    const page = await context.newPage();

    try {
      // ⚡ Bloquer les images pour gagner du temps
      await page.route('**/*', route => {
        const type = route.request().resourceType();
        if (['image', 'media'].includes(type)) route.abort(); // On laisse le CSS/Font pour DataDome
        else route.continue();
      });

      let searchTxt = searchQuery
        .replace(/\b\d+([.,]\d+)?\s*(g|kg|l|cl|ml)\b/gi, '') // Enlève les poids (600g, 1.5L)
        .replace(/\bx\s*\d+\b/gi, '') // Enlève les multiplicateurs (x10, x 6)
        .replace(/\b\d+\s*x\b/gi, '') // Enlève les multiplicateurs inversés (10x, 6 x)
        .replace(/\s+/g, ' ') // Nettoie les doubles espaces
        .trim();

      const query = searchTxt || searchQuery;
      const url = `https://www.carrefour.fr/s?q=${encodeURIComponent(query)}&sort=relevance`;

      console.log(`   🌐 [CARREFOUR] Navigation Playwright vers : ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // On clique sur les cookies si la modale apparaît
      await page.locator('#onetrust-accept-btn-handler').click({ timeout: 2000 }).catch(() => {});
      
      // On attend une carte produit
      await page.waitForSelector('[data-testid="product-card"], article, ul > li, .product-grid-item', { timeout: 10000 }).catch(() => {});
      await sleep(1500);

      // 🕵️‍♂️ L'EXTRACTION "CHALUTIER"
      const products = await page.evaluate(() => {
        const cards = document.querySelectorAll('[data-testid="product-card"], article, a[href*="/p/"], li[class*="Product"]');
        
        return Array.from(cards).slice(0, 10).map(el => {
          // 1. On cherche le titre visuel principal
          const titleEl = el.querySelector('h2, h3, [class*="title"], [class*="name"]');
          let mainTitle = titleEl ? titleEl.innerText.trim() : '';

          // 2. On cherche le texte de l'image (nom SEO ultra complet qui ne disparaît pas)
          const imgEl = el.querySelector('img');
          const imgAlt = imgEl ? imgEl.getAttribute('alt') || '' : '';

          // 3. On prend TOUT le texte de la carte (pour choper les "600g" qui traînent)
          const fullText = el.innerText || '';

          // 4. On fusionne tout en un seul super-titre pour notre IA
          const titre = `${mainTitle} ${imgAlt} ${fullText}`.replace(/\n/g, ' ');

          // 5. On cherche le prix
          const priceEl = el.querySelector('[class*="price"], [itemprop="price"], [class*="amount"]');
          let rawPrice = priceEl ? priceEl.innerText.trim() : '';

          if (!rawPrice) {
               const priceMatch = fullText.match(/\d+[.,]\d{2}\s*€/);
               if (priceMatch) rawPrice = priceMatch[0];
          }

          // On renvoie un titre raccourci juste pour un affichage propre dans ta console
          const titreAffichage = mainTitle || imgAlt || 'Produit';

          return { titre, titreAffichage, rawPrice };
        }).filter(p => p.titre && p.rawPrice);
      });

      console.log(`   🐛 [DEBUG] Carrefour a vu ${products.length} produits à l'écran.`);

      for (const p of products) {
        const prix = normalizePrice(p.rawPrice);
        
        // 🚨 On valide le produit en comparant avec la requête D'ORIGINE (qui contient "x10 600g")
        if (prix && validateTitle(p.titre, searchQuery)) {
          const textToAnalyze = (p.rawPrice + " " + p.titre).toLowerCase();
          const isKg = textToAnalyze.includes('/kg') || textToAnalyze.includes('le kg');
          
          // On retourne le "titreAffichage" pour que ta console soit jolie
          return { status: 'found', product: { titre: p.titreAffichage, prix, unitPrice: prix, isKg } };
        }
      }

      return { status: 'not_found' };

    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }, 2, 2000);
};

module.exports = scrapeCarrefour;