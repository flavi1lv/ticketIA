const { validateTitle, normalizePrice, sleep, withRetry } = require('../utils/helpers');

// Auchan expose une API Algolia publique — pas besoin de scraper le DOM
const ALGOLIA_APP_ID  = 'AUCHAN_ECOM_PROD';
const ALGOLIA_API_KEY = 'NmZiODU4YjM4OTY3MTQ5NWI4MzVmMjYzMDE0ZGZkNzU';
const ALGOLIA_INDEX   = 'prod_auchan_ecom';

// Parsing récursif pour trouver les produits dans n'importe quelle structure JSON
const extractProductsFromJson = (obj, results = [], depth = 0) => {
  if (depth > 8 || !obj || typeof obj !== 'object' || results.length >= 10) return results;

  const hasName =
    typeof obj.name === 'string' ||
    typeof obj.title === 'string' ||
    typeof obj.label === 'string';

  const priceValue =
    obj.price ?? obj.salePrice ?? obj.pricePerUnit ??
    obj.sellPrice ?? obj.currentPrice ?? obj.unitPrice ??
    obj.prices?.normal ?? obj.priceData?.amount ?? null;

  if (hasName && priceValue !== null && priceValue !== undefined) {
    results.push({
      titre: String(obj.name ?? obj.title ?? obj.label).slice(0, 200),
      rawPrice: String(priceValue),
    });
    return results;
  }

  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) val.forEach((v) => extractProductsFromJson(v, results, depth + 1));
    else if (val && typeof val === 'object') extractProductsFromJson(val, results, depth + 1);
  }

  return results;
};

