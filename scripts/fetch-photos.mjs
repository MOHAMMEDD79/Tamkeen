/**
 * Fetches one topic-matched photograph per listing from Wikimedia Commons.
 *
 * The generated covers were distinct but said nothing about the work, so these are real pictures:
 * a stone mason for the masonry round, an olive press for the pressing line, a clinic for the
 * clinic. Queries are curated per listing rather than derived from the title, because a search for
 * "منسق مشاريع ميداني" returns nothing useful and a search for "community field worker" does.
 *
 * Only licences that permit reuse are accepted, and every file's author, licence and source page
 * are written to scripts/assets/photos/CREDITS.md. CC BY and CC BY-SA oblige us to credit the
 * photographer wherever the picture is shown; this build has no field for that, so the credits
 * file is where it lives until one exists.
 *
 * Photos are cached on disk, so this runs once and demo:covers reads what it left behind.
 *
 *   node scripts/fetch-photos.mjs
 */

import { Buffer } from 'node:buffer';
import { URLSearchParams } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('scripts/assets/photos');
const API = 'https://commons.wikimedia.org/w/api.php';
/** Licences that allow reuse. Anything else is skipped rather than argued with. */
const ALLOWED = /^(cc0|cc by|cc by-sa|public domain|pd|attribution)/i;
/** Titles that are usually diagrams, coats of arms or maps rather than photographs. */
const UNWANTED = /\b(map|logo|coat of arms|flag|diagram|chart|seal|icon|svg|poster|stamp|banknote|plan of|drawing)\b/i;


/**
 * Files chosen by name after reading the candidate lists. Commons filenames are usually
 * descriptive, so picking by name is far more reliable than trusting search rank — rank gave an
 * astronaut's visor for "civil engineer" and a canal lock for "first aid". A listing with no pick
 * here falls back to RULES below.
 */
const PICKS = [
  [/ترميم منازل/, 'East Jerusalem - The Old City - 175 (4260981803).jpg'],
  [/إحياء أزقة/, 'Jerusalem Old City Market, 2019 (03).jpg'],
  [/صمود طلبة مدارس/, 'Al Shioukh elementary girl\u2019s school.jpg'],
  [/نقطة إسعاف/, 'Palestinian Red Crescent Society 002.jpg'],
  [/مختبر علوم متنقل/, 'Students in Shadeh High School Laboratory.JPG'],
  [/مكتبة الطفل/, "Children's reading in Public Library 02.jpg"],
  [/المنشار السلكي/, 'Use of cutting machine, Marble Quarries thassos.jpg'],
  [/مشغل النحت/, 'Stonemason at Guedelon.jpg'],
  [/الألواح والعواكس/, 'Rooftop solar photovoltaic installation.jpg'],
  [/خط التعبئة وخزانات/, 'Idalion palace - oil mill - 08. pressing room.jpg'],
  [/إدارة المنح إلى منتج/, 'Programmer writing code with Unit Tests.jpg'],
  [/الترميم والحرف التقليدية/, "Masons' Lodge, York Minster (29th August 2020) 002.jpg"],
  [/STEM للفتيات/, 'Students use microscope LPB Laos.jpg'],
  [/الإسعاف الأولي المجتمعي/, 'First Aid Training Pakistan.jpg'],
  [/المهارات الرقمية وريادة/, 'Students working on class assignment in computer lab.jpg'],
  [/فني\/ة كهرباء/, 'Electrician Working.jpg'],
  [/منسق\/ة مشاريع ميداني/, 'A village community development meeting in northern Ghana.jpg'],
  [/مسعف\/ة/, 'Paramedics in an ambulance.jpg'],
  [/محاسب\/ة/, 'The Accountants desks (3817577217).jpg'],
  [/مرشد\/ة زراعي/, 'Farm Extension Worker.jpg'],
  [/توثيق تراثي/, 'The Dome of the Rock façade (10805457495).jpg'],
  [/ممرض\/ة عيادة/, 'Nurse educating patient.jpg'],
  [/دعم نفسي اجتماعي/, 'Community Support Centre Starobelsk Yulia Psychologist, Svetlana Social Worker, Oksana SOS Children Village Coordinator (21413645020).jpg'],
  [/فني\/ة ترميم وحجر/, "Masons' Lodge, York Minster (29th August 2020) 001.jpg"]
];

