// Builds src/data/airports-*.json from the official OurAirports CSV at build time.
// Source: https://davidmegginson.github.io/ourairports-data/airports.csv (public domain)
// Keeps airports that are large/medium/small AND (have scheduled service OR an ICAO code).
// Chinese names merged from src/data/airport-zh.json; timezone via tz-lookup (offline).
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import tzlookup from 'tz-lookup';

// 繁体转简体（机场中文名清洗）
const T2S = {'國際':'国际','機場':'机场','飛':'飞','場':'场','國':'国','軍':'军','奧':'奥','內':'内','爾':'尔','葉':'叶','諾':'诺','魯':'鲁','祕':'秘','岡':'冈','薩':'萨','麗':'丽','蘭':'兰','龍':'龙','龜':'龟','達':'达','亞':'亚','寧':'宁','傑':'杰','韋':'韦','賴':'赖','盧':'卢','鮑':'鲍','愛':'爱','貝':'贝','磯':'矶','馬':'马','羅':'罗','漢':'汉','區':'区','裡':'里','麼':'么','臺':'台'};
function t2s(s){ if(!s) return s; for(const [t,s2] of Object.entries(T2S)) s=s.replaceAll(t,s2); return s; }

const root = new URL('../', import.meta.url);
const SRC = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const DST = new URL('src/data/', root);
const CONT = { AS: 'AS', EU: 'EU', NA: 'NA', SA: 'SA', AF: 'AF', OC: 'OC', AN: 'OC' };
const KEEP = new Set(['large_airport', 'medium_airport', 'small_airport']);
// 上游 OurAirports 的已知错误/重复条目（IATA）：BSZ 与 FRU 同为 UCFM 比什凯克玛纳斯机场，FRU 为正确代码（见 airports-extra.json 手工维护）
const DROP_IATA = new Set(['BSZ']);
// 清洗官网链接常见 typo（如 hhttps://）
function cleanUrl(u) {
  u = (u || '').trim();
  u = u.replace(/^hhttps:\/\//i, 'https://').replace(/^htpps:\/\//i, 'https://');
  return u;
}

function parseCSV(text) {
  const rows = [];
  let cur = [''], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else inQ = false; }
      else cur[cur.length - 1] += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') cur.push('');
    else if (c === '\n') { rows.push(cur); cur = ['']; }
    else if (c === '\r') { /* skip */ }
    else cur[cur.length - 1] += c;
  }
  return rows;
}

let csv;
try {
  const r = await fetch(SRC);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  csv = await r.text();
  console.log('downloaded ourairports.csv', (csv.length / 1024 / 1024).toFixed(1) + 'MB');
} catch (e) {
  console.log('download failed (' + e.message + '), keeping existing JSON data');
  process.exit(0);
}

const rows = parseCSV(csv);
const head = rows[0];
const idx = n => head.indexOf(n);
const get = (r, n) => (r[idx(n)] || '').trim();

const zhmap = {};
for (const f of ['src/data/airport-zh-1.json', 'src/data/airport-zh-2.json']) {
  try { Object.assign(zhmap, JSON.parse(readFileSync(new URL(f, root), 'utf-8'))); } catch {}
}
const countries = JSON.parse(readFileSync(new URL('src/data/countries.json', root), 'utf-8'));

const seen = new Map();
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < head.length) continue;
  const iata = get(r, 'iata_code').toUpperCase();
  if (!iata || !KEEP.has(get(r, 'type'))) continue;
  if (DROP_IATA.has(iata)) continue;
  const sched = get(r, 'scheduled_service') === 'yes';
  const icao = get(r, 'icao_code').toUpperCase();
  if (!sched && !icao) continue;
  const lat = parseFloat(get(r, 'latitude_deg')) || 0;
  const lon = parseFloat(get(r, 'longitude_deg')) || 0;
  const score = (sched ? 4 : 0) + (icao ? 2 : 0) + (get(r, 'type') === 'large_airport' ? 1 : 0);
  const prev = seen.get(iata);
  if (prev && prev._s >= score) continue;
  let tz = null;
  try { tz = tzlookup(lat, lon); } catch { /* ignore */ }
  const cc = get(r, 'iso_country').toUpperCase();
  const ef = parseFloat(get(r, 'elevation_ft'));
  seen.set(iata, {
    iata, icao,
    name_en: get(r, 'name'),
    name_zh: t2s((zhmap[iata] || [])[0]) || null,
    city_en: get(r, 'municipality'),
    city_zh: t2s((zhmap[iata] || [])[1]) || null,
    country_code: cc,
    country_en: countries[cc] || '',
    lat, lon,
    elev_ft: isNaN(ef) ? null : Math.round(ef),
    scheduled: sched,
    type: get(r, 'type'),
    continent: CONT[get(r, 'continent')] || 'OT',
    tz,
    wiki: get(r, 'wikipedia_link'),
    home: cleanUrl(get(r, 'home_link')),
    _s: score,
  });
}

const order = { large_airport: 0, medium_airport: 1, small_airport: 2 };
// merge hand-curated extras (real airports missing from OurAirports, e.g. FRU)
try {
  const extras = JSON.parse(readFileSync(new URL('src/data/airports-extra.json', root), 'utf-8'));
  for (const e of extras) {
    if (!e.iata || seen.has(e.iata)) continue;
    let tz = e.tz || null;
    if (!tz) { try { tz = tzlookup(e.lat, e.lon); } catch {} }
    seen.set(e.iata, { ...e, tz });
  }
  console.log('extras merged:', extras.length);
} catch {}
const all = [...seen.values()].map(({ _s, ...o }) => o)
  .sort((a, b) => (order[a.type] - order[b.type]) || (a.iata < b.iata ? -1 : 1));

const N = 4, chunk = Math.ceil(all.length / N);
for (let i = 0; i < N; i++) {
  const part = all.slice(i * chunk, (i + 1) * chunk);
  if (!part.length) continue;
  writeFileSync(new URL(`src/data/airports-${i + 1}.json`, root), JSON.stringify(part));
}
writeFileSync(new URL('src/data/airports.ts', root),
  Array.from({ length: N }, (_, i) => `import a${i + 1} from './airports-${i + 1}.json';`).join('\n') +
  `\nexport default [${Array.from({ length: N }, (_, i) => `...a${i + 1}`).join(', ')}];\n`);
console.log(`airports: ${all.length} written in ${N} chunks`);
