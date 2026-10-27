// 全球邮编数据构建：下载 GeoNames 邮编库（CC BY 4.0），清洗后生成
//   public/zip-data/{cc}.json  每国全量数据（紧凑数组，供国家页前端加载）
//   src/data/postal-meta.json   国家元信息（模板 getStaticPaths / 索引页用）
// 本地调试可用环境变量 POSTAL_LOCAL_FILE 指向已解压的 allCountries.txt 跳过下载。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import https from 'node:https';

const ROOT = process.cwd();
// 首批试运行国家（可增删）：cc, 英文名, 大洲(AS/EU/NA/SA/AF/OC)
const INCLUDE = [
  ['CN', 'China', 'AS'], ['US', 'United States', 'NA'], ['JP', 'Japan', 'AS'], ['KR', 'South Korea', 'AS'],
  ['GB', 'United Kingdom', 'EU'], ['DE', 'Germany', 'EU'], ['FR', 'France', 'EU'], ['IT', 'Italy', 'EU'],
  ['ES', 'Spain', 'EU'], ['NL', 'Netherlands', 'EU'], ['CA', 'Canada', 'NA'], ['AU', 'Australia', 'OC'],
  ['RU', 'Russia', 'EU'], ['IN', 'India', 'AS'], ['SG', 'Singapore', 'AS'], ['TH', 'Thailand', 'AS'],
  ['MY', 'Malaysia', 'AS'], ['ID', 'Indonesia', 'AS'], ['BR', 'Brazil', 'SA'],
  ['MX', 'Mexico', 'NA'], ['TR', 'Türkiye', 'AS'], ['PL', 'Poland', 'EU'], ['ZA', 'South Africa', 'AF'],
  ['AT', 'Austria', 'EU'], ['PH', 'Philippines', 'AS'],
];
const FORMAT = {
  CN: ['6 位数字', '6 digits'], US: ['5 位数字，可带 -4 后缀（ZIP+4）', '5 digits, optional -4 suffix (ZIP+4)'],
  JP: ['7 位数字，写作 3 位-4 位', '7 digits (NNN-NNNN)'], KR: ['5 位数字', '5 digits'],
  GB: ['字母+数字组合（如 SW1A 1AA）；本站收录为邮编前段（区域级）', 'Alphanumeric (e.g. SW1A 1AA); listed at outward district level'],
  DE: ['5 位数字', '5 digits'], FR: ['5 位数字（含 CEDEX 专用码）', '5 digits (incl. CEDEX codes)'],
  IT: ['5 位数字', '5 digits'], ES: ['5 位数字（前 2 位为省份）', '5 digits (first 2 = province)'],
  NL: ['完整格式为 4 位数字+2 个字母；本站收录为 4 位数字级', 'Full format is 4 digits + 2 letters; listed at 4-digit level'],
  CA: ['字母数字交替（如 K1A 0B1）；本站收录为前 3 位（FSA）级', 'Alphanumeric (e.g. K1A 0B1); listed at FSA (first 3 chars) level'],
  AU: ['4 位数字', '4 digits'], RU: ['6 位数字', '6 digits'], IN: ['6 位数字（PIN 码）', '6 digits (PIN code)'],
  SG: ['6 位数字（楼宇级）', '6 digits (building level)'], TH: ['5 位数字', '5 digits'], VN: ['6 位数字', '6 digits'],
  MY: ['5 位数字', '5 digits'], ID: ['5 位数字', '5 digits'], BR: ['8 位数字，写作 5 位-3 位', '8 digits (NNNNN-NNN)'],
  AT: ['4 位数字', '4 digits'], PH: ['4 位数字', '4 digits'],
  MX: ['5 位数字', '5 digits'], TR: ['5 位数字', '5 digits'], PL: ['5 位数字，写作 2 位-3 位', '5 digits (NN-NNN)'],
  ZA: ['4 位数字', '4 digits'],
};
// 中国省级行政区中文名（GeoNames admin1 为英文名）
const CN_ADMIN_ZH = {
  Anhui: '安徽', Zhejiang: '浙江', Jiangxi: '江西', Jiangsu: '江苏', Jilin: '吉林', Qinghai: '青海', Fujian: '福建',
  Heilongjiang: '黑龙江', Henan: '河南', Hebei: '河北', Hunan: '湖南', Hubei: '湖北', Xinjiang: '新疆', Xizang: '西藏',
  Gansu: '甘肃', Guangxi: '广西', Guizhou: '贵州', Shanxi: '山西', Shaanxi: '陕西', Sichuan: '四川', Yunnan: '云南',
  Guangdong: '广东', Hainan: '海南', Liaoning: '辽宁', Shandong: '山东', Tianjin: '天津', Chongqing: '重庆',
  Beijing: '北京', Shanghai: '上海', Ningxia: '宁夏', 'Nei Mongol': '内蒙古', 'Inner Mongolia': '内蒙古',
  'Hong Kong': '香港', Macao: '澳门', Macau: '澳门', Taiwan: '台湾',
};

