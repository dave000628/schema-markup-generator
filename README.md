# Schema Markup Generator

A self-contained, no-backend browser tool that generates valid, production-ready
**JSON-LD structured data** for 40+ [Schema.org](https://schema.org) types —
Google's preferred format for rich results.

Built from the **SEO Schema Builder** skill (Schema.org v30.0).

## Use it

Open `index.html` in any browser — that's it. No build step, no server, no dependencies.

You can also host it anywhere static (GitHub Pages, Netlify, S3, an internal wiki).

## Features

- **28 schema types across 10 categories** — Organization, LocalBusiness, Product,
  Article/BlogPosting/NewsArticle, BreadcrumbList, FAQPage, HowTo, Recipe, VideoObject,
  Event, JobPosting, Course, Book, Movie, SoftwareApplication, Physician, LegalService,
  Vehicle, and more. Many carry subtype pickers (e.g. LocalBusiness → Restaurant, Store, Hotel…).
- **Dynamic forms** — each type shows exactly the fields it needs, including nested objects
  (address, offer, author, publisher), repeatable lists (FAQ Q&As, HowTo steps, breadcrumbs,
  opening hours, reviews), and enum dropdowns (availability, condition, employment type…).
- **Live JSON-LD output** with syntax highlighting — updates as you type; empty fields are
  omitted automatically so the result is always clean.
- **One-click actions** — Copy JSON-LD, Copy as `<script>` tag, Download `.json`, Fill example.
- **Validation built in** — required-field checker plus direct links to the
  [Schema.org Validator](https://validator.schema.org) and
  [Google Rich Results Test](https://search.google.com/test/rich-results).
- **Correct by construction** — auto `@context`/`@type`, auto `position` in breadcrumbs,
  proper nesting (Question → acceptedAnswer → Answer, WebSite → SearchAction → EntryPoint), etc.
- **Light & dark** theme aware, responsive down to mobile.

## How to deploy the output

Paste the generated code into a `<script>` tag in your page's `<head>`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  ...
}
</script>
```

Google accepts it in `<head>` or just before `</body>`.

## Extending it

All schema types are defined as data in the `SCHEMAS` array inside `index.html`.
To add a new type, append an entry using the `f.*` field helpers (`f.text`, `f.url`,
`f.obj`, `f.list`, `f.strlist`, `f.select`, `f.multi`, …). The rendering engine and
JSON-LD builder pick it up automatically — no other changes needed.

For types not yet included, look up exact required/recommended properties at
`https://schema.org/{TypeName}`.
