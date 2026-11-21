// GTCG My Cards — eBay relay (Cloudflare Worker)
// Lets the app search eBay for card prices. It keeps your eBay keys private (they're never in the app's public files).
// Setup: paste this whole file into a Cloudflare Worker, then under Settings → Variables and Secrets add:
//   EBAY_CLIENT_ID      = your eBay Production App ID (Client ID)
//   EBAY_CLIENT_SECRET  = your eBay Production Cert ID (Client Secret)  ← choose type "Secret"
// Optional: ALLOW_ORIGIN = which sites may use this relay (comma-separated). Default: https://shannonst.github.io

let token = null, tokenExpires = 0;
async function getToken(env) {
  if (token && Date.now() < tokenExpires - 60000) return token;
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`) },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('eBay rejected the keys: ' + (j.error_description || j.error || r.status));
  token = j.access_token; tokenExpires = Date.now() + j.expires_in * 1000;
  return token;
}
export default {
  async fetch(req, env) {
    const allowed = (env.ALLOW_ORIGIN || 'https://shannonst.github.io').split(',').map(s => s.trim());
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0], 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const reply = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...cors, ...extra } });
    if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) return reply({ error: 'Relay is missing EBAY_CLIENT_ID / EBAY_CLIENT_SECRET' }, 500);
    const u = new URL(req.url);
    try {
      if (u.pathname.endsWith('/ping')) { await getToken(env); return reply({ ok: true }); }
      const q = (u.searchParams.get('q') || '').slice(0, 100);
      if (!q) return reply({ error: 'Add ?q=card number' }, 400);
      const market = /^EBAY_[A-Z]{2,3}$/.test(u.searchParams.get('market') || '') ? u.searchParams.get('market') : 'EBAY_AU';
      const api = 'https://api.ebay.com/buy/browse/v1/item_summary/search?' + new URLSearchParams({ q, limit: '50', filter: 'buyingOptions:{FIXED_PRICE}' });
      const r = await fetch(api, { headers: { Authorization: 'Bearer ' + await getToken(env), 'X-EBAY-C-MARKETPLACE-ID': market } });
      const j = await r.json();
      if (!r.ok) return reply({ error: (j.errors && j.errors[0] && j.errors[0].message) || 'eBay error ' + r.status }, 502);
      const items = (j.itemSummaries || []).map(i => ({
        title: i.title, price: i.price ? +i.price.value : null, cur: i.price ? i.price.currency : '',
        ship: i.shippingOptions && i.shippingOptions[0] && i.shippingOptions[0].shippingCost ? +i.shippingOptions[0].shippingCost.value : null,
        url: i.itemWebUrl, img: i.image ? i.image.imageUrl : '', cond: i.condition || '', seller: i.seller ? i.seller.username : '', from: i.itemLocation ? i.itemLocation.country : '',
      }));
      return reply({ items, total: j.total || 0, market }, 200, { 'Cache-Control': 'max-age=3600' });
    } catch (e) { return reply({ error: String(e.message || e) }, 500); }
  },
};