const scrapeAuchan = async (browser, searchQuery) => {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9' },
  });
  const page = await context.newPage();

  // Ne bloque que le visuel, les XHR passent
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  try {
    return await withRetry(async () => {
      console.log(`🚀 [Auchan] Recherche de "${searchQuery}"...`);

      // ── Stratégie 1 : API Algolia (appelée depuis le contexte page) ──────────
      console.log('   🔌 [Auchan] Tentative API Algolia...');

      const algoliaResult = await page.evaluate(
        async ({ appId, apiKey, index, query }) => {
          try {
            const response = await fetch(
              `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/${index}/query`,
              {
                method: 'POST',
                headers: {
                  'X-Algolia-Application-Id': appId,
                  'X-Algolia-API-Key': apiKey,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  query,
                  hitsPerPage: 10,
                  attributesToRetrieve: ['name', 'title', 'label', 'price', 'salePrice', 'pricePerUnit', 'brand', 'volume', 'weight'],
                }),
              }
            );
            if (!response.ok) return { success: false, status: response.status };
            const data = await response.json();
            return { success: true, data };
          } catch (err) {
            return { success: false, error: err.message };
          }
        },
        { appId: ALGOLIA_APP_ID, apiKey: ALGOLIA_API_KEY, index: ALGOLIA_INDEX, query: searchQuery }
      );

      if (algoliaResult.success && algoliaResult.data?.hits?.length > 0) {
        console.log(`   ✅ [Auchan] API Algolia OK — ${algoliaResult.data.hits.length} résultat(s)`);
        for (const hit of algoliaResult.data.hits.slice(0, 5)) {
          const titre = (hit.name ?? hit.title ?? hit.label ?? '').slice(0, 200);
          const rawPrice = String(hit.price ?? hit.salePrice ?? hit.pricePerUnit ?? '');
          const prix = normalizePrice(rawPrice);
          if (prix && validateTitle(titre, searchQuery)) {
            console.log(`✅ [Auchan] "${titre}" → ${prix}€`);
            return { status: 'found', product: { titre, prix } };
          }
        }
        const titles = algoliaResult.data.hits.map((h) => h.name ?? h.title ?? '?');
        console.log(`❌ [Auchan] Algolia OK mais aucun match. Vus : ${titles.slice(0, 3).join(' | ')}`);
        return { status: 'not_found', titles };
      }

      console.log(`   ⚠️  [Auchan] Algolia non disponible (${algoliaResult.status ?? algoliaResult.error ?? 'inconnu'}) — fallback scraping DOM`);

      // ── Stratégie 2 : Scraping DOM de la page de recherche ───────────────────
      const searchUrl = `https://www.auchan.fr/recherche?text=${encodeURIComponent(searchQuery)}`;
      console.log(`   🌐 [Auchan] GET ${searchUrl}`);

      // Capture des réponses JSON pendant la navigation
      const capturedProducts = [];
      const responseHandler = async (response) => {
        const url = response.url();
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('application/json') || response.status() !== 200) return;
        if (!url.includes('algolia') && !url.includes('search') && !url.includes('product')) return;
        try {
          const json = await response.json();
          capturedProducts.push(...extractProductsFromJson(json));
        } catch { /* ignore */ }
      };
      page.on('response', responseHandler);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Attend le chargement des produits JS
      const cardSelectors = [
        '[class*="product-thumbnail"]',
        '[class*="ProductCard"]',
        '[class*="product-card"]',
        '[data-testid="product-card"]',
        'article[class*="product"]',
        '[class*="product-item"]',
        'li[class*="product"]',
      ];

      let cardSelector = null;
      for (const sel of cardSelectors) {
        try {
          await page.waitForSelector(sel, { state: 'attached', timeout: 8000 });
          cardSelector = sel;
          break;
        } catch { /* essaie suivant */ }
      }

      // Laisse un peu de temps aux XHR de se terminer
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch {
        await sleep(3000);
      }

      page.off('response', responseHandler);

      // Données capturées via XHR ?
      if (capturedProducts.length > 0) {
        console.log(`   📡 [Auchan] ${capturedProducts.length} produit(s) via XHR`);
        for (const produit of capturedProducts.slice(0, 5)) {
          const prix = normalizePrice(produit.rawPrice);
          if (prix && validateTitle(produit.titre, searchQuery)) {
            console.log(`✅ [Auchan] "${produit.titre}" → ${prix}€`);
            return { status: 'found', product: { titre: produit.titre, prix } };
          }
        }
      }

      // Fallback DOM
      if (cardSelector) {
        console.log(`   🔍 [Auchan] Extraction DOM avec "${cardSelector}"...`);

        const productsData = await page.evaluate((sel, PRICE_STR) => {
          const PRICE_RE = new RegExp(PRICE_STR);
          return Array.from(document.querySelectorAll(sel))
            .slice(0, 5)
            .map((el) => {
              // Prix
              const priceEl = el.querySelector(
                '[class*="price"], [class*="Price"], [class*="prix"], ' +
                '[itemprop="price"], [data-testid*="price"]'
              );
              let rawPrice = priceEl ? priceEl.textContent.trim() : '';
              if (!rawPrice) {
                const m = el.textContent.replace(/\s+/g, ' ').match(/(\d{1,3}[,.]\d{2})\s*€/);
                if (m) rawPrice = m[0];
              }

              // Titre (exclut les éléments de prix)
              const titleCandidates = Array.from(
                el.querySelectorAll('[class*="title"], [class*="name"], [class*="label"], h2, h3, h4')
              );
              let titre = '';
              for (const c of titleCandidates) {
                const t = c.textContent.replace(/\s+/g, ' ').trim();
                if (t.length > 5 && !PRICE_RE.test(t)) { titre = t; break; }
              }
              if (!titre) {
                const lines = el.textContent.split('\n')
                  .map((l) => l.replace(/\s+/g, ' ').trim())
                  .filter((l) => l.length > 5 && !PRICE_RE.test(l));
                titre = lines[0] || '';
              }
              return { titre: titre.slice(0, 200), rawPrice };
            })
            .filter((p) => p.titre.length > 3);
        }, cardSelector, '^\\s*\\d{1,4}[,.\\s]\\d{2}\\s*€?\\s*$');

        for (const produit of productsData) {
          const prix = normalizePrice(produit.rawPrice);
          if (prix && validateTitle(produit.titre, searchQuery)) {
            console.log(`✅ [Auchan] "${produit.titre}" → ${prix}€`);
            return { status: 'found', product: { titre: produit.titre, prix } };
          }
        }

        const titles = productsData.map((p) => `"${p.titre.slice(0, 60)}" (prix: "${p.rawPrice}")`);
        console.log(`❌ [Auchan] Aucun match :\n   ${titles.join('\n   ')}`);
        return { status: 'not_found', titles };
      }

      console.log('❌ [Auchan] Aucun produit trouvé.');
      return { status: 'not_found', titles: [] };
    });
  } catch (error) {
    console.error(`💥 [Auchan] ${error.message}`);
    return { status: 'error', message: error.message };
  } finally {
    await page.close();
    await context.close();
  }
};

module.exports = scrapeAuchan;