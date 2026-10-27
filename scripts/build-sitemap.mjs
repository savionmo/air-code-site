// scripts/build-sitemap.mjs
// Build-time sitemap generator: enumerates every static + dynamic route and
// writes public/sitemap-index.xml + chunked sitemaps. Runs in `prebuild`
// AFTER build-airports.mjs so it reads the final airport data.
// Output is regenerated on every build; do not hand-edit.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'data');
const outDir = join(root, 'public', 'sitemaps');
const SITE = 'https://airdocs.cn';
const today = new Date().toISOString().slice(0, 10);

const read = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const airlines = [...read('airlines-1.json'), ...read('airlines-2.json')];
const airports = [...read('airports-1.json'), ...read('airports-2.json'),
                   ...read('airports-3.json'), ...read('airports-4.json')];
const news = read('news.json');
const aircraft = read('aircraft.json');
const fleet = read('cargo-fleet.json');
const ulds = read('ulds.json');

// section -> [{loc, priority}]
const sections = { static: [], airports: [], airlines: [], content: [] };
const seen = new Set();
const add = (section, loc, priority = '0.6') => {
  const key = section + '|' + loc;
  if (seen.has(key)) return; // e.g. one IATA type code covering several variants
  seen.add(key);
  sections[section].push({ loc: SITE + loc, priority });
};

// ---- static pages (both languages) ----
for (const lang of ['zh', 'en']) {
  add('static', `/${lang}/`, '1.0');
  for (const sec of ['airport', 'airline', 'news', 'aircraft', 'freighter', 'cargo', 'zip'])
    add('static', `/${lang}/${sec}/`, '0.8');
}

// ---- airports / airlines ----
for (const lang of ['zh', 'en']) {
  for (const a of airports) if (a.iata) add('airports', `/${lang}/airport/${a.iata.toLowerCase()}/`);
  for (const a of airlines) if (a.iata) add('airlines', `/${lang}/airline/${a.iata.toLowerCase()}/`);
}

// ---- news (per-language slugs) ----
for (const n of news) if (n.slug && n.lang) add('content', `/${n.lang}/news/${n.slug}/`, '0.7');

// ---- postal code countries ----
try {
  const postal = read('postal-meta.json');
  for (const lang of ['zh', 'en'])
    for (const c of postal.countries) if (c.cc) add('content', `/${lang}/zip/${c.cc.toLowerCase()}/`, '0.7');
} catch {}

// ---- aircraft types ----
for (const lang of ['zh', 'en'])
  for (const p of aircraft) if (p.iata) add('content', `/${lang}/aircraft/${p.iata.toLowerCase()}/`);

// ---- freighters + cargo ----
const fcodes = new Set();
for (const f of fleet) for (const a of f.aircraft) fcodes.add(a.code);
for (const lang of ['zh', 'en']) {
  for (const code of fcodes) add('content', `/${lang}/freighter/${code}/`);
  for (const f of fleet) {
    const al = (f.airline || '').toLowerCase();
    if (!al) continue;
    add('content', `/${lang}/cargo/${al}/`, '0.7');
    add('content', `/${lang}/cargo/${al}/uld/`);
    for (const a of f.aircraft) add('content', `/${lang}/cargo/${al}/${a.code}/`);
    for (const u of ulds.filter((x) => (x.airline || '').toLowerCase() === al))
      if (u.code) add('content', `/${lang}/cargo/${al}/uld/${u.code.toLowerCase()}/`, '0.5');
  }
}

// ---- write chunked sitemaps ----
mkdirSync(outDir, { recursive: true });
const files = {
  'sitemap-static.xml': sections.static,
  'sitemap-airports.xml': sections.airports,
  'sitemap-airlines.xml': sections.airlines,
  'sitemap-content.xml': sections.content,
};

const xmlFor = (list) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  list.map((u) =>
    `  <url><loc>${esc(u.loc)}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority></url>`
  ).join('\n') + `\n</urlset>\n`;

let total = 0;
for (const [name, list] of Object.entries(files)) {
  if (list.length > 50000) throw new Error(`${name}: ${list.length} urls exceeds sitemap limit`);
  writeFileSync(join(outDir, name), xmlFor(list));
  total += list.length;
  console.log(`sitemap: ${name} -> ${list.length} urls`);
}

const index =
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  Object.keys(files).map((n) =>
    `  <sitemap><loc>${esc(`${SITE}/sitemaps/${n}`)}</loc><lastmod>${today}</lastmod></sitemap>`
  ).join('\n') + `\n</sitemapindex>\n`;
writeFileSync(join(root, 'public', 'sitemap-index.xml'), index);
console.log(`sitemap: sitemap-index.xml -> ${Object.keys(files).length} sitemaps, ${total} urls total`);
