/* =========================================================================
   extract.js — crawl a page's HTML and auto-generate JSON-LD structured data.
   Zero dependencies. Pure functions so they can be unit-tested without a network.

   Pipeline:  extractMetadata(html,url) -> detectType(meta,url) -> buildJsonLd(...)
   Public:    generateForPage(html, url, opts) -> full result object
   ========================================================================= */

/* ---------------- small HTML helpers ---------------- */
function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .trim();
}
function stripTags(s = '') { return decodeEntities(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')); }
function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'))
        || tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
  return m ? decodeEntities(m[1]) : '';
}
function absolutize(href, base) {
  if (!href) return '';
  try { return new URL(href, base).href; } catch { return href; }
}

/* ---------------- metadata extraction ---------------- */
export function extractMetadata(html, pageUrl = '') {
  const meta = {
    url: pageUrl, canonical: '', title: '', h1: '', description: '',
    og: {}, twitter: {}, article: {}, product: {}, itemprop: {},
    author: '', siteName: '', ogType: '', image: '', lang: '',
    price: '', currency: '', availability: '', sku: '', brand: '',
    jsonLd: [], jsonLdTypes: [], generator: '',
  };

  // <html lang>
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag) meta.lang = attr(htmlTag[0], 'lang');

  // <title>
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) meta.title = stripTags(t[1]);

  // first <h1>
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) meta.h1 = stripTags(h1[1]);

  // <link rel="canonical">
  const links = html.match(/<link[^>]*>/gi) || [];
  for (const l of links) {
    const rel = attr(l, 'rel').toLowerCase();
    if (rel === 'canonical') meta.canonical = absolutize(attr(l, 'href'), pageUrl);
  }

  // <meta> tags
  const metas = html.match(/<meta[^>]*>/gi) || [];
  for (const m of metas) {
    const prop = (attr(m, 'property') || '').toLowerCase();
    const name = (attr(m, 'name') || '').toLowerCase();
    const ip = (attr(m, 'itemprop') || '').toLowerCase();
    const content = attr(m, 'content');
    if (!content && !ip) continue;
    if (prop.startsWith('og:')) meta.og[prop.slice(3)] = content;
    else if (prop.startsWith('article:')) meta.article[prop.slice(8)] = content;
    else if (prop.startsWith('product:')) meta.product[prop.slice(8)] = content;
    else if (name.startsWith('twitter:')) meta.twitter[name.slice(8)] = content;
    else if (name === 'description') meta.description = content;
    else if (name === 'author') meta.author = content;
    else if (name === 'generator') meta.generator = content;
    if (ip) meta.itemprop[ip] = content || attr(m, 'href');
  }

  // existing JSON-LD blocks
  const ld = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ld) {
    const body = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    try {
      let parsed = JSON.parse(body);
      const arr = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const node of arr) {
        if (node && node['@type']) {
          meta.jsonLd.push(node);
          [].concat(node['@type']).forEach(ty => meta.jsonLdTypes.push(ty));
        }
      }
    } catch { /* malformed LD — ignore */ }
  }

  // consolidate common fields
  meta.ogType     = (meta.og.type || '').toLowerCase();
  meta.siteName   = meta.og.site_name || '';
  meta.image      = absolutize(meta.og.image || meta.twitter.image || meta.itemprop.image || '', pageUrl);
  meta.description= meta.description || meta.og.description || meta.twitter.description || '';
  meta.author     = meta.author || meta.article.author || '';
  meta.price      = meta.product.price_amount || meta.product['price:amount'] || meta.og['price:amount'] || meta.itemprop.price || '';
  meta.currency   = meta.product.price_currency || meta.product['price:currency'] || meta.og['price:currency'] || meta.itemprop.pricecurrency || '';
  meta.availability = meta.product.availability || meta.og.availability || meta.itemprop.availability || '';
  meta.sku        = meta.itemprop.sku || '';
  meta.brand      = meta.itemprop.brand || '';
  meta.canonical  = meta.canonical || meta.og.url || pageUrl;
  return meta;
}

/* ---------------- schema-type detection ---------------- */
const PRIMARY_LD_TYPES = new Set([
  'Product','Article','BlogPosting','NewsArticle','Recipe','FAQPage','HowTo','Event',
  'JobPosting','Course','LocalBusiness','Restaurant','Store','VideoObject','Person',
  'Book','Movie','SoftwareApplication','MedicalClinic','Physician','LegalService',
]);

