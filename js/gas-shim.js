/**
 * ============================================================
 *  GAS-SHIM — Kompatibilitas google.script.run via fetch()
 * ============================================================
 * Aplikasi ini awalnya dibangun sebagai Google Apps Script Web App, di mana
 * frontend memanggil backend lewat `google.script.run.withSuccessHandler(fn)
 * .withFailureHandler(fn2).namaFungsi(arg1, arg2)`. Sekarang frontend berjalan
 * terpisah (GitHub Pages) dan backend GAS hanya jadi REST API murni (lihat
 * Kode.gs: doPost + API_ACTIONS).
 *
 * File ini menyediakan ULANG bentuk `google.script.run` yang PERSIS SAMA di
 * sisi klien, tapi di baliknya memanggil fetch() ke GAS_URL — sehingga SELURUH
 * kode di js/app.js (ribuan baris, puluhan halaman) tidak perlu ditulis ulang
 * sama sekali. Ini murni lapisan kompatibilitas transport, bukan pengganti
 * logika aplikasi.
 *
 * WAJIB dimuat SEBELUM js/app.js, dan SETELAH js/config.js (butuh GAS_URL).
 */
(function () {
  'use strict';

  // Bentuk URL Web App Apps Script yang valid (akun pribadi maupun domain Workspace):
  //   https://script.google.com/macros/s/<ID>/exec
  //   https://script.google.com/a/macros/<domain>/s/<ID>/exec
  var GAS_URL_PATTERN = /^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;
  var REQUEST_TIMEOUT_MS = 60000; // GAS bisa lambat saat "cold start" / impor data besar

  var MSG_NOT_CONFIGURED =
    'Alamat backend belum diatur. Buka file js/config.js di repository, ganti nilai GAS_URL dengan URL Web App ' +
    'Apps Script (yang berakhiran /exec), lalu simpan/commit dan tunggu deploy selesai.';

  function isGasUrlConfigured() {
    return typeof GAS_URL === 'string' && GAS_URL_PATTERN.test(GAS_URL.trim());
  }

  if (!isGasUrlConfigured()) {
    console.error('[gas-shim] GAS_URL di js/config.js belum valid (nilai saat ini: "' +
      (typeof GAS_URL === 'undefined' ? '(tidak terdefinisi)' : GAS_URL) + '"). Semua panggilan API akan ditolak.');
  }

  /** Banner peringatan permanen di atas halaman bila backend belum dikonfigurasi. */
  function showConfigBannerIfNeeded() {
    if (isGasUrlConfigured() || document.getElementById('gasConfigBanner')) return;
    var banner = document.createElement('div');
    banner.id = 'gasConfigBanner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;background:#b91c1c;color:#fff;' +
      'padding:.7rem 1rem;font:600 .85rem/1.4 Inter,system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25);';
    banner.textContent = '⚠️ Konfigurasi belum lengkap — ' + MSG_NOT_CONFIGURED;
    document.body.appendChild(banner);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showConfigBannerIfNeeded);
  else showConfigBannerIfNeeded();

  /**
   * Normalisasi respons server jadi bentuk {success,data,message} yang PASTI valid,
   * apapun yang sebenarnya dikembalikan (null, error jaringan, format tak dikenal).
   * Ini mencegah "Cannot read properties of null" di kode halaman manapun.
   */
  function normalizeResponse(res) {
    if (res === null || res === undefined) {
      return { success: false, data: null, message: 'Server tidak mengirim balasan. Coba ulangi — jika berulang, muat ulang halaman.' };
    }
    if (typeof res !== 'object' || !('success' in res)) {
      return { success: false, data: res, message: 'Format balasan server tidak dikenali.' };
    }
    return res;
  }

  /**
   * Panggil satu aksi backend. Setiap jenis kegagalan diberi pesan yang menjelaskan
   * PENYEBAB dan LANGKAH PERBAIKANNYA, bukan sekadar kode HTTP mentah.
   */
  async function callApi(action, params) {
    if (!isGasUrlConfigured()) throw new Error(MSG_NOT_CONFIGURED);

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    var res;
    try {
      res = await fetch(GAS_URL.trim(), {
        method: 'POST',
        // WAJIB text/plain — Content-Type application/json memicu CORS preflight (OPTIONS)
        // yang tidak bisa ditangani Google Apps Script Web App.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, params: params }),
        signal: controller.signal
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Server terlalu lama merespons (lebih dari ' + (REQUEST_TIMEOUT_MS / 1000) + ' detik). Coba lagi sebentar lagi.');
      }
      throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda lalu coba lagi. ' +
        'Jika masalah berulang, pastikan Web App di Apps Script di-deploy dengan "Who has access: Anyone".');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error('Server backend menjawab HTTP ' + res.status + '. Periksa GAS_URL di js/config.js dan pastikan deployment Web App masih aktif.');
    }

    var text = await res.text();
    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('Backend tidak mengembalikan data JSON. Kemungkinan URL bukan URL /exec yang benar, ' +
        'akses deployment belum "Anyone", atau Kode.gs versi REST API belum di-deploy ulang.');
    }
    return normalizeResponse(json);
  }

  /**
   * Bangun satu "runner" — objek chainable yang meniru persis API
   * google.script.run bawaan Apps Script: .withSuccessHandler(fn).withFailureHandler(fn2).namaAksi(...args)
   * Dibuat baru setiap kali `google.script.run` diakses, supaya handler sukses/gagal
   * dari satu pemanggilan tidak "bocor" dan tertukar dengan pemanggilan lain yang
   * dibuat sebelum promise-nya selesai (sesuai perilaku asli google.script.run).
   */
  function makeRunner() {
    let successHandler = null;
    let failureHandler = null;
    let proxy; // diisi setelah Proxy dibuat, supaya method di bawah bisa mengembalikan Proxy-nya sendiri

    const runner = {
      withSuccessHandler: function (fn) { successHandler = fn; return proxy; },
      withFailureHandler: function (fn) { failureHandler = fn; return proxy; }
    };

    proxy = new Proxy(runner, {
      get: function (target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string') return undefined;
        // Properti apapun selain withSuccessHandler/withFailureHandler dianggap
        // nama aksi backend — persis seperti memanggil google.script.run.namaFungsi(...)
        return function (...args) {
          callApi(prop, args).then(
            function (safeRes) {
              if (!successHandler) return;
              try { successHandler(safeRes); }
              catch (handlerErr) {
                // Sama seperti google.script.run asli: error di dalam handler sukses bukan kegagalan server.
                console.error('[gas-shim] Error di handler sukses untuk aksi "' + prop + '":', handlerErr);
                if (typeof showToast === 'function') showToast('Error', handlerErr.message || 'Terjadi kesalahan saat memproses data.', 'danger');
              }
            },
            function (err) {
              console.error('[gas-shim] Gagal memanggil aksi "' + prop + '":', err);
              if (failureHandler) failureHandler(err);
              else if (typeof showToast === 'function') showToast('Error', err.message || 'Gagal menghubungi server.', 'danger');
            }
          );
        };
      }
    });
    return proxy;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', {
    configurable: true,
    get: makeRunner
  });
})();
