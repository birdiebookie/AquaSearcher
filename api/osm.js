// AquaSearcher map-data helper: fetches OpenStreetMap data on the server,
// tries several servers (two ways each), and lets Vercel cache answers for a week.
export const config = { maxDuration: 60 };
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const UA = 'AquaSearcher/1.0 (+https://aquasearcher.com; missing-person water search)';
export default async function handler(req, res) {
  const q = String((req.query && req.query.q) || '');
  if (!q.startsWith('[out:json]') || q.length > 20000) { res.status(400).json({ error: 'bad query' }); return; }
  const deadline = Date.now() + 55000, errors = [];
  for (const u of SERVERS) {
    for (const how of ['post', 'get']) {
      const left = deadline - Date.now(); if (left < 3000) break;
      try {
        const opt = { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(Math.min(25000, left)) };
        let r;
        if (how === 'post') { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opt.body = 'data=' + encodeURIComponent(q); r = await fetch(u, opt); }
        else r = await fetch(u + '?data=' + encodeURIComponent(q), opt);
        const txt = await r.text();
        if (r.ok && txt.trim().startsWith('{')) {
          res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
          res.setHeader('Content-Type', 'application/json'); res.setHeader('X-AquaSearcher-Source', u);
          res.status(200).send(txt); return;
        }
        errors.push(u.replace('https://', '') + ' ' + how + ': HTTP ' + r.status + ' ' + txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120));
        if (r.status === 400) break;
      } catch (e) { errors.push(u.replace('https://', '') + ' ' + how + ': ' + (e.name === 'TimeoutError' ? 'timed out' : e.message)); }
    }
  }
  res.status(502).json({ error: 'All map servers failed', details: errors });
}