export function detectType(meta, pageUrl = '') {
  const reasons = [];
  let path = '/';
  try { path = new URL(pageUrl).pathname; } catch {}

  // 1) strongest: an existing primary JSON-LD type already on the page
  const existingPrimary = meta.jsonLdTypes.find(t => PRIMARY_LD_TYPES.has(t));
  if (existingPrimary) {
    reasons.push(`Page already declares <${existingPrimary}> JSON-LD`);
    return { type: existingPrimary, confidence: 'high', reasons, fromExisting: true };
  }

  // 2) product signals
  if (meta.price || meta.ogType.startsWith('product') || meta.jsonLdTypes.includes('Offer')) {
    reasons.push(meta.price ? `Price metadata found (${meta.price})` : `og:type is "${meta.ogType}"`);
    return { type: 'Product', confidence: meta.price ? 'high' : 'medium', reasons };
  }

  // 3) article signals
  if (meta.ogType === 'article' || meta.article.published_time || (meta.author && meta.article.section)) {
    reasons.push(meta.ogType === 'article' ? 'og:type is "article"' : 'article:published_time present');
    const type = /blog/i.test(path) ? 'BlogPosting' : 'Article';
    return { type, confidence: 'high', reasons };
  }

  // 4) media
  if (meta.ogType.startsWith('video')) { reasons.push('og:type is video'); return { type: 'VideoObject', confidence: 'medium', reasons }; }
  if (meta.ogType === 'book')          { reasons.push('og:type is book');  return { type: 'Book', confidence: 'medium', reasons }; }
  if (meta.ogType === 'profile')       { reasons.push('og:type is profile'); return { type: 'Person', confidence: 'medium', reasons }; }

  // 5) homepage → Organization + WebSite
  if (path === '/' || path === '') {
    reasons.push('Homepage (root path) — best represented as Organization + WebSite');
    return { type: 'Organization', confidence: 'medium', reasons };
  }

  // 6) contact / about pages
  if (/contact/i.test(path)) { reasons.push('URL looks like a contact page'); return { type: 'LocalBusiness', confidence: 'low', reasons }; }
  if (/about/i.test(path))   { reasons.push('URL looks like an about page');   return { type: 'AboutPage', confidence: 'low', reasons }; }

  // 7) fallback
  reasons.push('No strong signals — using generic WebPage');
  return { type: 'WebPage', confidence: 'low', reasons };
}

/* ---------------- JSON-LD builders ---------------- */
const PH = k => `YOUR_${k}`;
function pick(...vals) { for (const v of vals) if (v && String(v).trim()) return String(v).trim(); return ''; }
function orPlaceholder(val, key) { return pick(val) || PH(key); }
function normAvailability(a = '') {
  a = a.toLowerCase();
  if (a.includes('instock') || a.includes('in stock') || a.includes('in_stock')) return 'https://schema.org/InStock';
  if (a.includes('outofstock') || a.includes('out of stock')) return 'https://schema.org/OutOfStock';
  if (a.includes('preorder')) return 'https://schema.org/PreOrder';
  if (a) return 'https://schema.org/' + a.replace(/[^a-z]/gi, '');
  return 'https://schema.org/InStock';
}