/** Resolves one named Commons file to a thumbnail plus its licence and author. */
async function namedFile(fileName) {
  const data = await get({
    action: 'query', titles: `File:${fileName}`, prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1400'
  });
  const page = Object.values(data?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info || page.missing !== undefined) return null;
  const meta = info.extmetadata ?? {};
  if (!ALLOWED.test(meta.LicenseShortName?.value ?? '')) return null;
  return {
    title: page.title, licence: meta.LicenseShortName?.value ?? '',
    artist: (meta.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim() || 'Unknown',
    licenceUrl: meta.LicenseUrl?.value ?? '', descriptionUrl: info.descriptionurl,
    thumburl: info.thumburl ?? info.url
  };
}

/**
 * [match on the listing title, ordered queries]. Commons' plain full-text search is poor at this —
 * "engineer construction site helmet" returned an astronaut's visor — so each listing leads with
 * `incategory:`, which searches inside a curated category, and falls back to keywords only if the
 * category yields nothing usable.
 */
const RULES = [
  [/مكتبة الطفل/, ['incategory:"Children reading" children', 'incategory:"Reading" children books', 'children reading books library']],
  [/ترميم منازل/, ['incategory:"Old City (Jerusalem)" houses roofs', 'incategory:"Buildings in the Old City of Jerusalem" stone', 'Jerusalem Old City rooftops view']],
  [/صمود طلبة مدارس/, ['incategory:"Schools in the State of Palestine" students', 'incategory:"Classrooms" pupils school', 'primary school classroom children desks']],
  [/إحياء أزقة/, ['incategory:"Streets in the Old City of Jerusalem" alley', 'incategory:"Old City (Jerusalem)" market street', 'Jerusalem Old City souk alley']],
  [/مختبر علوم متنقل/, ['incategory:"School laboratories" students', 'incategory:"Science education" laboratory students', 'school science laboratory students']],
  [/عيادة متنقلة/, ['incategory:"Medical clinics" examination', 'incategory:"Health centres" patient', 'medical clinic examination doctor patient']],
  [/نقطة إسعاف/, ['incategory:"Palestine Red Crescent Society" ambulance', 'incategory:"Ambulances" emergency vehicle', 'Palestine Red Crescent ambulance']],
  [/حدائق منزلية/, ['incategory:"Vegetable gardens" beds', 'incategory:"Kitchen gardens" vegetables', 'raised bed vegetable garden']],

  [/المنشار السلكي/, ['incategory:"Stone cutting" machine', 'incategory:"Stone industry" cutting saw', 'incategory:"Marble quarries" blocks', 'marble cutting factory saw']],
  [/مشغل النحت/, ['incategory:"Stone carving" workshop', 'incategory:"Stonemasons" carving chisel', 'stonemason workshop carving tools']],
  [/الألواح والعواكس/, ['incategory:"Solar panel installation" technician', 'incategory:"Photovoltaics" roof installation', 'solar installation technician rooftop']],
  [/خط التعبئة وخزانات/, ['incategory:"Olive oil mills" press', 'incategory:"Olive oil production" mill', 'olive oil mill press machinery']],
  [/إدارة المنح إلى منتج/, ['incategory:"Computer programmers" working', 'incategory:"Offices" computers desks people', 'programmers desk monitors office']],

  [/الترميم والحرف التقليدية/, ['incategory:"Stonemasons" restoration work', 'incategory:"Building restoration" masonry', 'stone building restoration workers']],
  [/STEM للفتيات/, ['incategory:"Women in science" students laboratory', 'incategory:"Science education" girls students', 'girls science experiment school']],
  [/الإسعاف الأولي المجتمعي/, ['incategory:"First aid training" practice', 'incategory:"Cardiopulmonary resuscitation" training manikin', 'first aid training CPR dummy']],
  [/المهارات الرقمية وريادة/, ['incategory:"Computer classrooms" students', 'incategory:"Computer training" class', 'adults computer class training room']],

  [/مهندس\/ة مدني/, ['incategory:"Construction workers" site plans', 'incategory:"Civil engineering" construction site', 'construction site workers plans']],
  [/فني\/ة كهرباء/, ['incategory:"Electricians" working', 'incategory:"Electrical wiring" installation work', 'electrician wiring distribution board']],
  [/منسق\/ة مشاريع ميداني/, ['incategory:"Community meetings" group', 'incategory:"Humanitarian aid" field workers', 'community meeting group outdoors']],
  [/مسعف\/ة/, ['incategory:"Paramedics" ambulance', 'incategory:"Emergency medical services" crew', 'paramedics ambulance patient']],
  [/محاسب\/ة/, ['incategory:"Accounting" documents desk', 'incategory:"Calculators" desk documents', 'calculator financial documents desk']],
  [/مرشد\/ة زراعي/, ['incategory:"Agricultural extension" farmer', 'incategory:"Agriculture in the State of Palestine" field', 'agricultural extension agent farmer field']],
  [/توثيق تراثي/, ['incategory:"Architectural photography" building', 'incategory:"Photographers at work" building', 'photographer documenting historic building']],
  [/ممرض\/ة عيادة/, ['incategory:"Nursing" patient care', 'incategory:"Nurses" clinic patient', 'nurse blood pressure patient clinic']],
  [/فني\/ة ترميم وحجر/, ['incategory:"Stonemasons" chisel stone', 'incategory:"Stone carving" craftsman hands', 'stonemason carving stone tools']],
  [/مدرب\/ة علوم/, ['incategory:"Science demonstrations" students', 'incategory:"Science education" teacher experiment', 'teacher science experiment students']],
  [/دعم نفسي اجتماعي/, ['incategory:"Group discussions" circle', 'incategory:"Workshops" participants discussion', 'support group circle chairs']],
  [/منسق\/ة برامج شبابية/, ['incategory:"Youth work" group activity', 'incategory:"Workshops" young people training', 'youth training workshop participants']]
];

const wait = (ms) => new Promise(done => setTimeout(done, ms));

/** Commons rate-limits an unauthenticated caller hard, so requests are spaced and 429 is retried. */
let lastCall = 0;
const get = async (params) => {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const gap = Date.now() - lastCall;
    if (gap < 1800) await wait(1800 - gap);
    lastCall = Date.now();
    const response = await fetch(url, { headers: { 'user-agent': 'tamkeen-local-demo/1.0 (local build; contact: local)' } });
    if (response.status === 429) { await wait(4000 * (attempt + 1)); continue; }
    if (!response.ok) throw new Error(`commons ${response.status}`);
    return response.json();
  }
  throw new Error('commons 429 after retries');
};

