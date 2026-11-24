# Penjualan otomatis: Lynk.id + Cloudflare Pages + Firebase

Alur: pembeli bayar di Lynk.id → Lynk.id mengirim webhook ke `/api/lynk` → pesanan lunas tercatat di Firestore →
pembeli membuka `klaim.html` dan mengisi EMAIL pembelian → `/api/klaim` membuat kode dan ebook langsung terbuka (aktivasi otomatis lewat `index.html?kode=...`).
Aturan Firestore dan admin tidak berubah. `index.html` WAJIB diganti dengan versi baru di paket ini (menambah aktivasi otomatis dari link; ganti juga `BUY_URL` di dalamnya dengan link produkmu di Lynk.id).

## Isi paket
- `functions/api/lynk.js`: penerima webhook Lynk.id
- `functions/api/klaim.js`: penukar pesanan lunas menjadi kode
- `functions/_lib/firestore.js`: penghubung ke Firestore (tanpa Admin SDK, jalan di Cloudflare)
- `klaim.html`: halaman untuk pembeli (cukup isi email)

## Langkah 1. Kunci akses server ke Firebase
1. Firebase Console > Project settings (ikon roda gigi) > **Service accounts** > **Generate new private key**.
2. File JSON terunduh. Kamu butuh dua isinya: `client_email` dan `private_key`.
3. Jangan taruh file ini di GitHub atau folder website.

## Langkah 2. Taruh file di proyek
Salin folder `functions/` dan file `klaim.html` ke **akar** proyek Cloudflare Pages ebook-mu (sejajar dengan `index.html`), lalu push ke GitHub.
Catatan: folder `functions/` hanya diproses bila Pages terhubung ke Git atau dideploy dengan Wrangler. Sejauh yang saya tahu, unggah drag-and-drop lewat dashboard tidak memprosesnya.

## Langkah 3. Isi Variables and Secrets
Cloudflare Dashboard > Workers & Pages > proyekmu > Settings > **Variables and secrets**. Tambahkan (tipe Secret untuk yang rahasia):

| Nama | Isi |
|---|---|
| `WEBHOOK_SECRET` | teks acak panjang buatanmu (mis. 32 huruf/angka), tanpa spasi |
| `FIREBASE_PROJECT_ID` | `ebook-4a0b4` |
| `FIREBASE_CLIENT_EMAIL` | `client_email` dari file JSON |
| `FIREBASE_PRIVATE_KEY` | `private_key` dari file JSON (seluruhnya, termasuk BEGIN/END) |
| `MAX_DEVICES` (opsional) | batas perangkat per kode, default 3 |
| `PRODUCT_MATCH` (opsional) | bagian nama produk ebook, bila kamu juga menjual produk lain di Lynk.id |

Setelah mengisi, deploy ulang agar variabel terbaca.

## Langkah 4. Pasang di Lynk.id
1. Lynk.id > Settings > Integrations > **Webhook**.
2. Isi URL: `https://DOMAINMU/api/lynk?key=ISI_WEBHOOK_SECRET` lalu **Save URL**.
3. Klik **Test URL**.
4. Buka produk ebook di Lynk.id. Pada isi yang dikirim setelah pembayaran, taruh link `https://DOMAINMU/klaim.html` dan tulis petunjuk singkat: "Buka link ini, isi email yang kamu pakai saat membayar, ebook langsung terbuka".

## Langkah 5. Cek bentuk asli data Lynk.id (penting)
Format isi webhook Lynk.id tidak saya temukan terdokumentasi publik, jadi parser dibuat longgar (mencari email, ID pesanan, dan status di mana saja dalam data).
1. Setelah Test URL, buka Firebase > Firestore > koleksi **webhook_logs**. Di situ tersimpan isi mentah dan header yang dikirim Lynk.id.
2. Lihat apakah ada header tanda tangan/signature. Bila ada, kabari saya supaya verifikasinya ditambahkan.
3. Lakukan satu pembelian percobaan sungguhan. Cek koleksi **orders**: harus muncul satu dokumen dengan `email` dan `trx` yang benar. Lalu uji `klaim.html` memakai email dan ID itu.
4. Kalau `orders` tidak terisi atau ID/email salah baca, kirim isi `body` di webhook_logs ke saya (hapus email asli), lalu parsernya saya kunci.
5. Uji juga kode hasilnya di ebook (pakai browser incognito).

## Cara kerja sehari-hari
- **Pembeli ganti HP / kode penuh**: Reset di `admin.html` (seperti biasa).
- **Refund**: bila Lynk.id mengirim event yang mengandung kata "refund", pesanan ditandai refunded dan kode dicabut otomatis. Kalau tidak, cabut manual dengan tombol Cabut di admin. Kode yang sudah dicabut tidak dibuat ulang.
- **Pembeli lupa kode**: cukup buka `klaim.html` lagi, kodenya sama.
- Kode manual dari admin tetap bisa dipakai untuk giveaway atau penjualan di tempat lain.

## Keamanan
- Koleksi `orders` dan `webhook_logs` tidak punya aturan di Firestore, jadi ditolak untuk semua pengunjung. Hanya server (service account) yang bisa membacanya, dan kamu lewat Firebase Console. `webhook_logs` berisi email pembeli: jangan dibagikan.
- Tambahkan aturan pembatas laju di Cloudflare: Security > WAF > Rate limiting rules, untuk path `/api/klaim` (mis. 10 permintaan per menit per IP). Ini mencegah orang menebak ID pesanan.
- Klaim hanya butuh email pembelian. Konsekuensinya, orang yang tahu email seorang pembeli bisa mendapat kode yang sama dengan pembeli itu (batas 3 perangkat tetap berlaku). Karena itu rate limiting di atas penting. Setiap pesanan hanya menghasilkan satu kode.
- Bila `WEBHOOK_SECRET` bocor, ganti nilainya di Cloudflare dan di URL webhook Lynk.id.
