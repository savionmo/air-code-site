// 构建后检查 dist 文件数，接近 Cloudflare Pages 免费版 20,000 上限时预警
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const DIST = new URL('../dist', import.meta.url).pathname;
const LIMIT = 20000;
const WARN_AT = 19000;

let count = 0;
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else count++;
  }
}
try {
  walk(DIST);
} catch {
  console.log('[file-count] dist 不存在，跳过检查');
  process.exit(0);
}

console.log(`[file-count] dist 文件数: ${count} / ${LIMIT}`);
if (count >= LIMIT) {
  console.error(`[file-count] ❌ 已超 Cloudflare Pages 免费版上限 (${LIMIT})，部署会失败！`);
  process.exit(1);
} else if (count >= WARN_AT) {
  console.warn(`[file-count] ⚠️ 接近上限，仅剩 ${LIMIT - count} 个文件名额`);
}