/** Commons search, narrowed to photographs that are wide enough to crop as a cover. */
async function findPhoto(query) {
  const data = await get({
    action: 'query', generator: 'search', gsrsearch: `filetype:bitmap ${query}`,
    gsrlimit: '12', gsrnamespace: '6', prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1400'
  });
  const pages = Object.values(data?.query?.pages ?? {});
  const scored = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const meta = info.extmetadata ?? {};
    const licence = meta.LicenseShortName?.value ?? '';
    if (!ALLOWED.test(licence)) continue;
    if (UNWANTED.test(page.title)) continue;
    if (!['image/jpeg', 'image/png'].includes(info.mime)) continue;
    if (!info.width || info.width < 1000) continue;
    const ratio = info.width / info.height;
    if (ratio < 1.15) continue;                       // portraits crop badly into a wide card
    if (!info.thumburl) continue;
    scored.push({
      title: page.title, licence,
      ratioScore: Math.abs(ratio - 1.78),             // 16:9 is the shape the cards want
      artist: (meta.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim() || 'Unknown',
      licenceUrl: meta.LicenseUrl?.value ?? '',
      descriptionUrl: info.descriptionurl,
      thumburl: info.thumburl
    });
  }
  scored.sort((a, b) => a.ratioScore - b.ratioScore);
  return scored;
}

/** The same checks site media applies, run before anything is written to disk. */
function usable(bytes) {
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!png && !jpeg) return false;
  if (bytes.length < 24 || bytes.length > 8 * 1024 * 1024) return false;
  // Site media rejects anything whose bytes contain active-content markers, so check here too.
  return !/<\/?(?:html|script|svg)\b/i.test(bytes.toString('latin1'));
}

const advanceArg = process.argv.indexOf('--advance');
if (advanceArg > -1) {
  const slug = process.argv[advanceArg + 1];
  const creditsFile = resolve(OUT, 'credits.json');
  const store = JSON.parse(await readFile(creditsFile, 'utf8'));
  const entry = store[slug];
  if (!entry) throw new Error(`no entry for ${slug}`);
  const next = (entry.chosen ?? 0) + 1;
  const candidate = entry.candidates?.[next];
  if (!candidate) throw new Error(`no further candidate for ${slug}`);
  const response = await fetch(candidate.thumburl, { headers: { 'user-agent': 'tamkeen-local-demo/1.0 (local build)' } });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!usable(bytes)) throw new Error('candidate is not a usable image');
  await writeFile(resolve(entry.file.replace('scripts/assets/photos/', `${OUT}/`)), bytes);
  Object.assign(entry, {
    commonsFile: candidate.title, author: candidate.artist, licence: candidate.licence,
    licenceUrl: candidate.licenceUrl, source: candidate.descriptionUrl, chosen: next
  });
  await writeFile(creditsFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  console.log(`${slug} -> ${candidate.title}`);
  process.exit(0);
}

