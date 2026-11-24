// Pembeli cukup memasukkan email pembelian. Server mencari pesanan lunas dan memberikan kodenya.
import { getDoc, createDoc, patchDoc, delDoc, ordersByEmail } from '../_lib/firestore.js';

const AL = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const gen = () => { const c = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => AL[x % AL.length]); return 'BTS-' + [0, 4, 8].map((i) => c.slice(i, i + 4).join('')).join('-'); };
const out = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { return out({ error: 'bad' }, 400); }
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return out({ error: 'bad' }, 400);
  try {
    const orders = (await ordersByEmail(env, email)).sort((x, y) => String(x.data.createdAt).localeCompare(String(y.data.createdAt)));
    if (!orders.length) return out({ error: 'notfound' }, 404);

    let revoked = false; // pesanan yang sudah punya kode: kirim kode yang sama, kecuali sudah dicabut di admin
    for (const o of orders) if (o.data.code) { if (await getDoc(env, 'licenses', o.data.code)) return out({ code: o.data.code }); revoked = true; }

    const o = orders.find((x) => !x.data.code); // pesanan lunas yang belum pernah diklaim
    if (!o) return out({ error: revoked ? 'revoked' : 'notfound' }, revoked ? 410 : 404);
    const code = gen();
    await createDoc(env, 'licenses', code, { max: +env.MAX_DEVICES || 3, uids: [], note: 'lynk ' + (o.data.trx || o.id), createdAt: new Date() });
    if (!(await patchDoc(env, 'orders', o.id, { code, claimedAt: new Date() }, o.updateTime))) { // klaim bersamaan: pakai kode pemenang
      await delDoc(env, 'licenses', code);
      const o2 = await getDoc(env, 'orders', o.id);
      return o2 && o2.data.code ? out({ code: o2.data.code }) : out({ error: 'busy' }, 409);
    }
    return out({ code });
  } catch (e) { console.log('klaim gagal', e.message); return out({ error: 'server' }, 500); }
}