function fetchBuf(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume(); return resolve(fetchBuf(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// 极简 zip 解包：从中央目录定位目标条目并 inflate（构建期专用，避免引入依赖）
function unzipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: EOCD not found');
  let p = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < total; k++) {
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), comLen = buf.readUInt16LE(p + 32);
    const fname = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (fname === name) {
      const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20), localOff = buf.readUInt32LE(p + 42);
      const ll = buf.readUInt16LE(localOff + 26), le = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + ll + le;
      const comp = buf.subarray(start, start + compSize);
      return method === 8 ? zlib.inflateRawSync(comp) : Buffer.from(comp);
    }
    p += 46 + nameLen + extraLen + comLen;
  }
  throw new Error('zip: entry not found: ' + name);
}

async function loadText() {
  if (process.env.POSTAL_LOCAL_FILE) {
    console.log('[postal] using local file', process.env.POSTAL_LOCAL_FILE);
    return fs.readFileSync(process.env.POSTAL_LOCAL_FILE, 'utf8');
  }
  console.log('[postal] downloading GeoNames allCountries.zip ...');
  const buf = await fetchBuf('https://download.geonames.org/export/zip/allCountries.zip');
  console.log('[postal] downloaded', (buf.length / 1048576).toFixed(1), 'MB, extracting ...');
  return unzipEntry(buf, 'allCountries.txt').toString('utf8');
}

const text = await loadText();
const want = new Map(INCLUDE.map(([cc, en, cont]) => [cc, { cc, en, cont }]));
const byCc = new Map();
let totalIn = 0;
for (const line of text.split('\n')) {
  if (!line) continue;
  const p = line.split('\t');
  const meta = want.get(p[0]);
  if (!meta) continue;
  const code = (p[1] || '').trim(), place = (p[2] || '').trim();
  if (!code || !place) continue;
  const admName = (p[3] || '').trim(), admCode = (p[4] || '').trim();
  const a2 = (p[5] || '').trim(), a3 = (p[7] || '').trim();
  const lat = Math.round(parseFloat(p[9]) * 10000) / 10000, lon = Math.round(parseFloat(p[10]) * 10000) / 10000;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  if (!byCc.has(p[0])) byCc.set(p[0], new Map());
  const m = byCc.get(p[0]);
  const key = code + '|' + place + '|' + admCode + '|' + a2 + '|' + a3;
  if (!m.has(key)) m.set(key, { code, place, admName, admCode, a2, a3, lat, lon });
  totalIn++;
}

fs.mkdirSync(path.join(ROOT, 'public/zip-data'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src/data'), { recursive: true });
const metas = [];
let totalOut = 0;
for (const [cc, en, cont] of INCLUDE) {
  const m = byCc.get(cc);
  const rows = m ? [...m.values()] : [];
  rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.place < b.place ? -1 : a.place > b.place ? 1 : 0));
  // 下钻层级：admin1（州/省）之外，admin2（市/县）、admin3（区）覆盖率 ≥50% 的依次入选（德国 a2 覆盖低、a3 高 → 只用 a3）
  const cov = (f) => (rows.length ? rows.filter((r) => r[f]).length / rows.length : 0);
  const fields = ['a2', 'a3'].filter((f) => cov(f) >= 0.5);
  const dicts = fields.map((f) => {
    const d = new Map(); const names = [];
    for (const r of rows) { const v = r[f]; if (v && !d.has(v)) { d.set(v, names.length); names.push(v); } }
    return { f, d, names };
  });
  const gidx = (di, r) => (dicts[di] ? (r[fields[di]] ? dicts[di].d.get(r[fields[di]]) : -1) : -1);
  // 前端行格式：[邮编, 地名, 地区代码, 分组1索引, 分组2索引, 纬度, 经度]（分组名查 grp 字典，地区名查 meta.admins）
  const out = rows.map((r) => [r.code, r.place, r.admCode, gidx(0, r), gidx(1, r), r.lat, r.lon]);
  fs.writeFileSync(path.join(ROOT, 'public/zip-data', cc.toLowerCase() + '.json'),
    JSON.stringify({ cc, grp: dicts.map(({ f, names }) => ({ f, names })), rows: out }));
  const admMap = new Map();
  for (const r of rows) {
    const k = r.admCode || '';
    if (!admMap.has(k)) admMap.set(k, { code: k, name: r.admName || k, zh: cc === 'CN' ? (CN_ADMIN_ZH[r.admName] || '') : '', count: 0 });
    admMap.get(k).count++;
  }
  const admins = [...admMap.values()].filter((a) => a.code || a.name).sort((a, b) => a.name.localeCompare(b.name));
  const fmt = FORMAT[cc] || ['', ''];
  metas.push({ cc, en, cont, count: rows.length, admins, fmtZh: fmt[0], fmtEn: fmt[1], grp: fields.length, gf: fields });
  totalOut += rows.length;
  console.log('[postal]', cc, rows.length, 'rows,', admins.length, 'regions, drill:', fields.join('+') || 'flat');
}
metas.sort((a, b) => b.count - a.count);
fs.writeFileSync(path.join(ROOT, 'src/data/postal-meta.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), total: totalOut, countries: metas }));
console.log('[postal] done:', metas.length, 'countries,', totalOut, 'rows (raw matched', totalIn, ')');
