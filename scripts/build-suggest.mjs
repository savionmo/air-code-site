// Generates public/search-suggest.json from src/data at build time.
// Compact global search index: [kind, code, icao, zh, en, sub_zh, sub_en, flag, dest, continent?, main?]
// kind: 0=airport 1=airline 2=aircraft
// airport extras: continent (AS/EU/NA/SA/AF/OC), main (1=large_airport)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf-8'));
const q = s => encodeURIComponent(String(s).toLowerCase());

const airports = [...read('src/data/airports-1.json'), ...read('src/data/airports-2.json'), ...read('src/data/airports-3.json'), ...read('src/data/airports-4.json')];
const airlines = [...read('src/data/airlines-1.json'), ...read('src/data/airlines-2.json')];
const aircraft = read('src/data/aircraft.json');
const czh = read('src/data/country-zh.json');
const countries = read('src/data/countries.json');
const en2code = Object.fromEntries(Object.entries(countries).map(([cc, en]) => [en, cc]));
const cz = en => { const c = en2code[en]; return c ? (czh[c] || en) : en; };

const out = [];
for (const a of airports) {
  const czn = czh[a.country_code] || a.country_en;
  out.push([0, a.iata, a.icao || '', a.name_zh || '', a.name_en,
    `${a.city_zh || ''} · ${czn}`, `${a.city_en || ''} · ${a.country_en}`,
    a.country_code.toLowerCase(), `airport/${a.iata.toLowerCase()}`,
    a.continent || 'OT', a.type === 'large_airport' ? 1 : 0]);
}
for (const a of airlines) {
  const cc = (en2code[a.country_en] || '').toLowerCase();
  out.push([1, a.iata, a.icao || '', a.name_zh || '', a.name_en,
    cz(a.country_en), a.country_en, cc, `airline/${q(a.iata)}`]);
}
for (const p of aircraft) {
  out.push([2, p.iata, p.icao, p.name_zh, p.name_en, p.mfr_zh, p.mfr_en, '', `aircraft?q=${q(p.iata)}`]);
}

mkdirSync(new URL('public/', root), { recursive: true });
writeFileSync(new URL('public/search-suggest.json', root), JSON.stringify(out));
console.log(`search-suggest.json: ${out.length} items`);
