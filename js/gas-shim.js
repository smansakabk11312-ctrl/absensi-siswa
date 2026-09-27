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

  if (typeof GAS_URL === 'undefined' || !GAS_URL) {
    console.error('[gas-shim] GAS_URL belum diisi di js/config.js — semua panggilan API akan gagal.');
  }

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

  async function callApi(action, params) {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      // WAJIB text/plain — Content-Type application/json memicu CORS preflight (OPTIONS)
      // yang tidak bisa ditangani Google Apps Script Web App.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, params: params })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' dari server.');
    const json = await res.json();
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
          callApi(prop, args)
            .then(function (safeRes) {
              if (successHandler) successHandler(safeRes);
            })
            .catch(function (err) {
              console.error('[gas-shim] Error memanggil aksi "' + prop + '":', err);
              if (failureHandler) failureHandler(err);
              else if (typeof showToast === 'function') showToast('Error', err.message || 'Gagal menghubungi server.', 'danger');
            });
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
