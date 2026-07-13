# Schema Markup Generator

Paste a URL (or a whole list) → it **crawls each page, auto-detects the right
Schema.org type, extracts the real content, and generates valid JSON-LD** — then
gives you an interface to review, tweak, and copy the code.

Built from the SEO Schema Builder skill (Schema.org v30.0). No AI key required —
detection is heuristic and deterministic.

## Run it

```bash
node server.js
# → http://localhost:3000
```

Node 18+ only. **Zero dependencies** — nothing to `npm install`.

## How it works

1. **Paste URLs** — one per line (up to 50), single or bulk.
2. **It crawls each page** and reads:
   - any JSON-LD structured data already on the page (strongest signal),
   - Open Graph / Twitter / `article:` / `product:` meta tags,
   - `<title>`, `<h1>`, meta description, canonical URL, `og:image`,
   - price / currency / availability / SKU signals.
3. **It auto-detects the type** — Product, Article/BlogPosting, Organization +
   WebSite (homepages), LocalBusiness/Restaurant, Person, VideoObject, Book,
   WebPage, and more — each with a **confidence level** and a "why this type"
   explanation.
4. **It generates the JSON-LD**, filling in real extracted data and marking any
   gaps with clearly-labelled `YOUR_…` placeholders. A `BreadcrumbList` (derived
   from the URL path) is added to each page by default.
5. **You review it** in the interface:
   - syntax-highlighted code per URL,
   - warnings (missing images, unfilled placeholders, existing schema to dedupe),
   - a **type override** dropdown to regenerate as a different type,
   - **Copy** / **Download** per page, plus **Copy all** / **Export .json** for the batch,
   - optional `<script type="application/ld+json">` wrapper.

## Project layout

```
server.js              Tiny zero-dep HTTP server: crawls URLs, serves the UI
src/extract.js         The engine: HTML → metadata → type detection → JSON-LD (pure, testable)
public/index.html      The crawler + review interface
public/manual.html     Bonus: manual field-by-field builder for 28 types (no crawling)
test/extract.test.mjs  Unit tests for the extraction engine
```

## Test

```bash
node test/extract.test.mjs
```

Covers product/article/homepage detection, existing-JSON-LD handling, breadcrumb
generation, type override, and entity decoding — all against HTML fixtures (no network).

## Notes & limits

- **Crawling runs server-side** (browsers can't fetch other domains due to CORS),
  which is why this is a small Node app rather than a single HTML file.
- Detection is **heuristic**: it's strong when a page has decent meta tags / Open
  Graph / existing structured data, and falls back to a generic `WebPage` (low
  confidence) when a page is bare. Use the type override to correct it.
- Always **replace `YOUR_…` placeholders** with real data and validate before
  publishing:
  [Schema.org Validator](https://validator.schema.org) ·
  [Google Rich Results Test](https://search.google.com/test/rich-results).

## Extending

Add or adjust a type in `src/extract.js`:
- teach `detectType()` a new signal, and
- add a builder branch in `buildJsonLd()`.

The server, API, and UI pick it up automatically.

### Possible next steps

- **Push to WordPress** — inject the generated schema straight into the matching
  page on a connected WordPress site.
- **Sitemap / CSV input** — queue every URL from a `sitemap.xml` or an upload.
- **AI-assisted extraction** — an optional LLM fallback for pages with weak metadata.
