// Builds data/places.tsv.gz from GeoNames dumps (CC BY 4.0, https://www.geonames.org/).
// Usage: node scripts/build-places.js <dir containing cities15000.txt, admin1CodesASCII.txt, countryInfo.txt>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/build-places.js <geonames-dir>'); process.exit(1); }
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n');

const countries = new Map();
for (const line of read('countryInfo.txt')) {
  if (!line || line.startsWith('#')) continue;
  const c = line.split('\t');
  countries.set(c[0], c[4]);
}
const admin1 = new Map();
for (const line of read('admin1CodesASCII.txt')) {
  if (!line) continue;
  const c = line.split('\t');
  admin1.set(c[0], c[1]);
}
const clean = (s) => String(s || '').replace(/[\t\n\r]/g, ' ').trim();
const rows = [];
for (const line of read('cities15000.txt')) {
  if (!line) continue;
  const c = line.split('\t');
  const [id, name, ascii, , lat, lon, , , cc, , a1] = c;
  const pop = Number(c[14]) || 0;
  rows.push([id, clean(name), clean(ascii), clean(admin1.get(`${cc}.${a1}`) || ''), clean(countries.get(cc) || cc), cc,
    Number(lat).toFixed(4), Number(lon).toFixed(4), pop, clean(c[17])].join('\t'));
}
const out = 'id\tname\tascii\tregion\tcountry\tcc\tlat\tlon\tpop\ttz\n' + rows.join('\n') + '\n';
fs.writeFileSync(new URL('../data/places.tsv.gz', import.meta.url), zlib.gzipSync(out, { level: 9 }));
console.log(`wrote ${rows.length} places`);
