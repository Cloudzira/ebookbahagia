// Penerima webhook Lynk.id. URL di Lynk.id: https://DOMAINMU/api/lynk?key=WEBHOOK_SECRET
import { createDoc, getDoc, patchDoc, delDoc, safeId } from '../_lib/firestore.js';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
// Cari field berdasarkan daftar nama (berurutan prioritas), di mana pun letaknya dalam JSON.
function find(o, names) {
  for (const n of names) {
    const want = norm(n), q = [o];
    while (q.length) {
      const x = q.shift();
      if (!x || typeof x !== 'object') continue;
      for (const [k, v] of Object.entries(x)) {
        if (norm(k) === want && (typeof v === 'string' || typeof v === 'number') && String(v).trim()) return String(v).trim();
        if (v && typeof v === 'object') q.push(v);
      }
    }
  }
  return '';
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

export async function onRequestPost({ request, env }) {
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!env.WEBHOOK_SECRET || !same(key, env.WEBHOOK_SECRET)) return new Response('unauthorized', { status: 401 });

  const raw = await request.text();
  const hdr = {};
  request.headers.forEach((v, k) => { if (!/^(cookie|authorization|cf-|x-forwarded|x-real)/i.test(k)) hdr[k] = v; });
  // Simpan salinan mentah supaya bentuk asli payload Lynk.id bisa dilihat di Firestore (koleksi webhook_logs).
  try { await createDoc(env, 'webhook_logs', null, { at: new Date(), headers: JSON.stringify(hdr), body: raw.slice(0, 30000) }); } catch (e) { console.log('log gagal', e.message); }

  let p; try { p = JSON.parse(raw); } catch { return json({ ok: true, parsed: false }); }
  if (env.PRODUCT_MATCH && !raw.toLowerCase().includes(String(env.PRODUCT_MATCH).toLowerCase())) return json({ ok: true, skipped: 'produk lain' });

  const email = find(p, ['customer_email', 'buyer_email', 'customerEmail', 'email']).toLowerCase();
  const trx = find(p, ['order_id', 'orderId', 'trx_id', 'trxId', 'transaction_id', 'transactionId', 'ref_id', 'refId', 'invoice_id', 'invoice', 'id']);
  const stat = [find(p, ['payment_status']), find(p, ['status']), find(p, ['event', 'event_name', 'type'])].join(' ');
  if (!trx) return json({ ok: true, parsed: false });
  const id = safeId(trx);

  if (/refund/i.test(stat)) {
    const o = await getDoc(env, 'orders', id);
    if (o) { await patchDoc(env, 'orders', id, { status: 'refunded' }); if (o.data.code) await delDoc(env, 'licenses', o.data.code); }
    return json({ ok: true, status: 'refunded' });
  }
  if (/cancel|expired|fail|void|pending|unpaid|waiting/i.test(stat)) return json({ ok: true, status: 'diabaikan' });

  const r = await createDoc(env, 'orders', id, { email, trx, status: 'paid', code: '', createdAt: new Date() });
  return json({ ok: true, order: r });
}
