const { validateTitle, normalizePrice, withRetry, sleep } = require('../utils/helpers');

const scrapeCarrefour = async (browser, searchQuery) => {
  return await withRetry(async () => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR',
      extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9' }
    });
    
    const page = await context.newPage();

    try {
      // ⚡ Optimisation : on bloque le chargement des images et styles
      await page.route('**/*', route => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(type)) route.abort();
        else route.continue();
      });

      // 🧠 L'ARME SECRÈTE (Issue du GitHub) : L'écouteur d'API
      const capturedProducts = [];
      const responseHandler = async (response) => {
        try {
          const url = response.url();
          // On intercepte les requêtes de recherche de Carrefour
          if (url.includes('/api/v1/search') || url.includes('search-api')) {
            const json = await response.json();
            const items = json?.data?.search?.products || json?.data?.products || json?.products || [];
            items.forEach(item => {
              capturedProducts.push({
                titre: item.name || item.label || item.title || '',
                rawPrice: item.price?.amount || item.price?.value || item.prices?.v3?.salePrice?.amount || ''
              });
            });
          }
        } catch (e) { /* Ignoré silencieusement pour ne pas polluer la console */ }
      };

      // On active l'écouteur juste avant d'aller sur la page
      page.on('response', responseHandler);

      // 🧹 ASTUCE : On retire les poids/volumes pour la barre de recherche (ex: "Nutella 1kg" -> "Nutella")
      const searchTxt = searchQuery.replace(/\b\d+([.,]\d+)?\s*(g|kg|l|cl|ml)\b/gi, '').trim();
      const url = `https://www.carrefour.fr/s?q=${encodeURIComponent(searchTxt || searchQuery)}&sort=relevance`;
      
      console.log(`   🌐 [CARREFOUR] Lien : ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('#onetrust-accept-btn-handler').click({ timeout: 2000 }).catch(() => {});
      
      await page.waitForSelector('[data-testid="product-card"], article', { timeout: 10000 }).catch(() => {});
      await sleep(1500);

      // On désactive l'écouteur pour libérer la mémoire
      page.off('response', responseHandler);

      // 🚀 TENTATIVE 1 : VIA L'API INTERCEPTÉE (Priorité)
      if (capturedProducts.length > 0) {
        for (const p of capturedProducts) {
          const prix = normalizePrice(p.rawPrice);
          // 🚨 On valide le titre avec la requête D'ORIGINE complète (qui contient le poids !)
          if (prix && validateTitle(p.titre, searchQuery)) {
            const textToAnalyze = (p.rawPrice + " " + p.titre).toLowerCase();
            const isKg = textToAnalyze.includes('/kg') || textToAnalyze.includes('le kg');
            return { status: 'found', product: { titre: p.titre, prix, unitPrice: prix, isKg } };
          }
        }
      }

      // 🐢 TENTATIVE 2 : VIA LE DOM (Fallback si l'API a changé ou n'a pas répondu)
      const products = await page.evaluate(() => {
        const selectors = ['[data-testid="product-card"]', 'article[class*="product"]', 'a[class*="product-card"]'];
        for (const sel of selectors) {
          const cards = document.querySelectorAll(sel);
          if (cards.length > 0) {
            return Array.from(cards).slice(0, 15).map(el => {
              const titleEl = el.querySelector('h2, h3, [class*="title"], [class*="name"]');
              const priceEl = el.querySelector('[class*="price"], [itemprop="price"]');
              return { 
                titre: titleEl?.innerText?.trim() || '', 
                rawPrice: priceEl?.innerText?.trim() || '' 
              };
            }).filter(p => p.titre.length > 3 && p.rawPrice);
          }
        }
        return [];
      });

      for (const p of products) {
        const price = normalizePrice(p.rawPrice);
        if (price && validateTitle(p.titre, searchQuery)) {
          const textToAnalyze = (p.rawPrice + " " + p.titre).toLowerCase();
          const isKg = textToAnalyze.includes('/kg') || textToAnalyze.includes('le kg');
          return { status: 'found', product: { titre: p.titre, prix: price, unitPrice: price, isKg } };
        }
      }

      return { status: 'not_found' };

    } finally {
      // Fermeture sécurisée
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }, 2, 2000);
};

module.exports = scrapeCarrefour;