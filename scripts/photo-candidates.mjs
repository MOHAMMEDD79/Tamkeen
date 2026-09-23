/** Prints numbered candidates for a query so a human can pick by name. Used with --pick. */
import { Buffer } from 'node:buffer';
import { URLSearchParams } from 'node:url';
const API = 'https://commons.wikimedia.org/w/api.php';
const ALLOWED = /^(cc0|cc by|cc by-sa|public domain|pd|attribution)/i;
const UNWANTED = /\b(map|logo|coat of arms|flag|diagram|chart|seal|icon|svg|poster|stamp|banknote|plan of|drawing)\b/i;
const wait = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
async function get(params) {
  for (let i = 0; i < 5; i += 1) {
    const gap = Date.now() - last; if (gap < 1600) await wait(1600 - gap); last = Date.now();
    const r = await fetch(`${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: { 'user-agent': 'tamkeen-local-demo/1.0' } });
    if (r.status === 429) { await wait(4000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`commons ${r.status}`);
    return r.json();
  }
  throw new Error('429');
}
for (const query of process.argv.slice(2)) {
  const data = await get({ action: 'query', generator: 'search', gsrsearch: `filetype:bitmap ${query}`, gsrlimit: '30', gsrnamespace: '6', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime' });
  const all = Object.values(data?.query?.pages ?? {});
  console.log(`\n### ${query}  (${all.length} raw)`);
  for (const page of Object.values(data?.query?.pages ?? {})) {
    const info = page.imageinfo?.[0]; if (!info) continue;
    const licence = info.extmetadata?.LicenseShortName?.value ?? '';
    if (!ALLOWED.test(licence) || UNWANTED.test(page.title)) continue;
    if (!['image/jpeg', 'image/png'].includes(info.mime)) continue;
    if (!info.width || info.width < 800 || info.width / info.height < 1.05) continue;
    console.log(`  ${page.title.replace('File:', '').slice(0, 78)}`);
  }
}
void Buffer;
