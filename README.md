# Absensi Siswa — Frontend

Sistem presensi akademik sekolah (Sekretaris Kelas → Guru BK → Wali Kelas / Admin).

Frontend statis ini adalah **klien** dari backend Google Apps Script (REST API). Tidak ada server yang perlu dijalankan untuk frontend — cukup file HTML/CSS/JS statis, cocok untuk GitHub Pages, Netlify, Vercel, atau host statis manapun.

## Arsitektur

```
Browser (frontend statis)  --fetch()-->  Google Apps Script (REST API)  -->  Google Sheets (database)
```

- **`index.html`** — struktur halaman (login, sidebar, konten dinamis, modal)
- **`css/style.css`** — seluruh gaya visual
- **`js/config.js`** — **isi URL backend Anda di sini** sebelum deploy
- **`js/gas-shim.js`** — jembatan kompatibilitas: menyediakan `google.script.run` versi `fetch()`, supaya seluruh logika di `app.js` bisa dipakai tanpa perubahan
- **`js/app.js`** — seluruh logika aplikasi (routing, render halaman, form, rekap, dsb.)

## Setup cepat

1. Deploy backend GAS terlebih dahulu (lihat `PANDUAN-INSTALASI.md`), salin URL `/exec`
2. Isi `js/config.js`:
   ```js
   const GAS_URL = 'https://script.google.com/macros/s/XXXXXXXXXXXXX/exec';
   ```
3. Deploy folder ini ke GitHub Pages (atau host statis lain)

## Teknologi

Bootstrap 5, Bootstrap Icons, SheetJS (impor Excel), ExcelJS (ekspor rekap dengan styling), vanilla JavaScript (tanpa framework/bundler — bisa langsung dibuka sebagai file statis).

Selengkapnya lihat `PANDUAN-INSTALASI.md`.
