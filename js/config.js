/**
 * KONFIGURASI — WAJIB diisi sebelum aplikasi bisa dipakai.
 *
 * Ganti teks di bawah dengan URL Web App Apps Script Anda (berakhiran /exec).
 * Contoh yang BENAR:
 *   const GAS_URL = 'https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxx/exec';
 *
 * Cara mendapatkannya: buka project Apps Script → Deploy → Manage deployments →
 * salin "Web app URL". Tes dulu di tab browser baru — harus muncul teks JSON
 * {"success":true,...,"message":"Absensi Siswa API aktif..."}, bukan halaman error.
 *
 * Setelah URL diganti: commit & push → tunggu hosting (GitHub Pages/Vercel)
 * selesai deploy → tekan Ctrl+Shift+R di browser.
 *
 * Jika URL masih berisi teks PASTE_..., aplikasi akan menampilkan banner merah
 * "Konfigurasi belum lengkap" dan menolak semua permintaan login.
 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzxTXmYzsODkslBBJslt1JVS4lmyap-qDsLok6esbobpnhpYpwybkGoYpilaRJixjBs/exec';
