const { normalizePrice } = require('../utils/helpers');

const scrapeMonoprix = async (browser, article, targetPrice) => {
  const query = article.recherche_optimisee;

  const clean = (str) => {
    if (!str) return "";
    return str.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/œ/g, "oe")
      .replace(/s\b/g, "") 
      .replace(/[^a-z0-9 ]/g, " ")
      .trim();
  };

  const fetchMonoprix = async (searchString) => {
    const url = `https://courses.monoprix.fr/api/webproductpagews/v6/product-pages/search?includeAdditionalPageInfo=true&maxPageSize=300&maxProductsToDecorate=50&tag=web&q=${encodeURIComponent(searchString)}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Origin': 'https://courses.monoprix.fr'
        }
      });
      return response.ok ? await response.json() : null;
    } catch (e) {
      return null;
    }
  };

  const getProductsFromData = (data) => {
    let prods = [];
    if (data?.productGroups) {
      data.productGroups.forEach(g => { if (g.decoratedProducts) prods.push(...g.decoratedProducts); });
    }
    return prods;
  };

  try {
    let data = await fetchMonoprix(query);
    let products = getProductsFromData(data);

    if (products.length === 0) {
      const simple = query.split(' ').filter(w => w.length > 2 && isNaN(w)).slice(0, 2).join(' ');
      if (simple) {
        data = await fetchMonoprix(simple);
        products = getProductsFromData(data);
      }
    }

    if (products.length === 0) return { status: 'not_found' };

    const queryWords = clean(query).split(' ').filter(w => w.length > 2 && isNaN(w));
    const firstWordMandatory = queryWords[0];

    let meilleurProduit = null;
    let meilleureDifference = Infinity;

    for (let i = 0; i < Math.min(25, products.length); i++) {
      const p = products[i];
      const titreOrig = p.title || p.name || "Sans Nom";
      const tClean = clean(titreOrig);
      
      const rawPrice = p.pricing?.price || p.price;
      const rawUnitPrice = p.pricing?.unitPrice || p.unitPrice;
      let prix = normalizePrice(rawPrice);
      const unit = normalizePrice(rawUnitPrice);

      if (!prix) continue;

      if (article.poids_kg && unit && unit > 0) {
        prix = Number((article.poids_kg * unit).toFixed(2));
      }

      const diff = Math.abs(prix - targetPrice) / targetPrice;
      const categoryMatch = firstWordMandatory ? tClean.includes(firstWordMandatory) : true;
      const motsPresents = queryWords.filter(w => tClean.includes(w));
      const textScore = queryWords.length === 0 ? 1 : (motsPresents.length / queryWords.length);

      if (categoryMatch && diff <= 0.45 && textScore >= 0.33) {
        if (diff < meilleureDifference) {
          meilleureDifference = diff;
          meilleurProduit = { titre: titreOrig, prix };
        }
      }
    }

    return meilleurProduit ? { status: 'found', product: meilleurProduit } : { status: 'not_found' };

  } catch (error) {
    return { status: 'not_found' };
  }
};

module.exports = scrapeMonoprix;