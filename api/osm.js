// AquaSearcher map-data helper: fetches OpenStreetMap data on the server,
// tries several servers, and lets Vercel cache the answer for a week.
export const config = { maxDuration: 60 };
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
export default async function handler(req, res) {
  const q = String((req.query && req.query.q) || '');
  if (!q.startsWith('[out:json]') || q.length > 20000) { res.status(400).json({ error: 'bad query' }); return; }
  const deadline = Date.now() + 55000; let last = '';
  for (const u of SERVERS) {
    const left = deadline - Date.now(); if (left < 3000) break;
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AquaSearcher/1.0 (aquasearcher.com)' },
        body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(Math.min(30000, left)) });
      if (r.ok) { const txt = await r.text(); if (txt.trim().startsWith('{')) {
        res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
        res.setHeader('Content-Type', 'application/json'); res.status(200).send(txt); return; } last = u + ' sent a non-JSON reply'; }
      else last = u + ' HTTP ' + r.status;
    } catch (e) { last = u + ' ' + e.message; }
  }
  res.status(502).json({ error: 'All map servers are busy right now (' + last + ')' });
}