function titleCase(s) { return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export function buildBreadcrumb(meta, pageUrl) {
  let u; try { u = new URL(pageUrl); } catch { return null; }
  const segs = u.pathname.split('/').filter(Boolean);
  const items = [{ '@type': 'ListItem', position: 1, name: 'Home', item: u.origin + '/' }];
  let acc = u.origin;
  segs.forEach((seg, i) => {
    acc += '/' + seg;
    const name = titleCase(decodeURIComponent(seg).replace(/\.[a-z]+$/i, ''));
    items.push({ '@type': 'ListItem', position: i + 2, name, item: acc });
  });
  if (items.length < 2) return null;
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

export function buildJsonLd(type, meta, pageUrl) {
  const url = pick(meta.canonical, pageUrl);
  const name = pick(meta.og.title, meta.title, meta.h1);
  const desc = pick(meta.description);
  const img = pick(meta.image);
  const base = { '@context': 'https://schema.org', '@type': type };

  switch (type) {
    case 'Product': {
      const o = { ...base, name: orPlaceholder(name, 'PRODUCT_NAME') };
      if (img) o.image = [img];
      if (desc) o.description = desc;
      if (meta.sku) o.sku = meta.sku;
      o.brand = { '@type': 'Brand', name: orPlaceholder(meta.brand || meta.siteName, 'BRAND') };
      o.offers = {
        '@type': 'Offer', url,
        price: orPlaceholder(meta.price, 'PRICE'),
        priceCurrency: orPlaceholder(meta.currency, 'CURRENCY'),
        availability: normAvailability(meta.availability),
        itemCondition: 'https://schema.org/NewCondition',
      };
      return o;
    }
    case 'Article': case 'BlogPosting': case 'NewsArticle': {
      const o = { ...base, headline: orPlaceholder(name, 'HEADLINE') };
      if (img) o.image = [img];
      o.author = { '@type': 'Person', name: orPlaceholder(meta.author, 'AUTHOR_NAME') };
      o.publisher = { '@type': 'Organization', name: orPlaceholder(meta.siteName, 'PUBLISHER'),
        logo: { '@type': 'ImageObject', url: PH('LOGO_URL') } };
      if (meta.article.published_time) o.datePublished = meta.article.published_time;
      else o.datePublished = PH('DATE_PUBLISHED');
      if (meta.article.modified_time) o.dateModified = meta.article.modified_time;
      if (desc) o.description = desc;
      o.mainEntityOfPage = { '@type': 'WebPage', '@id': url };
      if (meta.lang) o.inLanguage = meta.lang;
      return o;
    }
    case 'Organization': {
      const o = { ...base, '@id': (safeOrigin(url)) + '#organization',
        name: orPlaceholder(meta.siteName || meta.title, 'COMPANY_NAME'), url: safeOrigin(url) + '/' };
      if (img) o.logo = { '@type': 'ImageObject', url: img };
      if (desc) o.description = desc;
      o.sameAs = [PH('FACEBOOK_URL'), PH('LINKEDIN_URL'), PH('INSTAGRAM_URL')];
      return o;
    }
    case 'WebSite': {
      return { ...base, '@id': safeOrigin(url) + '#website',
        name: orPlaceholder(meta.siteName || meta.title, 'SITE_NAME'), url: safeOrigin(url) + '/',
        potentialAction: { '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: safeOrigin(url) + '/?s={search_term_string}' },
          'query-input': 'required name=search_term_string' } };
    }
    case 'LocalBusiness': case 'Restaurant': case 'Store': case 'MedicalClinic': case 'Physician': case 'LegalService': {
      const o = { ...base, '@id': safeOrigin(url) + '#localbusiness',
        name: orPlaceholder(meta.siteName || name, 'BUSINESS_NAME'), url };
      if (img) o.image = img;
      o.telephone = PH('PHONE');
      o.address = { '@type': 'PostalAddress', streetAddress: PH('STREET'), addressLocality: PH('CITY'),
        addressRegion: PH('REGION'), postalCode: PH('POSTAL_CODE'), addressCountry: PH('COUNTRY_CODE') };
      if (desc) o.description = desc;
      o.priceRange = PH('PRICE_RANGE');
      return o;
    }
    case 'VideoObject': {
      const o = { ...base, name: orPlaceholder(name, 'VIDEO_TITLE'),
        description: orPlaceholder(desc, 'VIDEO_DESCRIPTION'),
        thumbnailUrl: [img || PH('THUMBNAIL_URL')], uploadDate: PH('UPLOAD_DATE') };
      if (meta.og['video:url'] || meta.og.video) o.contentUrl = meta.og['video:url'] || meta.og.video;
      return o;
    }
    case 'Person': {
      const o = { ...base, name: orPlaceholder(name, 'FULL_NAME'), url };
      if (img) o.image = img;
      if (desc) o.description = desc;
      o.sameAs = [PH('LINKEDIN_URL'), PH('TWITTER_URL')];
      return o;
    }
    case 'Book': {
      const o = { ...base, name: orPlaceholder(name, 'BOOK_TITLE'),
        author: { '@type': 'Person', name: orPlaceholder(meta.author, 'AUTHOR_NAME') } };
      if (img) o.image = img;
      if (desc) o.description = desc;
      return o;
    }
    case 'AboutPage': case 'ContactPage': case 'WebPage': default: {
      const o = { ...base, name: orPlaceholder(name, 'PAGE_TITLE'), url };
      if (desc) o.description = desc;
      if (meta.lang) o.inLanguage = meta.lang;
      return o;
    }
  }
}
function safeOrigin(u) { try { return new URL(u).origin; } catch { return u; } }

/* ---------------- warnings ---------------- */
function collectWarnings(type, jsonld, meta) {
  const w = [];
  const flat = JSON.stringify(jsonld);
  const placeholders = [...new Set((flat.match(/YOUR_[A-Z_]+/g) || []))];
  if (placeholders.length) w.push(`Fill in ${placeholders.length} placeholder(s): ${placeholders.join(', ')}`);
  if (!meta.image && ['Product', 'Article', 'BlogPosting', 'VideoObject'].includes(type))
    w.push('No image found on the page — image is important for rich results.');
  if (meta.jsonLdTypes.length) w.push(`Page already has JSON-LD: ${[...new Set(meta.jsonLdTypes)].join(', ')} (review for duplicates before adding).`);
  return w;
}

/* ---------------- top-level ---------------- */
export function generateForPage(html, pageUrl, opts = {}) {
  const meta = extractMetadata(html, pageUrl);
  const detected = opts.typeOverride
    ? { type: opts.typeOverride, confidence: 'override', reasons: ['Type set manually'] }
    : detectType(meta, pageUrl);

  const primary = buildJsonLd(detected.type, meta, pageUrl);
  const graph = [primary];

  // homepage gets Organization + WebSite together
  if (detected.type === 'Organization' && !opts.typeOverride) {
    graph.push(buildJsonLd('WebSite', meta, pageUrl));
  }
  // breadcrumbs pair well with almost everything
  if (opts.includeBreadcrumb !== false) {
    const bc = buildBreadcrumb(meta, pageUrl);
    if (bc) graph.push(bc);
  }

  const jsonld = graph.length === 1 ? graph[0] : graph;
  return {
    url: pageUrl,
    detectedType: detected.type,
    confidence: detected.confidence,
    reasons: detected.reasons,
    fromExisting: !!detected.fromExisting,
    extracted: {
      title: meta.title, description: meta.description, image: meta.image,
      siteName: meta.siteName, ogType: meta.ogType, price: meta.price,
      currency: meta.currency, author: meta.author, existingSchema: [...new Set(meta.jsonLdTypes)],
    },
    warnings: collectWarnings(detected.type, jsonld, meta),
    jsonld,
  };
}
