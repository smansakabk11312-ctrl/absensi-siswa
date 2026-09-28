# 📋 PANDUAN INSTALASI — Absensi Siswa (Arsitektur Fullstack)

Aplikasi ini sekarang terdiri dari **dua bagian terpisah**:

- **Backend** — Google Apps Script, berperan sebagai REST API murni (tidak lagi menyajikan halaman web)
- **Frontend** — situs statis (HTML/CSS/JS) yang di-hosting di GitHub Pages, memanggil backend lewat `fetch()`

Ikuti urutan ini: **Backend dulu, baru Frontend** (frontend butuh URL backend untuk bisa jalan).

---

## === BAGIAN 1: BACKEND (Google Apps Script) ===

1. Buka https://script.google.com → **Proyek Baru**
2. Ganti isi file `Code.gs` bawaan dengan seluruh isi **`Kode.gs`** yang diberikan terpisah (bukan di dalam ZIP ini). Rename file itu jadi **"Kode"** (tanpa embel-embel lain).
3. Jalankan `setupAppEnvironment()` — **HANYA SEKALI**:
   - Dropdown fungsi di toolbar → pilih `setupAppEnvironment` → klik ▶ **Run**
   - Klik **Review permissions** → izinkan akses Google Sheets & Drive
   - Buka **Execution Log** (Ctrl+Enter) → pastikan muncul `✅ Setup selesai!`
   - ⚠️ **Jangan jalankan fungsi ini lebih dari sekali** — akan membuat folder/sheet duplikat
4. **Deploy** → **New deployment** → pilih tipe **Web app**
   - **Execute as:** Me
   - **Who has access:** Anyone
   - Klik **Deploy** → salin **URL yang diakhiri `/exec`** — ini `GAS_URL` yang dibutuhkan frontend
5. Buka URL `/exec` itu langsung di browser. Kalau backend sudah benar, akan muncul JSON seperti ini (bukan halaman kosong lagi — sekarang backend murni API):
   ```json
   {"success":true,"data":{"app":"Absensi Siswa","mode":"REST API"},"message":"Absensi Siswa API aktif. Gunakan POST untuk memanggil aksi."}
   ```

---

## === BAGIAN 2: FRONTEND (GitHub Pages) ===

1. **Ekstrak ZIP** yang diberikan — isinya sudah berupa **root folder proyek**, jangan buat folder pembungkus tambahan.
2. **WAJIB diisi dulu sebelum di-push**: buka `js/config.js`, ganti baris:
   ```js
   const GAS_URL = 'PASTE_URL_EXEC_APPS_SCRIPT_DI_SINI';
   ```
   menjadi URL `/exec` yang Anda salin di langkah Backend #4.
3. Ikuti panduan **deploy ke GitHub Pages** langkah demi langkah (disediakan terpisah, atau minta bantuan lanjutan) — intinya: `git init` di folder hasil ekstrak ini (folder yang berisi `index.html` langsung, bukan folder induknya), lalu push ke repository GitHub, aktifkan GitHub Pages di Settings.

### Struktur folder ZIP ini
```
(folder hasil ekstrak — INI yang di-git init)
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── config.js       ← WAJIB diisi URL backend
│   ├── gas-shim.js      ← jangan diubah, menjembatani ke backend
│   └── app.js           ← seluruh logika aplikasi
├── README.md
└── PANDUAN-INSTALASI.md (berkas ini)
```

---

## === TEST ===

1. Buka situs GitHub Pages Anda setelah online (`https://USERNAME.github.io/NAMA-REPO/`)
2. Halaman login harus muncul (bukan blank)
3. Login pakai akun contoh (PIN semua `123456`):
   - Admin → `admin@sekolah.sch.id`
   - Guru BK → `siti.rahayu@sekolah.sch.id`
   - Wali Kelas → `bambang.s@sekolah.sch.id`
   - Sekretaris Kelas → `indah.k@sekolah.sch.id`
4. Buka **Chrome DevTools → Network** → pastikan ada request POST ke URL `/exec` Anda dan responsnya JSON (bukan error CORS merah)
5. Coba navigasi antar halaman, tambah data, submit absensi — semua harus berfungsi persis seperti versi GAS sebelumnya

---

## Kalau ada masalah

| Gejala | Kemungkinan penyebab |
|---|---|
| Halaman blank / form login tidak muncul | `css/style.css` atau `js/*.js` 404 — struktur folder rusak saat push (lihat panduan GitHub Pages, bagian "Prosedur Perbaikan") |
| Banner merah "Konfigurasi belum lengkap", atau notifikasi "Alamat backend belum diatur"; di Console ada request ke `/PASTE_URL_EXEC_APPS_SCRIPT_DI_SINI` yang 404 | `js/config.js` masih berisi teks placeholder. Ganti `GAS_URL` dengan URL `/exec`, commit & push, tunggu hosting selesai deploy, lalu Ctrl+Shift+R |
| Notifikasi "Backend tidak mengembalikan data JSON" | URL bukan URL `/exec` yang benar, akses deployment belum **Anyone**, atau `Kode.gs` versi REST belum di-deploy ulang |
| Notifikasi "Tidak dapat terhubung ke server" | Internet terputus, atau deployment Web App tidak diatur **Who has access: Anyone** |
| Error CORS di Console | Pastikan **tidak** mengubah header `Content-Type` di `gas-shim.js` — harus tetap `text/plain;charset=utf-8` |
| Data tidak muncul padahal login sukses | Backend belum di-deploy ulang setelah update `Kode.gs`, atau `setupAppEnvironment()` belum dijalankan |
| Situs tampil versi lama setelah update | Cache browser — tekan **Ctrl+Shift+R** |
