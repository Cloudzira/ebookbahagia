// Klien Firestore REST ringan untuk Cloudflare Workers/Pages Functions (tanpa Admin SDK).
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let tok = { v: null, exp: 0 };

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tok.v && tok.exp - 60 > now) return tok.v;
  const head = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64u(enc.encode(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  })));
  const pem = String(env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head + '.' + claim));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + head + '.' + claim + '.' + b64u(sig)
  });
  const j = await r.json();
  if (!r.ok) throw new Error('token ' + r.status + ' ' + JSON.stringify(j));
  tok = { v: j.access_token, exp: now + (j.expires_in || 3600) };
  return tok.v;
}

const toV = (v) => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? { integerValue: String(Math.trunc(v)) } : v instanceof Date ? { timestampValue: v.toISOString() }
  : Array.isArray(v) ? { arrayValue: v.length ? { values: v.map(toV) } : {} } : { mapValue: { fields: toF(v) } };
const toF = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toV(v)]));
const fromV = (v) => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? v.timestampValue : 'arrayValue' in v ? (v.arrayValue.values || []).map(fromV) : 'mapValue' in v ? fromF(v.mapValue.fields || {}) : null;
const fromF = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromV(v)]));

async function call(env, method, path, body) {
  const t = await accessToken(env);
  return fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, {
    method, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  });
}

export const safeId = (s) => 'o_' + String(s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);

export async function getDoc(env, col, id) {
  const r = await call(env, 'GET', `${col}/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('get ' + r.status);
  const j = await r.json();
  return { data: fromF(j.fields || {}), updateTime: j.updateTime };
}

// id = null -> ID otomatis. Mengembalikan 'created' atau 'exists'.
export async function createDoc(env, col, id, data) {
  const r = await call(env, 'POST', col + (id ? '?documentId=' + encodeURIComponent(id) : ''), { fields: toF(data) });
  if (r.status === 409) return 'exists';
  if (!r.ok) throw new Error('create ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return 'created';
}

// Ubah beberapa field. Dengan updateTime: hanya berhasil bila dokumen belum berubah (cegah klaim ganda).
export async function patchDoc(env, col, id, data, updateTime) {
  const q = Object.keys(data).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&')
    + (updateTime ? '&currentDocument.updateTime=' + encodeURIComponent(updateTime) : '&currentDocument.exists=true');
  const r = await call(env, 'PATCH', `${col}/${encodeURIComponent(id)}?${q}`, { fields: toF(data) });
  if (r.ok) return true;
  if (r.status === 400 || r.status === 404 || r.status === 409) return false;
  throw new Error('patch ' + r.status);
}

export async function delDoc(env, col, id) {
  const r = await call(env, 'DELETE', `${col}/${encodeURIComponent(id)}`);
  if (!r.ok && r.status !== 404) throw new Error('delete ' + r.status);
  return true;
}

// Cari pesanan lunas berdasarkan email (pembeli cukup mengisi email).
export async function ordersByEmail(env, email) {
  const t = await accessToken(env);
  const eq = (f, v) => ({ fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value: { stringValue: v } } });
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'orders' }], where: { compositeFilter: { op: 'AND', filters: [eq('email', email), eq('status', 'paid')] } }, limit: 10 } })
  });
  if (!r.ok) throw new Error('query ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (await r.json()).filter((x) => x.document).map((x) => ({ id: x.document.name.split('/').pop(), data: fromF(x.document.fields || {}), updateTime: x.document.updateTime }));
}
