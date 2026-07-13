import assert from 'node:assert';
import { extractMetadata, detectType, generateForPage } from '../src/extract.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } }

/* --- fixture 1: a product page with Open Graph + price --- */
const productHtml = `<!doctype html><html lang="en"><head>
<title>Blue Running Shoes | Acme Store</title>
<meta name="description" content="Lightweight blue running shoes for daily training.">
<meta property="og:type" content="product">
<meta property="og:title" content="Blue Running Shoes">
<meta property="og:image" content="/img/shoes.jpg">
<meta property="og:site_name" content="Acme Store">
<meta property="product:price:amount" content="89.90">
<meta property="product:price:currency" content="USD">
<meta property="product:availability" content="instock">
<link rel="canonical" href="https://acme.example/shop/blue-running-shoes">
</head><body><h1>Blue Running Shoes</h1></body></html>`;

t('product: extracts price/currency/image', () => {
  const m = extractMetadata(productHtml, 'https://acme.example/shop/blue-running-shoes');
  assert.equal(m.price, '89.90');
  assert.equal(m.currency, 'USD');
  assert.equal(m.image, 'https://acme.example/img/shoes.jpg', 'image should be absolute');
  assert.equal(m.siteName, 'Acme Store');
});
t('product: detects Product type (high)', () => {
  const m = extractMetadata(productHtml, 'https://acme.example/shop/blue-running-shoes');
  const d = detectType(m, 'https://acme.example/shop/blue-running-shoes');
  assert.equal(d.type, 'Product'); assert.equal(d.confidence, 'high');
});
t('product: builds valid Offer + breadcrumb', () => {
  const r = generateForPage(productHtml, 'https://acme.example/shop/blue-running-shoes');
  assert.ok(Array.isArray(r.jsonld), 'should be array (product + breadcrumb)');
  const prod = r.jsonld.find(n => n['@type'] === 'Product');
  assert.equal(prod.offers.price, '89.90');
  assert.equal(prod.offers.priceCurrency, 'USD');
  assert.equal(prod.offers.availability, 'https://schema.org/InStock');
  assert.equal(prod.image[0], 'https://acme.example/img/shoes.jpg');
  const bc = r.jsonld.find(n => n['@type'] === 'BreadcrumbList');
  assert.equal(bc.itemListElement.length, 3, 'Home + shop + product');
  assert.equal(bc.itemListElement[2].name, 'Blue Running Shoes');
  JSON.parse(JSON.stringify(r.jsonld)); // serializable
});

/* --- fixture 2: an article --- */
const articleHtml = `<!doctype html><html lang="en"><head>
<title>How to Train for a 5K</title>
<meta property="og:type" content="article">
<meta property="og:title" content="How to Train for a 5K">
<meta property="og:image" content="https://blog.example/hero.jpg">
<meta property="og:site_name" content="Runner's Blog">
<meta name="author" content="Jane Doe">
<meta property="article:published_time" content="2026-01-05T08:00:00Z">
<meta property="article:modified_time" content="2026-01-06T10:00:00Z">
<meta name="description" content="A beginner plan.">
</head><body><h1>How to Train for a 5K</h1></body></html>`;

t('article: detects Article + fills author/dates', () => {
  const r = generateForPage(articleHtml, 'https://blog.example/guides/train-5k');
  const a = r.jsonld.find(n => /Article|BlogPosting/.test(n['@type']));
  assert.ok(a, 'has article node');
  assert.equal(a.author.name, 'Jane Doe');
  assert.equal(a.datePublished, '2026-01-05T08:00:00Z');
  assert.equal(a.dateModified, '2026-01-06T10:00:00Z');
  assert.equal(a.publisher.name, "Runner's Blog");
});
t('article: /blog/ path yields BlogPosting', () => {
  const r = generateForPage(articleHtml, 'https://blog.example/blog/train-5k');
  assert.ok(r.jsonld.some(n => n['@type'] === 'BlogPosting'));
});

/* --- fixture 3: page that ALREADY has JSON-LD --- */
const withLd = `<html><head><title>Joe's Pizza</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Restaurant","name":"Joe's Pizza","telephone":"+1-555-0100"}
</script></head><body></body></html>`;
t('existing LD: detects Restaurant from page, flags duplicate', () => {
  const r = generateForPage(withLd, 'https://joes.example/');
  assert.equal(r.detectedType, 'Restaurant');
  assert.equal(r.confidence, 'high');
  assert.ok(r.fromExisting);
  assert.ok(r.warnings.some(w => /already has JSON-LD/.test(w)));
});

/* --- fixture 4: homepage → Organization + WebSite --- */
const homeHtml = `<html><head><title>Acme Inc — Home</title>
<meta property="og:site_name" content="Acme Inc">
<meta property="og:image" content="https://acme.example/logo.png">
<meta name="description" content="We build things.">
</head><body></body></html>`;
t('homepage: Organization + WebSite pair', () => {
  const r = generateForPage(homeHtml, 'https://acme.example/');
  assert.equal(r.detectedType, 'Organization');
  const org = r.jsonld.find(n => n['@type'] === 'Organization');
  const site = r.jsonld.find(n => n['@type'] === 'WebSite');
  assert.ok(org && site, 'both org and website present');
  assert.equal(org.name, 'Acme Inc');
  assert.equal(site.url, 'https://acme.example/');
});

/* --- fixture 5: type override --- */
t('override: forces a chosen type', () => {
  const r = generateForPage(productHtml, 'https://acme.example/x', { typeOverride: 'WebPage' });
  assert.equal(r.detectedType, 'WebPage');
  assert.equal(r.jsonld[0]['@type'] ?? r.jsonld['@type'], 'WebPage');
});

/* --- fixture 6: entity decoding --- */
t('decodes HTML entities in title', () => {
  const m = extractMetadata('<title>Tom &amp; Jerry&#39;s Caf&#233;</title>', 'https://x.example/');
  assert.equal(m.title, "Tom & Jerry's Café");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