const listings = (await readFile('/tmp/listings.txt', 'utf8')).trim().split('\n').map(line => {
  const [kind, slug, title] = line.split('|');
  return { kind, slug, title };
});

await mkdir(OUT, { recursive: true });
const creditsPath = resolve(OUT, 'credits.json');
const credits = existsSync(creditsPath) ? JSON.parse(await readFile(creditsPath, 'utf8')) : {};

let fetched = 0, cached = 0, failed = [];
for (const listing of listings) {
  const file = resolve(OUT, `${listing.kind}-${createHash('sha1').update(listing.slug).digest('hex').slice(0, 16)}.jpg`);
  if (existsSync(file) && credits[listing.slug]) { cached += 1; continue; }
  const rule = RULES.find(([pattern]) => pattern.test(listing.title));
  if (!rule) { failed.push(`${listing.title} (no query rule)`); continue; }

  let saved = false;
  const picked = PICKS.find(([pattern]) => pattern.test(listing.title));
  if (picked) {
    try {
      const candidate = await namedFile(picked[1]);
      if (candidate) {
        await wait(400);
        const response = await fetch(candidate.thumburl, { headers: { 'user-agent': 'tamkeen-local-demo/1.0 (local build)' } });
        const bytes = Buffer.from(await response.arrayBuffer());
        if (usable(bytes)) {
          await writeFile(file, bytes);
          credits[listing.slug] = {
            title: listing.title, file: file.replace(`${process.cwd()}/`, ''),
            commonsFile: candidate.title, author: candidate.artist, licence: candidate.licence,
            licenceUrl: candidate.licenceUrl, source: candidate.descriptionUrl, query: 'picked by name', chosen: 0, candidates: []
          };
          console.log(`  ${listing.title.slice(0, 34).padEnd(36)} ← ${candidate.title.replace('File:', '').slice(0, 52)}`);
          saved = true; fetched += 1;
        }
      } else {
        console.log(`  pick not found on Commons: ${picked[1]}`);
      }
    } catch (error) { console.log(`  pick failed (${picked[1]}): ${error.message}`); }
  }
  if (saved) continue;

  for (const query of rule[1]) {
    let candidates;
    try { candidates = await findPhoto(query); } catch (error) { console.log(`  search failed: ${query}: ${error.message}`); continue; }
    for (const candidate of candidates.slice(0, 4)) {
      try {
        await wait(600);
        const response = await fetch(candidate.thumburl, { headers: { 'user-agent': 'tamkeen-local-demo/1.0 (local build)' } });
        if (!response.ok) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!usable(bytes)) continue;
        await writeFile(file, bytes);
        credits[listing.slug] = {
          title: listing.title, file: file.replace(`${process.cwd()}/`, ''),
          commonsFile: candidate.title, author: candidate.artist,
          licence: candidate.licence, licenceUrl: candidate.licenceUrl, source: candidate.descriptionUrl,
          query, chosen: 0, candidates: candidates.slice(0, 8)
        };
        console.log(`  ${listing.title.slice(0, 34).padEnd(36)} ← ${candidate.title.replace('File:', '').slice(0, 52)}`);
        saved = true; fetched += 1; break;
      } catch { /* try the next candidate */ }
    }
    if (saved) break;
  }
  if (!saved) failed.push(listing.title);
}

await writeFile(creditsPath, `${JSON.stringify(credits, null, 2)}\n`, 'utf8');

const lines = ['# Photo credits', '',
  'Cover photographs come from Wikimedia Commons. Each is reused under the licence named below.',
  'CC BY and CC BY-SA require the photographer to be credited wherever the picture is shown; this',
  'build has no field for a credit line on a cover, so it is recorded here. Anything published for',
  'real needs the credit visible next to the image, and CC BY-SA also binds derivative works.', ''];
for (const entry of Object.values(credits).sort((a, b) => a.title.localeCompare(b.title))) {
  lines.push(`### ${entry.title}`, `- File: ${entry.commonsFile}`, `- Author: ${entry.author}`,
    `- Licence: ${entry.licence}${entry.licenceUrl ? ` (${entry.licenceUrl})` : ''}`, `- Source: ${entry.source}`, '');
}
await writeFile(resolve(OUT, 'CREDITS.md'), `${lines.join('\n')}\n`, 'utf8');

console.log('');
console.log(`fetched ${fetched}, already cached ${cached}, without a photo ${failed.length}`);
if (failed.length) console.log(failed.map(name => `  - ${name}`).join('\n'));
