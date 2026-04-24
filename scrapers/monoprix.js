const {
  normalizePrice,
  PRICE_DIFF_THRESHOLD,
  SCORE_THRESHOLD,
  tokenize,
  isQuantityToken,
  scoreSimilarity,
  extractQuantityTokens,
  validateQuantity,
  computePrice,
} = require('../utils/helpers');

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────
const fetchMonoprix = async (searchString) => {
  const url = `https://courses.monoprix.fr/api/webproductpagews/v6/product-pages/search?includeAdditionalPageInfo=true&maxPageSize=300&maxProductsToDecorate=50&tag=web&q=${encodeURIComponent(searchString)}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Origin': 'https://courses.monoprix.fr',
      },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

const getProductsFromData = (data) => {
  const prods = [];
  if (data?.productGroups) {
    data.productGroups.forEach(g => {
      if (g.decoratedProducts) prods.push(...g.decoratedProducts);
    });
  }
  return prods;
};

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
const scrapeMonoprix = async (browser, article, targetPrice) => {
  const query = article.recherche_optimisee;

  try {
    let data     = await fetchMonoprix(query);
    let products = getProductsFromData(data);

    // Fallback : uniquement les tokens sémantiques sans quantité
    if (!products.length) {
      const fallback = tokenize(query)
        .filter(w => w.length > 2 && !isQuantityToken(w))
        .slice(0, 3)
        .join(' ');
      if (fallback) {
        data     = await fetchMonoprix(fallback);
        products = getProductsFromData(data);
      }
    }

    if (!products.length) return { status: 'not_found' };

    // ── SCORING & SÉLECTION ─────────────────────────────────────────────────
    const quantityTokens = extractQuantityTokens(query);
    const isVrac         = !!article.poids_kg && !quantityTokens.length;

    const candidates = products
      .slice(0, 25)
      .map(p => {
        const titreOrig    = p.title || p.name || 'Sans Nom';
        const rawFormat    = p.format || p.quantity || p.packaging || '';
        const rawPrice     = p.pricing?.price     || p.price;
        const rawUnitPrice = p.pricing?.unitPrice  || p.unitPrice;

        const { finalPrice, compareTarget } = computePrice(
          rawPrice, rawUnitPrice, article, targetPrice, isVrac
        );
        const score = scoreSimilarity(titreOrig, query);
        const diff  = finalPrice && compareTarget
          ? Math.abs(finalPrice - compareTarget) / compareTarget
          : Infinity;
        const qtyOk = validateQuantity({ titre: titreOrig, rawFormat }, quantityTokens);

        return { titre: titreOrig, rawFormat, finalPrice, score, diff, qtyOk };
      })
      .filter(p =>
        p.finalPrice               &&
        p.score >= SCORE_THRESHOLD  &&
        p.diff  <= PRICE_DIFF_THRESHOLD &&
        p.qtyOk
      )
      .sort((a, b) => a.diff - b.diff || b.score - a.score);

    if (!candidates.length) {
      const debugInfo = products.slice(0, 10).map(p => {
        const titreOrig = p.title || p.name || 'Sans Nom';
        const rawFormat = p.format || p.quantity || p.packaging || '';
        return {
          titre:  titreOrig,
          format: rawFormat,
          score:  scoreSimilarity(titreOrig, query).toFixed(2),
          price:  normalizePrice(p.pricing?.price || p.price),
          qtyOk:  validateQuantity({ titre: titreOrig, rawFormat }, quantityTokens),
        };
      });
      console.log(JSON.stringify({
        scraper: 'monoprix', query,
        msg: 'no_valid_candidate',
        ts: new Date().toISOString(),
        quantityTokens, debugInfo,
      }));
      return { status: 'not_found', reason: 'no_match', debug: debugInfo };
    }

    const best = candidates[0];
    return {
      status: 'found',
      product: { titre: best.titre, prix: best.finalPrice },
    };

  } catch {
    return { status: 'not_found' };
  }
};

scrapeMonoprix.requiresBrowser = false;

module.exports = scrapeMonoprix;