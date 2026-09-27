/**
 * ============================================================
 *  ABSENSI SISWA — Frontend SPA (JavaScript.html)
 *  Router murni client-side (tanpa google.script.run untuk pindah
 *  halaman), aman iframe: tidak pernah memakai window.location.
 * ============================================================
 */

// ════════════════════════════════════════════════════════
// STATE APLIKASI (di memori, BUKAN di URL)
// ════════════════════════════════════════════════════════
const AppState = {
  token: null, role: null, nama: null, email: null, kelasId: null,
  currentPage: null,
  master: { siswa: [], kelas: [], guru: [], pengguna: [], config: {} },
  entity: { key: null, editingId: null },
  bulk: { selected: new Set() }
};

// (Pelindung respons null/rusak kini bagian dari js/gas-shim.js)

// ════════════════════════════════════════════════════════
// PENANGKAP ERROR GLOBAL — mencegah layar "blank diam-diam".
// Kalau ada error JS apapun, langsung tampil di layar + console,
// sehingga mudah didiagnosis tanpa perlu pindah context DevTools.
// ════════════════════════════════════════════════════════
function renderFatalError(title, detail) {
  hideLoadingOverlay();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fef2f2;color:#7f1d1d;padding:2rem;overflow:auto;font-family:monospace;';
  box.innerHTML = `<h4 style="color:#b91c1c;">⚠️ ${title}</h4><pre style="white-space:pre-wrap;font-size:.85rem;background:#fff;border:1px solid #fca5a5;border-radius:8px;padding:1rem;">${(detail || '').toString().replace(/</g,'&lt;')}</pre>
  <p style="font-size:.8rem;">Periksa Console (F12) — jika tampilan ini muncul di dalam iframe Apps Script, pastikan context DevTools sudah dipindah dari "top" ke frame aplikasi.</p>`;
  document.body.appendChild(box);
}
window.addEventListener('error', e => renderFatalError('Terjadi Error JavaScript', (e.error && e.error.stack) || e.message));
window.addEventListener('unhandledrejection', e => renderFatalError('Terjadi Error (Promise)', (e.reason && e.reason.stack) || e.reason));

setTimeout(() => {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay && overlay.style.display !== 'none') {
    renderFatalError('Aplikasi Macet Saat Memuat (Timeout)',
      'Proses masih menunggu respons setelah 8 detik. Kemungkinan penyebab:\n' +
      '1) Fungsi setupAppEnvironment() belum pernah dijalankan/diotorisasi di editor Apps Script.\n' +
      '2) Izin (scope) skrip belum disetujui — buka editor Apps Script, jalankan setupAppEnvironment() manual dan setujui izin.\n' +
      '3) Deployment yang diakses adalah versi lama — buat "New deployment" setelah setiap perubahan kode.\n' +
      '4) Koneksi ke script.google.com diblokir ekstensi browser — coba mode Incognito.');
  }
}, 8000);

document.addEventListener('DOMContentLoaded', () => {
  try {
    if (typeof google === 'undefined' || !google.script || !google.script.run) {
      renderFatalError('Lingkungan Apps Script Tidak Terdeteksi',
        'Objek google.script.run tidak tersedia. Kemungkinan penyebab:\n' +
        '1) Halaman tidak dibuka lewat URL .../exec resmi Apps Script.\n' +
        '2) Ekstensi browser (ad-blocker/privacy extension) memblokir skrip Google.\n' +
        '3) Deployment belum dibuat ulang setelah edit kode (buat "New deployment" atau versi baru).\n' +
        'Coba buka URL /exec di jendela Incognito tanpa ekstensi aktif.');
      return;
    }
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    installScrollHintObserver();

    const savedToken = localStorage.getItem('absensi_token');
    if (savedToken) {
      AppState.token = savedToken;
      bootstrapSession();
    } else {
      hideLoadingOverlay();
      renderLogin();
    }
  } catch (err) {
    renderFatalError('Gagal Memuat Aplikasi', err.stack || err.message);
  }
});

function bootstrapSession() {
  google.script.run
    .withSuccessHandler(res => {
      if (res.success) {
        AppState.role = res.data.session.role;
        AppState.nama = res.data.session.nama;
        AppState.email = res.data.session.email;
        AppState.kelasId = res.data.session.kelasId;
        AppState.master = Object.assign(AppState.master, res.data);
        showAppShell();
        navigateTo(landingPageFor(AppState.role));
      } else {
        localStorage.removeItem('absensi_token');
        renderLogin();
      }
      hideLoadingOverlay();
    })
    .withFailureHandler(() => { localStorage.removeItem('absensi_token'); renderLogin(); hideLoadingOverlay(); })
    .getMasterDataBundle(AppState.token);
}

function landingPageFor(role) {
  return { Admin: 'admin-dashboard', GuruBK: 'bk-dashboard', WaliKelas: 'wali-rekap', SekretarisKelas: 'sekretaris-absensi' }[role] || 'login';
}

// ════════════════════════════════════════════════════════
// ROUTER SPA — satu-satunya cara pindah halaman
// ════════════════════════════════════════════════════════
const PAGE_TITLES = {
  'admin-dashboard': 'Dashboard Admin', 'admin-siswa': 'Kelola Data Siswa', 'admin-kelas': 'Kelola Data Kelas',
  'admin-guru': 'Kelola Data Guru', 'admin-pengguna': 'Pengguna & Peran', 'admin-walikelas': 'Kelola Wali Kelas',
  'admin-harilibur': 'Hari Besar Nasional',
  'sekretaris-absensi': 'Absensi Kolektif', 'sekretaris-susulan': 'Absensi Susulan', 'bk-dashboard': 'Dashboard BK', 'bk-validasi': 'Validasi Absen',
  'bk-edit-lampau': 'Edit Absen Lampau', 'bk-rekap': 'Rekap & Cetak', 'wali-rekap': 'Monitoring Kelas Saya'
};

/**
 * Ambil ulang data master (Siswa/Kelas/Guru/Config) dari server sebelum merender halaman.
 * Ini memastikan perubahan yang dibuat Admin (tambah siswa/kelas/guru, ubah wali kelas, dst.)
 * langsung terlihat di sesi Guru BK/Wali Kelas/Sekretaris yang sudah login sebelumnya —
 * tanpa perlu logout-login ulang.
 */
function refreshMasterBundleThen(callback) {
  google.script.run
    .withSuccessHandler(res => {
      if (res.success) {
        AppState.master = Object.assign(AppState.master, res.data);
        // Sinkronkan juga properti sesi tingkat-atas (kelasId/role/nama) — kalau Admin
        // mengubah penempatan kelas seorang Sekretaris/Wali Kelas setelah mereka login,
        // perubahan ini langsung berlaku tanpa perlu logout-login ulang.
        if (res.data.session) {
          const kelasIdBerubah = AppState.kelasId !== res.data.session.kelasId;
          AppState.kelasId = res.data.session.kelasId;
          AppState.role = res.data.session.role;
          AppState.nama = res.data.session.nama;
          if (kelasIdBerubah) {
            document.getElementById('sidebarUserRole') && (document.getElementById('sidebarUserRole').textContent = ROLE_LABEL[AppState.role] || AppState.role);
          }
        }
      }
      callback();
    })
    .withFailureHandler(() => callback()) // tetap render dengan data lama kalau refresh gagal (mis. offline sesaat)
    .getMasterDataBundle(AppState.token);
}

function navigateTo(pageName) {
  AppState.currentPage = pageName;
  document.getElementById('pageTitle').textContent = PAGE_TITLES[pageName] || 'Halaman';
  updateActiveNav(pageName);
  closeSidebar();

  const renderers = {
    'admin-dashboard': renderAdminDashboard,
    'admin-siswa': () => renderMasterDataPage('siswa'),
    'admin-kelas': () => renderMasterDataPage('kelas'),
    'admin-guru': () => renderMasterDataPage('guru'),
    'admin-pengguna': () => renderMasterDataPage('pengguna'),
    'admin-walikelas': renderAdminWaliKelas,
    'admin-harilibur': () => renderMasterDataPage('harilibur'),
    'sekretaris-absensi': renderSekretarisAbsensi,
    'sekretaris-susulan': renderSekretarisSusulan,
    'bk-dashboard': renderBkDashboard,
    'bk-validasi': renderBkValidasi,
    'bk-edit-lampau': renderBkEditLampau,
    'bk-rekap': renderBkRekap,
    'wali-rekap': renderWaliRekap
  };
  const renderFn = renderers[pageName] || renderNotFound;
  refreshMasterBundleThen(renderFn);
}

function updateActiveNav(pageName) {
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === pageName));
}
function setContainer(html) {
  document.getElementById('app-container').innerHTML = `<div class="content-section">${html}</div>`;
  setupScrollHints();
}

/**
 * Tambahan khusus mobile: beri penanda "geser →" pada tabel yang lebih lebar
 * dari layar, agar pengguna HP tahu tabel bisa digeser horizontal. Murni
 * kosmetik — tidak mengubah struktur tabel maupun perilaku halaman.
 */
function setupScrollHints() {
  // Tunggu render selesai (termasuk tabel yang diisi belakangan lewat AJAX)
  setTimeout(() => {
    document.querySelectorAll('#app-container .table-responsive').forEach(tr => {
      let wrap = tr.parentElement;
      if (!wrap || !wrap.classList.contains('scroll-hint-wrap')) {
        wrap = document.createElement('div');
        wrap.className = 'scroll-hint-wrap';
        tr.parentNode.insertBefore(wrap, tr);
        wrap.appendChild(tr);
        const badge = document.createElement('span');
        badge.className = 'scroll-hint-badge';
        badge.textContent = 'geser →';
        wrap.appendChild(badge);
        tr.addEventListener('scroll', () => {
          const atEnd = tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 4;
          wrap.classList.toggle('scrolled-end', atEnd);
        }, { passive: true });
      }
      wrap.classList.toggle('is-scrollable', tr.scrollWidth > tr.clientWidth + 4);
    });
  }, 250);
}

/**
 * Pantau perubahan isi halaman agar indikator geser juga berlaku untuk tabel
 * yang baru dimuat belakangan (hasil pemanggilan server), bukan hanya saat
 * halaman pertama dirender. Dipasang sekali saja.
 */
function installScrollHintObserver() {
  const container = document.getElementById('app-container');
  if (!container || container._scrollHintObserverInstalled) return;
  let pending = null;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(setupScrollHints, 150); // digabung agar tidak berjalan berkali-kali
  });
  observer.observe(container, { childList: true, subtree: true });
  container._scrollHintObserverInstalled = true;
}
window.addEventListener('resize', () => setupScrollHints());
function renderNotFound() { setContainer('<div class="empty-state"><i class="bi bi-signpost-2"></i><p>Halaman tidak ditemukan.</p></div>'); }

// ════════════════════════════════════════════════════════
// UTILITAS UI
// ════════════════════════════════════════════════════════
function hideLoadingOverlay() {
  const el = document.getElementById('loadingOverlay');
  if (el) { el.style.opacity = '0'; setTimeout(() => el.style.display = 'none', 250); }
}
function showToast(title, message, type) {
  type = type || 'info';
  const icons = { success: 'bi-check-circle-fill text-success', danger: 'bi-x-circle-fill text-danger', warning: 'bi-exclamation-triangle-fill text-warning', info: 'bi-info-circle-fill text-primary' };
  document.getElementById('toastIcon').className = 'bi ' + (icons[type] || icons.info) + ' me-2';
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastBody').textContent = message;
  new bootstrap.Toast(document.getElementById('appToast'), { delay: 4500 }).show();
}
function showLoadingInline(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted small">Memuat data…</p></div>';
}
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('show'); document.querySelector('.sidebar-overlay').classList.toggle('show'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('show'); document.querySelector('.sidebar-overlay').classList.remove('show'); }
function escapeHtml(str) { return (str === undefined || str === null) ? '' : String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
/**
 * Perbandingan string manual untuk sortir — SENGAJA tidak memakai String.prototype.localeCompare().
 * Di sebagian lingkungan Apps Script, lapisan keamanan internal Google membungkus skrip klien
 * dan pernah terbukti mengubah nama method ini secara acak saat runtime (localeCompare -> LocaleCompare),
 * menyebabkan "TypeError: ...LocaleCompare is not a function" dan halaman gagal render total.
 * Perbandingan manual ini menghindari method tersebut sepenuhnya sehingga kebal dari masalah itu.
 */
function safeCompare(a, b) {
  a = String(a === undefined || a === null ? '' : a);
  b = String(b === undefined || b === null ? '' : b);
  return a < b ? -1 : (a > b ? 1 : 0);
}
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function confirmAction(title, body, onConfirm) {
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalBody').textContent = body;
  const btn = document.getElementById('confirmModalBtn');
  const modal = new bootstrap.Modal(document.getElementById('confirmModal'));
  btn.onclick = () => { modal.hide(); onConfirm(); };
  modal.show();
}

// ════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ════════════════════════════════════════════════════════
function renderLogin() {
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('mainContent').classList.add('full');
  document.getElementById('app-container').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo"><i class="bi bi-mortarboard-fill"></i></div>
        <h4 class="fw-bold mb-1">Absensi Siswa</h4>
        <p class="text-muted small mb-4">Masuk dengan akun Google Workspace sekolah Anda.</p>
        <form id="loginForm" onsubmit="handleLogin(event)">
          <div class="mb-3">
            <label class="form-label">Email Sekolah</label>
            <input type="email" class="form-control" id="loginEmail" placeholder="nama@sekolah.sch.id" required>
          </div>
          <div class="mb-3">
            <label class="form-label">PIN / Kata Sandi</label>
            <input type="password" class="form-control" id="loginPin" required>
          </div>
          <button type="submit" class="btn btn-primary w-100 py-2">
            <i class="bi bi-box-arrow-in-right"></i> Masuk
          </button>
          <p class="text-muted small text-center mt-3 mb-0">Contoh: admin@sekolah.sch.id · PIN 123456</p>
        </form>
      </div>
    </div>`;
}

function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const pin = document.getElementById('loginPin').value;
  const btn = event.target.querySelector('button[type="submit"]');
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-inline"></span> Memproses…'; btn.disabled = true;

  google.script.run
    .withSuccessHandler(res => {
      btn.innerHTML = original; btn.disabled = false;
      if (!res.success) { showToast('Gagal Masuk', res.message, 'danger'); return; }
      AppState.token = res.data.token;
      AppState.role = res.data.role; AppState.nama = res.data.nama; AppState.kelasId = res.data.kelasId;
      localStorage.setItem('absensi_token', AppState.token);
      showToast('Selamat Datang', `Halo, ${res.data.nama}!`, 'success');
      loadBundleThenEnter(res.data.landingPage);
    })
    .withFailureHandler(err => { btn.innerHTML = original; btn.disabled = false; showToast('Error', err.message, 'danger'); })
    .doLogin(email, pin);
}

function loadBundleThenEnter(landingPage) {
  google.script.run
    .withSuccessHandler(res => {
      if (res.success) { AppState.master = Object.assign(AppState.master, res.data); showAppShell(); navigateTo(landingPage); }
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getMasterDataBundle(AppState.token);
}

function showAppShell() {
  document.getElementById('sidebar').style.display = 'flex';
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('mainContent').classList.remove('full');
  document.getElementById('appTitle').textContent = AppState.master.config.appName || 'Absensi Siswa';
  document.getElementById('sidebarRoleBadge').textContent = AppState.master.config.tahunAjaran || '';
  document.getElementById('sidebarUserName').textContent = AppState.nama;
  document.getElementById('sidebarUserRole').textContent = ROLE_LABEL[AppState.role] || AppState.role;
  document.getElementById('sidebarUserInitial').textContent = (AppState.nama || '?').charAt(0).toUpperCase();
  renderNavigation(AppState.role);
}

const ROLE_LABEL = { Admin: 'Administrator', GuruBK: 'Guru BK', WaliKelas: 'Wali Kelas', SekretarisKelas: 'Sekretaris Kelas' };

function renderNavigation(role) {
  const menus = {
    Admin: [
      { section: 'Master Data & Sistem' },
      { id: 'admin-dashboard', icon: 'bi-grid-1x2-fill', label: 'Dashboard Admin' },
      { id: 'admin-siswa', icon: 'bi-mortarboard', label: 'Kelola Data Siswa' },
      { id: 'admin-kelas', icon: 'bi-building', label: 'Kelola Data Kelas' },
      { id: 'admin-guru', icon: 'bi-person-badge', label: 'Kelola Data Guru' },
      { id: 'admin-pengguna', icon: 'bi-people-fill', label: 'Pengguna & Peran' },
      { id: 'admin-walikelas', icon: 'bi-person-check', label: 'Kelola Wali Kelas' },
      { id: 'admin-harilibur', icon: 'bi-calendar-heart', label: 'Hari Besar Nasional' }
    ],
    GuruBK: [
      { section: 'Modul Presensi' },
      { id: 'bk-dashboard', icon: 'bi-grid-1x2-fill', label: 'Dashboard BK' },
      { id: 'bk-validasi', icon: 'bi-patch-check', label: 'Validasi Absen' },
      { id: 'bk-edit-lampau', icon: 'bi-pencil-square', label: 'Edit Absen Lampau' },
      { section: 'Laporan' },
      { id: 'bk-rekap', icon: 'bi-printer', label: 'Rekap & Cetak' }
    ],
    WaliKelas: [
      { section: 'Laporan' },
      { id: 'wali-rekap', icon: 'bi-bar-chart-line', label: 'Monitoring Kelas Saya' }
    ],
    SekretarisKelas: [
      { section: 'Modul Presensi' },
      { id: 'sekretaris-absensi', icon: 'bi-clipboard-check', label: 'Absensi Kolektif' },
      { id: 'sekretaris-susulan', icon: 'bi-calendar-plus', label: 'Absensi Susulan' }
    ]
  };
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = (menus[role] || []).map(m => m.section
    ? `<li class="nav-section-label">${m.section}</li>`
    : `<li><a href="javascript:void(0)" class="nav-link" data-page="${m.id}" onclick="navigateTo('${m.id}')"><i class="bi ${m.icon}"></i> <span>${m.label}</span></a></li>`
  ).join('');
}

function handleLogout() {
  google.script.run.withSuccessHandler(() => finishLogout()).withFailureHandler(() => finishLogout()).doLogout(AppState.token);
}
function finishLogout() {
  localStorage.removeItem('absensi_token');
  Object.assign(AppState, { token: null, role: null, nama: null, kelasId: null, currentPage: null });
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('topbar').style.display = 'none';
  renderLogin();
}

// ════════════════════════════════════════════════════════
// SKEMA ENTITAS — Master Data CRUD Generik
// ════════════════════════════════════════════════════════
const ENTITY_SCHEMA = {
  siswa: {
    sheet: 'Siswa', label: 'Siswa', icon: 'bi-mortarboard',
    columns: [
      { key: 'NISN', label: 'NISN', mono: true }, { key: 'Nama', label: 'Nama Lengkap' },
      { key: 'JenisKelamin', label: 'L/P' }, { key: 'KelasID', label: 'Kelas', lookup: 'kelas', lookupLabel: 'NamaKelas' },
      { key: 'StatusAktif', label: 'Status', pill: true }
    ],
    fields: [
      { key: 'NISN', label: 'NISN', type: 'text', required: true },
      { key: 'NIK', label: 'NIK', type: 'text' },
      { key: 'Nama', label: 'Nama Lengkap', type: 'text', required: true, full: true },
      { key: 'JenisKelamin', label: 'Jenis Kelamin', type: 'select', options: ['Laki-laki', 'Perempuan'], required: true },
      { key: 'TempatLahir', label: 'Tempat Lahir', type: 'text' },
      { key: 'TanggalLahir', label: 'Tanggal Lahir', type: 'text', placeholder: 'DD/MM/YYYY' },
      { key: 'Agama', label: 'Agama', type: 'text' },
      { key: 'KelasID', label: 'Kelas', type: 'select', lookup: 'kelas', lookupLabel: 'NamaKelas', required: true },
      { key: 'NomorAbsen', label: 'Nomor Urut Absen', type: 'text' },
      { key: 'TahunMasuk', label: 'Tahun Masuk', type: 'text' },
      { key: 'NamaWali', label: 'Nama Orang Tua/Wali', type: 'text' },
      { key: 'NoWaliWA', label: 'No. WhatsApp Wali', type: 'text' },
      { key: 'EmailSiswa', label: 'Email Siswa', type: 'text' },
      { key: 'StatusAktif', label: 'Status', type: 'select', options: ['Aktif', 'Nonaktif'] },
      { key: 'Catatan', label: 'Catatan Khusus', type: 'textarea', full: true }
    ]
  },
  kelas: {
    sheet: 'Kelas', label: 'Kelas', icon: 'bi-building',
    columns: [
      { key: 'NamaKelas', label: 'Nama Kelas' }, { key: 'Tingkat', label: 'Tingkat' },
      { key: 'Jurusan', label: 'Jurusan' }, { key: 'WaliKelasID', label: 'Wali Kelas', lookup: 'guru', lookupLabel: 'Nama' },
      { key: 'Kapasitas', label: 'Kapasitas', mono: true }
    ],
    fields: [
      { key: 'NamaKelas', label: 'Nama Kelas', type: 'text', required: true, placeholder: 'X RPL 1' },
      { key: 'Tingkat', label: 'Tingkat', type: 'select', options: ['X', 'XI', 'XII'], required: true },
      { key: 'Jurusan', label: 'Jurusan / Program', type: 'text' },
      { key: 'RuangKelas', label: 'Ruang Kelas', type: 'text' },
      { key: 'WaliKelasID', label: 'Wali Kelas', type: 'select', lookup: 'guru', lookupLabel: 'Nama' },
      { key: 'Kapasitas', label: 'Kapasitas Siswa', type: 'text', placeholder: '36' }
    ]
  },
  guru: {
    sheet: 'Guru', label: 'Guru', icon: 'bi-person-badge',
    columns: [
      { key: 'NIP', label: 'NIP/NUPTK', mono: true }, { key: 'Nama', label: 'Nama Guru' },
      { key: 'Peran', label: 'Peran', pill: true }, { key: 'Kontak', label: 'Kontak' }
    ],
    fields: [
      { key: 'NIP', label: 'NIP / NUPTK', type: 'text', required: true },
      { key: 'Nama', label: 'Nama Lengkap & Gelar', type: 'text', required: true, full: true },
      { key: 'Peran', label: 'Peran Utama', type: 'select', options: ['Wali Kelas', 'Guru BK', 'Guru Mapel'], required: true },
      { key: 'MataPelajaran', label: 'Mata Pelajaran', type: 'text' },
      { key: 'Kontak', label: 'No. Kontak', type: 'text' },
      { key: 'Email', label: 'Email Sekolah', type: 'text' },
      { key: 'StatusKepegawaian', label: 'Status Kepegawaian', type: 'select', options: ['PNS/PPPK', 'GTT/Honorer'] }
    ]
  },
  pengguna: {
    sheet: 'Pengguna', label: 'Pengguna', icon: 'bi-people-fill',
    columns: [
      { key: 'Nama', label: 'Nama' }, { key: 'Email', label: 'Email' },
      { key: 'Role', label: 'Peran', pill: true }, { key: 'KelasID', label: 'Kelas Terkait', lookup: 'kelas', lookupLabel: 'NamaKelas' },
      { key: 'StatusAktif', label: 'Status', pill: true }
    ],
    fields: [
      { key: 'Nama', label: 'Nama Lengkap', type: 'text', required: true, full: true },
      { key: 'Email', label: 'Email Sekolah (login)', type: 'text', required: true },
      { key: 'PIN', label: 'PIN / Kata Sandi', type: 'text', required: true },
      { key: 'Role', label: 'Peran', type: 'select', options: ['Admin', 'GuruBK', 'WaliKelas', 'SekretarisKelas'], required: true },
      { key: 'KelasID', label: 'Kelas Terkait (Wali/Sekretaris)', type: 'select', lookup: 'kelas', lookupLabel: 'NamaKelas' },
      { key: 'NIP_NISN', label: 'NIP / NISN', type: 'text' },
      { key: 'StatusAktif', label: 'Status', type: 'select', options: ['Aktif', 'Nonaktif'] }
    ]
  },
  harilibur: {
    sheet: 'HariLibur', label: 'Hari Libur Nasional', icon: 'bi-calendar-heart',
    columns: [
      { key: 'Tanggal', label: 'Tanggal', mono: true }, { key: 'NamaLibur', label: 'Nama Hari Libur' }
    ],
    fields: [
      { key: 'Tanggal', label: 'Tanggal', type: 'date', required: true, full: true },
      { key: 'NamaLibur', label: 'Nama Hari Libur / Peringatan Nasional', type: 'text', required: true, full: true }
    ]
  }
};

function lookupLabelFor(entityKey, field, value) {
  if (!value) return '-';
  const list = AppState.master[field.lookup] || [];
  const item = list.find(x => x.ID === value);
  return item ? item[field.lookupLabel] : value;
}

// ════════════════════════════════════════════════════════
// HALAMAN MASTER DATA (Admin) — CRUD Generik
// ════════════════════════════════════════════════════════
function renderMasterDataPage(entityKey) {
  const schema = ENTITY_SCHEMA[entityKey];
  AppState.entity.key = entityKey;
  const list = AppState.master[entityKey] || [];
  setContainer(`
    <div class="page-hero">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-3">
        <div>
          <div class="page-eyebrow">Master Data</div>
          <h2><i class="bi ${schema.icon}"></i> Kelola Data ${schema.label}</h2>
          <p>Total: ${list.length} data terdaftar.</p>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-secondary btn-sm" onclick="downloadTemplateXLSX('${entityKey}')"><i class="bi bi-file-earmark-excel"></i> Unduh Template</button>
          <button class="btn btn-outline-secondary btn-sm" onclick="openImportModal('${entityKey}')"><i class="bi bi-upload"></i> Import Data</button>
          <button class="btn btn-outline-secondary btn-sm" onclick="exportEntityXLSX('${entityKey}')"><i class="bi bi-file-earmark-excel"></i> Ekspor Data</button>
          <button class="btn btn-primary btn-sm" onclick="openEntityModal('${entityKey}')"><i class="bi bi-plus-lg"></i> Tambah ${schema.label}</button>
        </div>
      </div>
    </div>
    <div class="mb-3">
      <input type="text" class="form-control" style="max-width:320px" placeholder="Cari ${schema.label}…" oninput="filterMasterTable('${entityKey}', this.value)">
    </div>
    <div class="table-responsive">
      <table class="table" id="masterTable-${entityKey}">
        <thead><tr>
          ${schema.columns.map(c => `<th>${c.label}</th>`).join('')}
          <th style="width:110px;">Aksi</th>
        </tr></thead>
        <tbody id="masterTableBody-${entityKey}"></tbody>
      </table>
    </div>`);
  renderMasterTableRows(entityKey, list);
}

function renderMasterTableRows(entityKey, list) {
  const schema = ENTITY_SCHEMA[entityKey];
  const tbody = document.getElementById('masterTableBody-' + entityKey);
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="${schema.columns.length + 1}"><div class="empty-state"><i class="bi bi-inbox"></i><p>Belum ada data.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(row => `
    <tr>
      ${schema.columns.map(c => {
        let val = row[c.key];
        if (c.lookup) val = lookupLabelFor(entityKey, c, val);
        if (c.pill) return `<td><span class="pill ${val === 'Aktif' ? 'pill-hadir' : 'pill-neutral'}">${escapeHtml(val)}</span></td>`;
        return `<td class="${c.mono ? 'cell-mono' : ''}">${escapeHtml(val)}</td>`;
      }).join('')}
      <td>
        <button class="btn btn-sm btn-outline-secondary" onclick="openEntityModal('${entityKey}', '${row.ID}')"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-secondary" onclick="deleteEntity('${entityKey}', '${row.ID}')"><i class="bi bi-trash text-danger"></i></button>
      </td>
    </tr>`).join('');
}

function filterMasterTable(entityKey, query) {
  const q = query.toLowerCase();
  const list = (AppState.master[entityKey] || []).filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(q)));
  renderMasterTableRows(entityKey, list);
}

function buildLookupOptions(field) {
  const list = AppState.master[field.lookup] || [];
  // Deteksi nama duplikat pada daftar lookup agar bisa ditandai dengan cuplikan ID — mencegah salah pilih.
  const labelCount = {};
  list.forEach(x => { const key = String(x[field.lookupLabel] || '').trim().toLowerCase(); labelCount[key] = (labelCount[key] || 0) + 1; });
  return `<option value="">— Pilih ${field.label} —</option>` + list.map(x => {
    let label = x[field.lookupLabel] || '';
    if (field.lookup === 'kelas' && (x.Tingkat || x.Jurusan)) {
      label += ` (${x.Tingkat || ''}${x.Jurusan ? ' · ' + x.Jurusan : ''})`;
    }
    const key = String(x[field.lookupLabel] || '').trim().toLowerCase();
    if (labelCount[key] > 1) label += ` [ID: ${x.ID.slice(0, 6)}…]`; // penanda kalau ada nama kembar
    return `<option value="${x.ID}">${escapeHtml(label)}</option>`;
  }).join('');
}

function openEntityModal(entityKey, id) {
  const schema = ENTITY_SCHEMA[entityKey];
  AppState.entity.key = entityKey; AppState.entity.editingId = id || null;
  const record = id ? (AppState.master[entityKey] || []).find(r => r.ID === id) : {};
  document.getElementById('entityModalTitle').textContent = (id ? 'Ubah ' : 'Tambah ') + schema.label;
  document.getElementById('entityModalBody').innerHTML = `
    <form id="entityForm" class="row g-3">
      ${schema.fields.map(f => `
        <div class="col-md-${f.full ? 12 : 6}">
          <label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
          ${f.type === 'select'
            ? `<select class="form-select" name="${f.key}" ${f.required ? 'required' : ''}>
                 ${f.lookup ? buildLookupOptions(f) : '<option value="">— Pilih —</option>' + (f.options || []).map(o => `<option value="${o}">${o}</option>`).join('')}
               </select>`
            : f.type === 'textarea'
              ? `<textarea class="form-control" name="${f.key}" rows="2">${escapeHtml(record[f.key])}</textarea>`
              : f.type === 'date'
                ? `<input type="date" class="form-control" name="${f.key}" value="${escapeHtml(record[f.key])}" ${f.required ? 'required' : ''}>`
                : `<input type="text" class="form-control" name="${f.key}" placeholder="${f.placeholder || ''}" value="${escapeHtml(record[f.key])}" ${f.required ? 'required' : ''}>`}
        </div>`).join('')}
    </form>`;
  new bootstrap.Modal(document.getElementById('entityModal')).show();
  setTimeout(() => {
    if (record) schema.fields.forEach(f => {
      const el = document.querySelector(`#entityForm [name="${f.key}"]`);
      if (el && record[f.key] !== undefined) el.value = record[f.key];
    });
  }, 50);
}

function saveEntityForm() {
  const form = document.getElementById('entityForm');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const entityKey = AppState.entity.key;
  const record = {};
  new FormData(form).forEach((v, k) => record[k] = v);
  if (AppState.entity.editingId) record.ID = AppState.entity.editingId;

  const btn = document.getElementById('entityModalSaveBtn');
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-inline"></span> Menyimpan…'; btn.disabled = true;

  const action = AppState.entity.editingId ? 'updateRecord' : 'addRecord';
  google.script.run
    .withSuccessHandler(res => {
      btn.innerHTML = original; btn.disabled = false;
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      bootstrap.Modal.getInstance(document.getElementById('entityModal')).hide();
      refreshEntityList(entityKey);
    })
    .withFailureHandler(err => { btn.innerHTML = original; btn.disabled = false; showToast('Error', err.message, 'danger'); })
    [action](AppState.token, entityKey, record);
}

function deleteEntity(entityKey, id) {
  confirmAction('Hapus Data', 'Apakah Anda yakin ingin menghapus data ini? Tindakan ini tidak dapat dibatalkan.', () => {
    google.script.run
      .withSuccessHandler(res => {
        if (res.success) { showToast('Berhasil', res.message, 'success'); refreshEntityList(entityKey); }
        else showToast('Gagal', res.message, 'danger');
      })
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .deleteRecord(AppState.token, entityKey, id);
  });
}

function refreshEntityList(entityKey) {
  google.script.run
    .withSuccessHandler(res => {
      if (res.success) { AppState.master = Object.assign(AppState.master, res.data); if (AppState.currentPage.includes(entityKey)) navigateTo(AppState.currentPage); }
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getMasterDataBundle(AppState.token);
}

// ── Template & Ekspor Excel (.xlsx) — client-side via SheetJS, langsung dari data yang sudah dimuat ──
// Kolom seperti NISN/NIP/NIK/No.HP rawan kehilangan angka 0 di depan jika Excel
// membacanya sebagai angka. Kolom-kolom ini dipaksa berformat Teks ('@').
function isSensitiveTextColumn(headerKey) {
  return /NISN|NIK|NIP|Kontak|NoWali|Nomor|Telepon|WA|NIP_NISN/i.test(headerKey);
}
function forceTextFormatColumns(ws, headers, maxRow) {
  const textCols = headers.map((h, i) => isSensitiveTextColumn(h) ? i : -1).filter(i => i >= 0);
  if (!textCols.length) return;
  let ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: maxRow, c: headers.length - 1 } };
  ref.e.r = Math.max(ref.e.r, maxRow);
  textCols.forEach(colIdx => {
    for (let r = 1; r <= maxRow; r++) { // mulai baris 2 (index 1) — baris 1 adalah judul kolom
      const cellRef = XLSX.utils.encode_cell({ r: r, c: colIdx });
      if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
      ws[cellRef].z = '@';
      ws[cellRef].t = 's';
    }
  });
  ws['!ref'] = XLSX.utils.encode_range(ref);
}
function downloadXLSX(headers, rows, filename, sheetName, reserveRows) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A1' }); // pastikan baris judul kolom selalu ada, walau rows kosong
  ws['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));
  forceTextFormatColumns(ws, headers, Math.max(reserveRows || 0, rows.length + 5));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Data');
  XLSX.writeFile(wb, filename);
}
function downloadTemplateXLSX(entityKey) {
  const schema = ENTITY_SCHEMA[entityKey];
  const headers = schema.fields.map(f => f.key);
  downloadXLSX(headers, [], `Template_${schema.label}.xlsx`, schema.label, 300); // sediakan 300 baris berformat Teks siap isi
  showToast('Template Diunduh', `Template ${schema.label} (.xlsx) siap diisi.`, 'success');
}
function exportEntityXLSX(entityKey) {
  const schema = ENTITY_SCHEMA[entityKey];
  const headers = ['ID'].concat(schema.fields.map(f => f.key));
  downloadXLSX(headers, AppState.master[entityKey] || [], `Ekspor_${schema.label}_${todayStr()}.xlsx`, schema.label);
}

// ── Impor Excel (.xlsx) — dibaca langsung di browser, dikirim sebagai data terstruktur ke backend ──
function openImportModal(entityKey) {
  AppState.entity.key = entityKey;
  document.getElementById('importFileInput').value = '';
  document.getElementById('importResultBox').innerHTML = '';
  new bootstrap.Modal(document.getElementById('importModal')).show();
}
function parseXLSXFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  // defval:'' agar sel kosong tetap muncul sebagai string kosong (bukan hilang dari objek)
  return XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
}
function processImportFile() {
  const fileInput = document.getElementById('importFileInput');
  if (!fileInput.files.length) { showToast('Peringatan', 'Pilih berkas Excel (.xlsx) terlebih dahulu.', 'warning'); return; }
  const overwrite = document.getElementById('importOverwriteCheck').checked;
  const reader = new FileReader();
  reader.onload = () => {
    let records;
    try {
      records = parseXLSXFile(reader.result);
    } catch (err) {
      showToast('Gagal Membaca Berkas', 'Pastikan berkas berformat .xlsx yang valid: ' + err.message, 'danger');
      return;
    }
    if (!records.length) { showToast('Peringatan', 'Berkas kosong atau format kolom tidak dikenali.', 'warning'); return; }
    google.script.run
      .withSuccessHandler(res => {
        if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
        const box = document.getElementById('importResultBox');
        box.innerHTML = `<div class="alert alert-success py-2 small mb-2">${res.data.successCount} baris berhasil, ${res.data.errorCount} baris gagal.</div>` +
          (res.data.errors.length ? `<div class="table-responsive"><table class="table table-sm"><thead><tr><th>Baris</th><th>Alasan</th></tr></thead><tbody>${
            res.data.errors.map(e => `<tr><td>${e.row}</td><td>${escapeHtml(e.reason)}</td></tr>`).join('')}</tbody></table></div>` : '');
        refreshEntityList(AppState.entity.key);
      })
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .importRecordsBatch(AppState.token, AppState.entity.key, records, overwrite);
  };
  reader.readAsArrayBuffer(fileInput.files[0]);
}

// ════════════════════════════════════════════════════════
// ADMIN — DASHBOARD
// ════════════════════════════════════════════════════════
function renderAdminDashboard() {
  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Sistem Administrator</div>
      <h2><i class="bi bi-grid-1x2-fill"></i> Dashboard Admin & Pengawasan Sistem</h2>
      <p>Pusat kendali master data sekolah.</p>
    </div>
    <div id="adminStatsRow" class="row g-3 mb-4"></div>
    <div class="card p-3">
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h6 class="fw-bold mb-0"><i class="bi bi-shield-check"></i> Diagnostik Keterkaitan Data</h6>
        <button class="btn btn-outline-secondary btn-sm" onclick="loadDataIntegrityReport()"><i class="bi bi-arrow-clockwise"></i> Cek Ulang</button>
      </div>
      <p class="text-muted small">Menampilkan jumlah siswa per kelas, serta mendeteksi data yang "nyasar" — siswa/akun yang tertaut ke Kelas ID tidak valid, kelas tanpa siswa, atau nama kelas duplikat (penyebab paling umum data terlihat "tidak nyambung" antar portal).</p>
      <div id="integrityReportBox"></div>
    </div>`);
  showLoadingInline('adminStatsRow');
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error', res.message, 'danger'); return; }
      const d = res.data;
      document.getElementById('adminStatsRow').innerHTML = [
        ['Total Siswa Aktif', d.totalSiswa, 'bi-mortarboard'],
        ['Total Rombongan Belajar', d.totalKelas, 'bi-building'],
        ['Guru & Tenaga Pendidik', d.totalGuru, 'bi-person-badge'],
        ['Akun Pengguna Aktif', d.totalPengguna, 'bi-people-fill']
      ].map(([label, val, icon]) => `
        <div class="col-6 col-md-3"><div class="stat-card">
          <div class="stat-label"><i class="bi ${icon}"></i> ${label}</div>
          <div class="stat-value">${val}</div>
        </div></div>`).join('');
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getDashboardAdmin(AppState.token);
  loadDataIntegrityReport();
}

function loadDataIntegrityReport() {
  showLoadingInline('integrityReportBox');
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error', res.message, 'danger'); return; }
      renderDataIntegrityReport(res.data);
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getDataIntegrityReport(AppState.token);
}

function renderDataIntegrityReport(d) {
  const box = document.getElementById('integrityReportBox');
  const masalahBlocks = [];

  if (d.kelasDuplikat.length) {
    masalahBlocks.push(`<div class="alert alert-warning py-2 small mb-2">
      <strong><i class="bi bi-exclamation-triangle"></i> ${d.kelasDuplikat.length} nama Kelas duplikat terdeteksi</strong> — dua atau lebih Kelas memakai nama yang sama tapi ID berbeda. Ini penyebab paling umum siswa "hilang" di satu portal tapi muncul di portal lain.
      <ul class="mb-0 mt-1">${d.kelasDuplikat.map(k => `<li>"${escapeHtml(k.namaKelas)}" (ID: ${k.kelasId.slice(0,8)}…) — ${k.jumlahSiswa} siswa tertaut</li>`).join('')}</ul>
      <div class="mt-1">Solusi: buka menu Kelola Data Kelas, hapus salah satu duplikat, lalu pindahkan siswa yang tertaut ke Kelas yang dipertahankan.</div>
    </div>`);
  }
  if (d.siswaOrphan.length) {
    masalahBlocks.push(`<div class="alert alert-danger py-2 small mb-2">
      <strong><i class="bi bi-exclamation-octagon"></i> ${d.siswaOrphan.length} siswa tertaut ke Kelas yang sudah tidak ada</strong>
      <ul class="mb-0 mt-1">${d.siswaOrphan.map(s => `<li>${escapeHtml(s.nama)} (NISN ${escapeHtml(s.nisn)})</li>`).join('')}</ul>
      <div class="mt-1">Solusi: buka Kelola Data Siswa, edit siswa tersebut, pilih ulang Kelas yang benar.</div>
    </div>`);
  }
  if (d.siswaTanpaKelas.length) {
    masalahBlocks.push(`<div class="alert alert-warning py-2 small mb-2">
      <strong><i class="bi bi-exclamation-triangle"></i> ${d.siswaTanpaKelas.length} siswa belum memiliki Kelas</strong>
      <ul class="mb-0 mt-1">${d.siswaTanpaKelas.map(s => `<li>${escapeHtml(s.nama)} (NISN ${escapeHtml(s.nisn)})</li>`).join('')}</ul>
    </div>`);
  }
  if (d.penggunaOrphan.length) {
    masalahBlocks.push(`<div class="alert alert-danger py-2 small mb-2">
      <strong><i class="bi bi-exclamation-octagon"></i> ${d.penggunaOrphan.length} akun (Sekretaris/Wali Kelas) tertaut ke Kelas yang sudah tidak ada</strong>
      <ul class="mb-0 mt-1">${d.penggunaOrphan.map(p => `<li>${escapeHtml(p.nama)} (${p.role === 'SekretarisKelas' ? 'Sekretaris Kelas' : 'Wali Kelas'})</li>`).join('')}</ul>
      <div class="mt-1">Solusi: buka Pengguna & Peran, edit akun tersebut, pilih ulang Kelas yang benar.</div>
    </div>`);
  }
  if (d.penggunaTanpaKelas.length) {
    masalahBlocks.push(`<div class="alert alert-warning py-2 small mb-2">
      <strong><i class="bi bi-exclamation-triangle"></i> ${d.penggunaTanpaKelas.length} akun Sekretaris/Wali Kelas belum ditetapkan ke Kelas manapun</strong>
      <ul class="mb-0 mt-1">${d.penggunaTanpaKelas.map(p => `<li>${escapeHtml(p.nama)} (${p.role === 'SekretarisKelas' ? 'Sekretaris Kelas' : 'Wali Kelas'})</li>`).join('')}</ul>
    </div>`);
  }
  if (!masalahBlocks.length) {
    masalahBlocks.push(`<div class="alert alert-success py-2 small mb-2"><i class="bi bi-check-circle"></i> Tidak ada masalah keterkaitan data terdeteksi. Semua siswa & akun tertaut ke Kelas yang valid.</div>`);
  }

  box.innerHTML = masalahBlocks.join('') + `
    <div class="table-responsive mt-3">
      <table class="table table-sm">
        <thead><tr><th>Kelas</th><th>Jumlah Siswa</th><th>Wali Kelas (Data)</th><th>Akun Sekretaris</th><th>Akun Wali Kelas</th></tr></thead>
        <tbody>${d.perKelas.map(k => `<tr>
          <td class="fw-semibold">${escapeHtml(k.namaKelas)}</td>
          <td>${k.jumlahSiswa === 0 ? `<span class="pill pill-alpa">0 siswa</span>` : k.jumlahSiswa}</td>
          <td>${escapeHtml(k.waliKelasNama)}</td>
          <td>${k.sekretarisAkun === '(belum ada akun)' ? `<span class="pill pill-sakit">${k.sekretarisAkun}</span>` : escapeHtml(k.sekretarisAkun)}</td>
          <td>${k.waliKelasAkun === '(belum ada akun)' ? `<span class="pill pill-sakit">${k.waliKelasAkun}</span>` : escapeHtml(k.waliKelasAkun)}</td>
        </tr>`).join('') || `<tr><td colspan="5"><div class="empty-state"><i class="bi bi-inbox"></i><p>Belum ada kelas.</p></div></td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderAdminWaliKelas() {
  const kelas = AppState.master.kelas || [];
  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Penugasan Wali Kelas & Rombel</div>
      <h2><i class="bi bi-person-check"></i> Kelola Wali Kelas</h2>
      <p>Nama wali kelas di sini otomatis menjadi rujukan blok tanda tangan pada laporan resmi.</p>
    </div>
    <div class="table-responsive">
      <table class="table">
        <thead><tr><th>Kelas</th><th>Tingkat</th><th>Wali Kelas Terpilih</th><th>Kapasitas</th><th style="width:90px;">Aksi</th></tr></thead>
        <tbody>
          ${kelas.map(k => `<tr>
            <td class="fw-semibold">${escapeHtml(k.NamaKelas)}</td>
            <td>${escapeHtml(k.Tingkat)}</td>
            <td>${escapeHtml(lookupLabelFor('kelas', { lookup: 'guru', lookupLabel: 'Nama' }, k.WaliKelasID))}</td>
            <td class="cell-mono">${escapeHtml(k.Kapasitas)}</td>
            <td><button class="btn btn-sm btn-outline-secondary" onclick="openEntityModal('kelas','${k.ID}')"><i class="bi bi-pencil"></i></button></td>
          </tr>`).join('') || `<tr><td colspan="5"><div class="empty-state"><i class="bi bi-inbox"></i><p>Belum ada kelas.</p></div></td></tr>`}
        </tbody>
      </table>
    </div>`);
}

// ════════════════════════════════════════════════════════
// SEKRETARIS KELAS — ABSENSI KOLEKTIF
// ════════════════════════════════════════════════════════
function renderSekretarisAbsensi() {
  const tanggal = todayStr();
  const kelasInfo = (AppState.master.kelas || []).find(k => k.ID === AppState.kelasId) || {};
  const siswaKelas = (AppState.master.siswa || []).slice().sort((a, b) => safeCompare(a.Nama, b.Nama));

  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Tahun Ajaran ${AppState.master.config.tahunAjaran || ''} · ${siswaKelas.length} Siswa</div>
      <h2><i class="bi bi-clipboard-check"></i> Absensi Harian ${escapeHtml(kelasInfo.NamaKelas || '')}</h2>
      <p>${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <input type="text" class="form-control" style="max-width:280px" placeholder="Cari nama siswa…" oninput="filterAbsensiRows(this.value)">
      <button class="btn btn-outline-secondary btn-sm" onclick="tandaiSemuaHadir()"><i class="bi bi-check2-all"></i> Tandai Semua Hadir</button>
    </div>
    <div class="table-responsive">
      <table class="table">
        <thead><tr><th style="width:40px;">No</th><th>NISN</th><th>Nama Siswa</th><th style="width:260px;">Status Kehadiran</th><th>Keterangan</th></tr></thead>
        <tbody id="absensiTableBody"></tbody>
      </table>
    </div>
    <div class="bulk-bar">
      <div class="d-flex gap-3 flex-wrap small text-muted">
        <span><span class="pill pill-hadir" id="cntHadir">0</span> Hadir</span>
        <span><span class="pill pill-sakit" id="cntSakit">0</span> Sakit</span>
        <span><span class="pill pill-izin" id="cntIzin">0</span> Izin</span>
        <span><span class="pill pill-alpa" id="cntAlpa">0</span> Alpa</span>
      </div>
      <button class="btn btn-primary" onclick="submitAbsensiKolektif(false)"><i class="bi bi-send-check"></i> Simpan & Kirim Absensi Hari Ini</button>
    </div>`);

  const tbody = document.getElementById('absensiTableBody');
  tbody.innerHTML = siswaKelas.map((s, idx) => `
    <tr data-nama="${escapeHtml(s.Nama).toLowerCase()}" data-siswa-id="${s.ID}">
      <td>${idx + 1}</td>
      <td class="cell-mono">${escapeHtml(s.NISN)}</td>
      <td class="fw-semibold">${escapeHtml(s.Nama)}</td>
      <td>
        <div class="status-switch" data-siswa="${s.ID}">
          ${['Hadir','Sakit','Izin','Alpa'].map(st => `
            <input type="radio" name="status-${s.ID}" id="st-${s.ID}-${st}" value="${st}" ${st === 'Hadir' ? 'checked' : ''} onchange="onStatusChange('${s.ID}','${st}')">
            <label class="opt-${st.toLowerCase()}" for="st-${s.ID}-${st}">${st}</label>`).join('')}
        </div>
      </td>
      <td>
        <input type="text" class="form-control form-control-sm keterangan-box d-none" id="ket-${s.ID}" placeholder="Wajib diisi untuk selain Hadir…">
      </td>
    </tr>`).join('');
  updateAbsensiCounters();
}

function filterAbsensiRows(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#absensiTableBody tr').forEach(tr => { tr.style.display = tr.dataset.nama.includes(q) ? '' : 'none'; });
}
function onStatusChange(siswaId, status) {
  const ketInput = document.getElementById('ket-' + siswaId);
  ketInput.classList.toggle('d-none', status === 'Hadir');
  updateAbsensiCounters();
}
function tandaiSemuaHadir() {
  document.querySelectorAll('.status-switch').forEach(sw => {
    const siswaId = sw.dataset.siswa;
    document.getElementById(`st-${siswaId}-Hadir`).checked = true;
    document.getElementById('ket-' + siswaId).classList.add('d-none');
  });
  updateAbsensiCounters();
  showToast('Diperbarui', 'Semua siswa ditandai Hadir.', 'success');
}
function updateAbsensiCounters() {
  const counts = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0 };
  document.querySelectorAll('.status-switch').forEach(sw => {
    const checked = sw.querySelector('input:checked');
    if (checked) counts[checked.value]++;
  });
  document.getElementById('cntHadir').textContent = counts.Hadir;
  document.getElementById('cntSakit').textContent = counts.Sakit;
  document.getElementById('cntIzin').textContent = counts.Izin;
  document.getElementById('cntAlpa').textContent = counts.Alpa;
}
function collectAbsensiRecords() {
  const records = [];
  document.querySelectorAll('.status-switch').forEach(sw => {
    const siswaId = sw.dataset.siswa;
    const checked = sw.querySelector('input:checked');
    const siswa = (AppState.master.siswa || []).find(s => s.ID === siswaId);
    records.push({ siswaId, siswaNama: siswa ? siswa.Nama : siswaId, status: checked.value, keterangan: (document.getElementById('ket-' + siswaId).value || '').trim() });
  });
  return records;
}
function submitAbsensiKolektif(overwrite) {
  const records = collectAbsensiRecords();
  const missing = records.find(r => r.status !== 'Hadir' && !r.keterangan);
  if (missing) { showToast('Peringatan', `Keterangan wajib diisi untuk ${missing.siswaNama}.`, 'warning'); return; }

  google.script.run
    .withSuccessHandler(res => {
      if (res.success) { showToast('Berhasil', res.message, 'success'); return; }
      if (res.data && res.data.alreadyExists) {
        confirmAction('Absensi Sudah Ada', 'Absensi untuk hari ini sudah pernah diisi. Timpa dengan data baru?', () => submitAbsensiKolektif(true));
      } else {
        showToast('Gagal', res.message, 'danger');
      }
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .simpanAbsensiKolektif(AppState.token, todayStr(), records, overwrite);
}

// ════════════════════════════════════════════════════════
// SEKRETARIS KELAS — ABSENSI SUSULAN (tanggal sebelumnya, siswa yang terlewat)
// ════════════════════════════════════════════════════════
function tanggalMinSusulan() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tanggalKemarin() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderSekretarisSusulan() {
  const kelasInfo = (AppState.master.kelas || []).find(k => k.ID === AppState.kelasId) || {};
  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Kelas ${escapeHtml(kelasInfo.NamaKelas || '')}</div>
      <h2><i class="bi bi-calendar-plus"></i> Absensi Susulan</h2>
      <p>Untuk siswa yang terlewat/lupa diabsen pada tanggal sebelumnya. Siswa yang sudah punya catatan pada tanggal itu tidak bisa ditimpa di sini — hubungi Guru BK untuk koreksi data yang sudah ada.</p>
    </div>
    <div class="row g-2 mb-3">
      <div class="col-md-4">
        <label class="form-label">Pilih Tanggal (maks. 30 hari terakhir)</label>
        <input type="date" class="form-control" id="susulanTanggal" value="${tanggalKemarin()}" min="${tanggalMinSusulan()}" max="${todayStr()}" onchange="loadSusulanData()">
      </div>
    </div>
    <div id="susulanContainer"></div>`);
  loadSusulanData();
}

function loadSusulanData() {
  const tanggal = document.getElementById('susulanTanggal').value;
  if (!tanggal) return;
  showLoadingInline('susulanContainer');
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error', res.message, 'danger'); return; }
      renderSusulanForm(tanggal, res.data);
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getAbsensiHarian(AppState.token, AppState.kelasId, tanggal);
}

function renderSusulanForm(tanggal, existingRows) {
  const container = document.getElementById('susulanContainer');
  const sudahAdaMap = {};
  existingRows.forEach(r => { sudahAdaMap[r.SiswaID] = r.Status; });

  const siswaKelas = (AppState.master.siswa || []).slice().sort((a, b) => safeCompare(a.Nama, b.Nama));
  const belumAda = siswaKelas.filter(s => !sudahAdaMap[s.ID]);
  const pillClass = { Hadir: 'pill-hadir', Sakit: 'pill-sakit', Izin: 'pill-izin', Alpa: 'pill-alpa' };

  if (!belumAda.length) {
    container.innerHTML = `<div class="empty-state"><i class="bi bi-check2-circle"></i><p>Semua siswa sudah memiliki catatan absensi pada tanggal ${tanggal}. Tidak ada yang perlu diisi susulan.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="alert alert-warning py-2 small mb-3">
      <i class="bi bi-info-circle"></i> ${belumAda.length} dari ${siswaKelas.length} siswa belum punya catatan pada tanggal ini. Isi status kehadiran untuk mereka di bawah.
      ${existingRows.length ? `<br>${existingRows.length} siswa lain sudah tercatat (ditampilkan sebagai info, tidak bisa diubah di sini).` : ''}
    </div>
    <div class="table-responsive">
      <table class="table">
        <thead><tr><th style="width:40px;">No</th><th>NISN</th><th>Nama Siswa</th><th style="width:260px;">Status Kehadiran</th><th>Keterangan</th></tr></thead>
        <tbody id="susulanTableBody"></tbody>
      </table>
    </div>
    ${existingRows.length ? `<div class="mt-3"><p class="small text-muted fw-semibold mb-2">Sudah tercatat sebelumnya:</p>
      <div class="d-flex flex-wrap gap-2">${siswaKelas.filter(s => sudahAdaMap[s.ID]).map(s => `<span class="pill ${pillClass[sudahAdaMap[s.ID]] || 'pill-neutral'}">${escapeHtml(s.Nama)}: ${sudahAdaMap[s.ID]}</span>`).join('')}</div>
    </div>` : ''}
    <div class="bulk-bar">
      <span class="small text-muted">${belumAda.length} siswa akan disimpan</span>
      <button class="btn btn-primary" onclick="submitAbsensiSusulan('${tanggal}')"><i class="bi bi-send-check"></i> Simpan Absensi Susulan</button>
    </div>`;

  document.getElementById('susulanTableBody').innerHTML = belumAda.map((s, idx) => `
    <tr data-siswa-id="${s.ID}" data-siswa-nama="${escapeHtml(s.Nama)}">
      <td>${idx + 1}</td>
      <td class="cell-mono">${escapeHtml(s.NISN)}</td>
      <td class="fw-semibold">${escapeHtml(s.Nama)}</td>
      <td>
        <div class="status-switch" data-siswa="${s.ID}">
          ${['Hadir','Sakit','Izin','Alpa'].map(st => `
            <input type="radio" name="susulan-status-${s.ID}" id="susulan-${s.ID}-${st}" value="${st}" ${st === 'Hadir' ? 'checked' : ''} onchange="onSusulanStatusChange('${s.ID}','${st}')">
            <label class="opt-${st.toLowerCase()}" for="susulan-${s.ID}-${st}">${st}</label>`).join('')}
        </div>
      </td>
      <td><input type="text" class="form-control form-control-sm keterangan-box d-none" id="susulan-ket-${s.ID}" placeholder="Wajib diisi untuk selain Hadir…"></td>
    </tr>`).join('');
}

function onSusulanStatusChange(siswaId, status) {
  const ketInput = document.getElementById('susulan-ket-' + siswaId);
  if (ketInput) ketInput.classList.toggle('d-none', status === 'Hadir');
}

function submitAbsensiSusulan(tanggal) {
  const records = [];
  document.querySelectorAll('#susulanTableBody tr').forEach(row => {
    const siswaId = row.dataset.siswaId;
    const checked = row.querySelector(`input[name="susulan-status-${siswaId}"]:checked`);
    const ket = document.getElementById('susulan-ket-' + siswaId);
    records.push({ siswaId: siswaId, siswaNama: row.dataset.siswaNama, status: checked.value, keterangan: (ket.value || '').trim() });
  });
  const missing = records.find(r => r.status !== 'Hadir' && !r.keterangan);
  if (missing) { showToast('Peringatan', `Keterangan wajib diisi untuk ${missing.siswaNama}.`, 'warning'); return; }

  google.script.run
    .withSuccessHandler(res => {
      if (res.success) { showToast('Berhasil', res.message, 'success'); loadSusulanData(); }
      else showToast('Gagal', res.message, 'danger');
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .simpanAbsensiSusulan(AppState.token, tanggal, records);
}
function renderBkDashboard() {
  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Modul Presensi</div>
      <h2><i class="bi bi-grid-1x2-fill"></i> Dashboard Pemantauan & Validasi Kehadiran</h2>
      <p>${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <div id="bkStatsRow" class="row g-3 mb-4"></div>
    <div class="card p-3">
      <h6 class="fw-bold mb-3"><i class="bi bi-hourglass-split"></i> Kelas Menunggu Validasi</h6>
      <div id="bkPendingList"></div>
    </div>`);
  showLoadingInline('bkStatsRow');
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error', res.message, 'danger'); return; }
      const d = res.data;
      document.getElementById('bkStatsRow').innerHTML = [
        ['Tingkat Kehadiran Hari Ini', d.tingkatKehadiran + '%', 'bi-graph-up-arrow'],
        ['Sakit', d.sakit, 'bi-thermometer-half'],
        ['Izin', d.izin, 'bi-calendar-check'],
        ['Alpa / Tanpa Keterangan', d.alpa, 'bi-exclamation-triangle']
      ].map(([label, val, icon]) => `
        <div class="col-6 col-md-3"><div class="stat-card">
          <div class="stat-label"><i class="bi ${icon}"></i> ${label}</div>
          <div class="stat-value">${val}</div>
        </div></div>`).join('');

      const byKelas = {};
      d.antrean.forEach(r => { (byKelas[r.KelasID] = byKelas[r.KelasID] || []).push(r); });
      const rows = Object.keys(byKelas);
      document.getElementById('bkPendingList').innerHTML = rows.length ? rows.map(kelasId => {
        const kelas = (AppState.master.kelas || []).find(k => k.ID === kelasId) || {};
        return `<div class="d-flex justify-content-between align-items-center border-bottom py-2">
          <div><strong>${escapeHtml(kelas.NamaKelas || kelasId)}</strong> <span class="text-muted small">· ${byKelas[kelasId].length} pengajuan</span></div>
          <button class="btn btn-sm btn-primary" onclick="navigateTo('bk-validasi')">Validasi Sekarang</button>
        </div>`;
      }).join('') : `<div class="empty-state"><i class="bi bi-check2-circle"></i><p>Tidak ada antrean validasi saat ini.</p></div>`;
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getDashboardBK(AppState.token);
}

// ════════════════════════════════════════════════════════
// GURU BK — VALIDASI ABSEN
// ════════════════════════════════════════════════════════
function renderBkValidasi() {
  const kelasOptions = (AppState.master.kelas || []).map(k => `<option value="${k.ID}">${escapeHtml(k.NamaKelas)}</option>`).join('');
  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Bimbingan & Konseling</div>
      <h2><i class="bi bi-patch-check"></i> Validasi & Verifikasi Keterangan Ketidakhadiran</h2>
      <p>Periksa keterangan Sakit/Izin/Alpa dari Sekretaris Kelas sebelum diarsipkan.</p>
    </div>
    <div class="row g-2 mb-3">
      <div class="col-md-4"><select class="form-select" id="valFilterKelas" onchange="loadValidasiData()"><option value="">Semua Kelas</option>${kelasOptions}</select></div>
      <div class="col-md-4"><input type="date" class="form-control" id="valFilterTanggal" value="${todayStr()}" onchange="loadValidasiData()"></div>
    </div>
    <div id="valListContainer"></div>`);
  loadValidasiData();
}
function loadValidasiData() {
  showLoadingInline('valListContainer');
  const kelasId = document.getElementById('valFilterKelas').value;
  const tanggal = document.getElementById('valFilterTanggal').value;
  AppState.bulk.selected = new Set();
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error', res.message, 'danger'); return; }
      renderValidasiList(res.data);
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getAbsensiMenungguValidasi(AppState.token, kelasId, tanggal);
}
function renderValidasiList(rows) {
  const container = document.getElementById('valListContainer');
  if (!rows.length) { container.innerHTML = `<div class="empty-state"><i class="bi bi-check2-circle"></i><p>Tidak ada pengajuan menunggu validasi.</p></div>`; return; }
  container.innerHTML = `
    <div class="table-responsive mb-3">
      <table class="table">
        <thead><tr><th style="width:36px;"><input type="checkbox" onchange="toggleAllValidasi(this)"></th><th>Siswa</th><th>Status</th><th>Keterangan</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const siswa = (AppState.master.siswa || []).find(s => s.ID === r.SiswaID) || {};
            const pillClass = { Sakit: 'pill-sakit', Izin: 'pill-izin', Alpa: 'pill-alpa' }[r.Status] || 'pill-neutral';
            return `<tr>
              <td><input type="checkbox" class="val-check" value="${r.ID}" onchange="toggleValidasiSelect('${r.ID}', this.checked)"></td>
              <td><strong>${escapeHtml(siswa.Nama || r.SiswaID)}</strong><br><span class="text-muted small cell-mono">${escapeHtml(siswa.NISN)}</span></td>
              <td><span class="pill ${pillClass}">${r.Status}</span></td>
              <td>${escapeHtml(r.Keterangan)}</td>
              <td><button class="btn btn-sm btn-outline-secondary" onclick="validasiSatuan('${r.ID}','setuju')"><i class="bi bi-check-lg text-success"></i></button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="bulk-bar">
      <span class="small text-muted"><span id="valSelectedCount">0</span> data dipilih</span>
      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary" onclick="validasiTerpilih('tolak')"><i class="bi bi-x-lg"></i> Kembalikan ke Sekretaris</button>
        <button class="btn btn-primary" onclick="validasiTerpilih('setuju')"><i class="bi bi-check2-all"></i> Setujui yang Dipilih</button>
      </div>
    </div>`;
}
function toggleValidasiSelect(id, checked) {
  checked ? AppState.bulk.selected.add(id) : AppState.bulk.selected.delete(id);
  document.getElementById('valSelectedCount').textContent = AppState.bulk.selected.size;
}
function toggleAllValidasi(checkbox) {
  document.querySelectorAll('.val-check').forEach(c => { c.checked = checkbox.checked; toggleValidasiSelect(c.value, checkbox.checked); });
}
function validasiSatuan(id, aksi) { runValidasi([id], aksi); }
function validasiTerpilih(aksi) {
  if (!AppState.bulk.selected.size) { showToast('Peringatan', 'Pilih minimal satu data.', 'warning'); return; }
  runValidasi([...AppState.bulk.selected], aksi);
}
function runValidasi(ids, aksi) {
  google.script.run
    .withSuccessHandler(res => {
      if (res.success) { showToast('Berhasil', res.message, 'success'); loadValidasiData(); }
      else showToast('Gagal', res.message, 'danger');
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .validasiAbsensi(AppState.token, ids, aksi, '');
}

// ════════════════════════════════════════════════════════
// GURU BK — EDIT ABSEN LAMPAU (dengan jejak audit)
// ════════════════════════════════════════════════════════
function renderBkEditLampau() {
  const kelasOptions = (AppState.master.kelas || []).map(k => `<option value="${k.ID}">${escapeHtml(k.NamaKelas)}</option>`).join('');
  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Koreksi Presensi Tanggal Lampau · Jejak Audit</div>
      <h2><i class="bi bi-pencil-square"></i> Edit Absen Lampau</h2>
      <p>Setiap perubahan tercatat permanen: siapa mengubah, kapan, dan alasannya.</p>
    </div>
    <div class="row g-2 mb-3">
      <div class="col-md-4"><select class="form-select" id="lampauKelas"><option value="">— Pilih Kelas —</option>${kelasOptions}</select></div>
      <div class="col-md-4"><input type="date" class="form-control" id="lampauTanggal" value="${todayStr()}"></div>
      <div class="col-md-4"><button class="btn btn-primary w-100" onclick="loadLampauData()"><i class="bi bi-search"></i> Tampilkan Log Absensi</button></div>
    </div>
    <div id="lampauContainer"></div>
    <div class="card p-3 mt-4">
      <h6 class="fw-bold mb-3"><i class="bi bi-clock-history"></i> Riwayat Koreksi Terakhir</h6>
      <div id="auditLogContainer"></div>
    </div>`);
  loadAuditLog();
}
function loadLampauData() {
  const kelasId = document.getElementById('lampauKelas').value;
  const tanggal = document.getElementById('lampauTanggal').value;
  if (!kelasId || !tanggal) { showToast('Peringatan', 'Pilih kelas dan tanggal terlebih dahulu.', 'warning'); return; }
  showLoadingInline('lampauContainer');
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error', res.message, 'danger'); return; }
      renderLampauTable(res.data, kelasId, tanggal);
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getAbsensiUntukKoreksi(AppState.token, kelasId, tanggal);
}
function renderLampauTable(rows, kelasId, tanggal) {
  const container = document.getElementById('lampauContainer');
  if (!rows.length) { container.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>Belum ada data absensi untuk tanggal ini.</p></div>`; return; }
  container.innerHTML = `
    <div class="table-responsive mb-3">
      <table class="table">
        <thead><tr><th>Siswa</th><th>Status Awal</th><th>Status Koreksi</th><th>Keterangan</th><th>Alasan Koreksi</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const siswa = (AppState.master.siswa || []).find(s => s.ID === r.SiswaID) || {};
            return `<tr data-id="${r.ID}" data-siswa-nama="${escapeHtml(siswa.Nama)}" data-tanggal="${tanggal}" data-status-lama="${r.Status}">
              <td><strong>${escapeHtml(siswa.Nama)}</strong></td>
              <td><span class="pill pill-neutral">${r.Status}</span></td>
              <td>
                <select class="form-select form-select-sm lampau-status" onchange="onLampauStatusChange(this)">
                  ${['Hadir','Sakit','Izin','Alpa'].map(s => `<option value="${s}" ${s === r.Status ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </td>
              <td><input type="text" class="form-control form-control-sm lampau-ket" value="${escapeHtml(r.Keterangan)}"></td>
              <td><input type="text" class="form-control form-control-sm lampau-alasan d-none" placeholder="Wajib diisi jika status berubah…"></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="text-end">
      <button class="btn btn-primary" onclick="simpanKoreksiLampau()"><i class="bi bi-shield-check"></i> Simpan Koreksi & Catat Jejak Audit</button>
    </div>`;
}
function onLampauStatusChange(select) {
  const row = select.closest('tr');
  const changed = select.value !== row.dataset.statusLama;
  row.querySelector('.lampau-alasan').classList.toggle('d-none', !changed);
}
function simpanKoreksiLampau() {
  const edits = [];
  document.querySelectorAll('#lampauContainer tbody tr').forEach(row => {
    edits.push({
      absensiId: row.dataset.id, siswaNama: row.dataset.siswaNama, tanggal: row.dataset.tanggal,
      statusLama: row.dataset.statusLama, statusBaru: row.querySelector('.lampau-status').value,
      keteranganBaru: row.querySelector('.lampau-ket').value, alasan: row.querySelector('.lampau-alasan').value
    });
  });
  google.script.run
    .withSuccessHandler(res => {
      if (res.success) { showToast('Berhasil', res.message, 'success'); loadLampauData(); loadAuditLog(); }
      else showToast('Gagal', res.message, 'danger');
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .koreksiAbsensiLampau(AppState.token, edits);
}
function loadAuditLog() {
  showLoadingInline('auditLogContainer');
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) return;
      const rows = res.data;
      document.getElementById('auditLogContainer').innerHTML = rows.length ? `
        <div class="table-responsive"><table class="table table-sm">
          <thead><tr><th>Waktu</th><th>Siswa</th><th>Perubahan</th><th>Validator</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td class="cell-mono small">${new Date(r.Timestamp).toLocaleString('id-ID')}</td>
            <td>${escapeHtml(r.SiswaNama)}</td>
            <td><span class="pill pill-neutral">${r.StatusLama}</span> → <span class="pill pill-neutral">${r.StatusBaru}</span></td>
            <td>${escapeHtml(r.ValidatorNama)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty-state"><i class="bi bi-clock-history"></i><p>Belum ada riwayat koreksi.</p></div>`;
    })
    .withFailureHandler(() => {})
    .getAuditLogRecent(AppState.token, 20);
}

// ════════════════════════════════════════════════════════
// REKAP & CETAK — Guru BK / Wali Kelas
// ════════════════════════════════════════════════════════
function renderRekap(mode) {
  const isBK = mode === 'bk';
  const kelasOptions = (AppState.master.kelas || []).map(k => `<option value="${k.ID}">${escapeHtml(k.NamaKelas)}</option>`).join('');
  const today = todayStr();
  const firstOfMonth = today.slice(0, 8) + '01';
  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Laporan Resmi</div>
      <h2><i class="bi bi-printer"></i> Rekap & Cetak Laporan Kehadiran</h2>
      <p>Rekap harian s.d. tahunan, siap dicetak sebagai laporan resmi A4.</p>
    </div>
    <div class="row g-2 mb-3">
      ${isBK ? `<div class="col-md-4"><select class="form-select" id="rekapKelas">${kelasOptions}</select></div>` : ''}
      <div class="col-md-3"><label class="form-label">Dari</label><input type="date" class="form-control" id="rekapStart" value="${firstOfMonth}"></div>
      <div class="col-md-3"><label class="form-label">Sampai</label><input type="date" class="form-control" id="rekapEnd" value="${today}"></div>
      <div class="col-md-2 d-flex align-items-end"><button class="btn btn-primary w-100" onclick="loadRekap('${mode}')"><i class="bi bi-search"></i> Tampilkan</button></div>
    </div>
    <div id="rekapSummaryRow" class="row g-3 mb-3"></div>
    <div class="d-flex justify-content-end mb-2 no-print">
      <button class="btn btn-outline-secondary btn-sm" onclick="window.print()"><i class="bi bi-printer"></i> Cetak Dokumen Resmi (A4)</button>
    </div>
    <div id="rekapTableContainer"></div>
    <div id="rekapPrintArea" class="print-a4"></div>`);
  loadRekap(mode);
}
function loadRekap(mode) {
  const isBK = mode === 'bk';
  const kelasId = isBK ? document.getElementById('rekapKelas').value : AppState.kelasId;
  const start = document.getElementById('rekapStart').value;
  const end = document.getElementById('rekapEnd').value;
  showLoadingInline('rekapTableContainer');
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error', res.message, 'danger'); return; }
      renderRekapResult(res.data, mode);
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .getRekapAbsensi(AppState.token, kelasId, start, end);
}
function renderRekapResult(data, mode) {
  document.getElementById('rekapSummaryRow').innerHTML = [
    ['Hari Efektif', data.periode.hariEfektif, 'bi-calendar3'],
    ['Rata-rata Kehadiran', data.rataRataKehadiran + '%', 'bi-graph-up'],
    ['Total Siswa', data.rekapPerSiswa.length, 'bi-people'],
    ['Total Alpa', data.totalAkumulasi.alpa, 'bi-exclamation-triangle']
  ].map(([label, val, icon]) => `<div class="col-6 col-md-3"><div class="stat-card"><div class="stat-label"><i class="bi ${icon}"></i> ${label}</div><div class="stat-value">${val}</div></div></div>`).join('');

  document.getElementById('rekapTableContainer').innerHTML = `
    <div class="table-responsive">
      <table class="table">
        <thead><tr><th>NISN</th><th>Nama Siswa</th><th>H</th><th>S</th><th>I</th><th>A</th><th>%</th></tr></thead>
        <tbody>${data.rekapPerSiswa.map(r => `<tr>
          <td class="cell-mono">${escapeHtml(r.nisn)}</td><td class="fw-semibold">${escapeHtml(r.nama)}</td>
          <td>${r.hadir}</td><td>${r.sakit}</td><td>${r.izin}</td>
          <td>${r.alpa > 0 ? `<span class="pill pill-alpa">${r.alpa}</span>` : r.alpa}</td>
          <td class="cell-mono">${r.persentase}%</td>
        </tr>`).join('') || `<tr><td colspan="7"><div class="empty-state"><i class="bi bi-inbox"></i><p>Tidak ada data pada periode ini.</p></div></td></tr>`}</tbody>
      </table>
    </div>`;

  const cfg = AppState.master.config;
  const showSign = mode === 'bk';
  document.getElementById('rekapPrintArea').innerHTML = `
    <div class="print-a4-header">
      <div style="font-weight:700;">${escapeHtml(cfg.namaSekolah || '')}</div>
      <div style="font-size:9pt;">${escapeHtml(cfg.alamatSekolah || '')}</div>
      <div style="font-weight:700; margin-top:.5rem; text-decoration:underline;">LAPORAN REKAPITULASI PRESENSI SISWA</div>
      <div style="font-size:9pt;">Periode: ${data.periode.start} s.d. ${data.periode.end} · Kelas: ${escapeHtml(data.kelas.nama)}</div>
    </div>
    <table>
      <thead><tr><th>No</th><th>NISN</th><th>Nama Siswa</th><th>H</th><th>S</th><th>I</th><th>A</th><th>%</th></tr></thead>
      <tbody>${data.rekapPerSiswa.map((r, i) => `<tr><td>${i+1}</td><td>${escapeHtml(r.nisn)}</td><td>${escapeHtml(r.nama)}</td><td>${r.hadir}</td><td>${r.sakit}</td><td>${r.izin}</td><td>${r.alpa}</td><td>${r.persentase}%</td></tr>`).join('')}</tbody>
    </table>
    ${showSign ? `<div class="print-a4-sign">
      <div class="sign-block"><div>Mengetahui,<br>Guru Bimbingan &amp; Konseling</div><div class="sign-space"></div><div style="text-decoration:underline;">${escapeHtml(AppState.nama)}</div></div>
      <div class="sign-block"><div>Wali Kelas ${escapeHtml(data.kelas.nama)}</div><div class="sign-space"></div><div style="text-decoration:underline;">${escapeHtml(data.kelas.waliNama)}</div><div>NIP. ${escapeHtml(data.kelas.waliNip)}</div></div>
    </div>` : ''}`;
}

// ════════════════════════════════════════════════════════
// WALI KELAS — MONITORING (Harian/Bulanan/Semester/Tahunan)
// Read-only, otomatis dibatasi ke kelas yang diampu (session.kelasId).
// Menggunakan render*Harian/Bulanan/PerBulan yang sama dengan Guru BK
// (menulis ke wadah #bkRekapContainer / #bkRekapPrintArea) agar konsisten
// dan tidak menduplikasi logika tampilan.
// ════════════════════════════════════════════════════════
function renderWaliRekap() {
  const kelasInfo = (AppState.master.kelas || []).find(k => k.ID === AppState.kelasId) || {};
  const tahunAjaranDefault = AppState.master.config.tahunAjaran || '2024/2025';
  const semesterDefault = AppState.master.config.semester || 'Ganjil';
  const now = new Date();
  const bulanDefault = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Mode Lihat Saja (Read-Only) · Kelas ${escapeHtml(kelasInfo.NamaKelas || '-')}</div>
      <h2><i class="bi bi-bar-chart-line"></i> Monitoring Kehadiran Kelas Saya</h2>
      <p>Pantau kehadiran siswa di kelas Anda — Harian, Bulanan, Semester, atau Tahunan. Untuk koreksi data, hubungi Guru BK.</p>
    </div>

    <div class="row g-2 mb-3 no-print">
      <div class="col-md-4">
        <label class="form-label">Jenis Rekap</label>
        <select class="form-select" id="bkRekapJenis" onchange="onBkRekapJenisChange()">
          <option value="harian">Harian</option>
          <option value="bulanan" selected>Bulanan</option>
          <option value="semester">Semester</option>
          <option value="tahunan">Tahunan</option>
        </select>
      </div>
      <div class="col-md-4" id="bkRekapFilterDinamis"><!-- diisi sesuai jenis --></div>
      <div class="col-md-4 d-flex align-items-end">
        <button class="btn btn-primary w-100" onclick="loadWaliRekap()"><i class="bi bi-search"></i> Tampilkan</button>
      </div>
    </div>

    <div class="d-flex justify-content-end mb-2 no-print">
      <button class="btn btn-outline-secondary btn-sm" onclick="unduhRekapXLSX()"><i class="bi bi-file-earmark-excel"></i> Unduh Excel (.xlsx)</button>
      <button class="btn btn-outline-secondary btn-sm" onclick="window.print()"><i class="bi bi-printer"></i> Cetak</button>
    </div>

    <div id="bkRekapContainer"></div>
    <div id="bkRekapPrintArea" class="print-a4"></div>`);

  document.getElementById('bkRekapFilterDinamis').innerHTML = `
    <label class="form-label">Bulan</label>
    <input type="month" class="form-control" id="bkRekapBulan" value="${bulanDefault}">`;
  window._bkRekapTahunAjaranDefault = tahunAjaranDefault;
  window._bkRekapSemesterDefault = semesterDefault;

  loadWaliRekap();
}

function loadWaliRekap() {
  const jenis = document.getElementById('bkRekapJenis').value;
  const kelasId = AppState.kelasId; // Wali Kelas selalu dibatasi ke kelasnya sendiri
  showLoadingInline('bkRekapContainer');

  if (jenis === 'harian') {
    setPrintOrientation('portrait');
    const tanggal = document.getElementById('bkRekapTanggal').value;
    google.script.run.withSuccessHandler(res => handleBkRekapResult(res, () => renderBkRekapHarian(res.data)))
      .withFailureHandler(err => showToast('Error', err.message, 'danger')).getRekapHarian(AppState.token, kelasId, tanggal);
  } else if (jenis === 'bulanan') {
    setPrintOrientation('landscape', true);
    const bulan = document.getElementById('bkRekapBulan').value;
    google.script.run.withSuccessHandler(res => handleBkRekapResult(res, () => renderBkRekapBulanan(res.data)))
      .withFailureHandler(err => showToast('Error', err.message, 'danger')).getRekapBulanan(AppState.token, kelasId, bulan);
  } else if (jenis === 'semester') {
    setPrintOrientation('landscape', true);
    const semester = document.getElementById('bkRekapSemester').value;
    const tahunAjaran = document.getElementById('bkRekapTahunAjaran').value;
    google.script.run.withSuccessHandler(res => handleBkRekapResult(res, () => renderBkRekapPerBulan(res.data, 'Rekap Semester')))
      .withFailureHandler(err => showToast('Error', err.message, 'danger')).getRekapSemesteran(AppState.token, kelasId, semester, tahunAjaran);
  } else {
    setPrintOrientation('landscape', true);
    const tahunAjaran = document.getElementById('bkRekapTahunAjaran2').value;
    google.script.run.withSuccessHandler(res => handleBkRekapResult(res, () => renderBkRekapPerBulan(res.data, 'Rekap Tahunan')))
      .withFailureHandler(err => showToast('Error', err.message, 'danger')).getRekapTahunan(AppState.token, kelasId, tahunAjaran);
  }
}

// ════════════════════════════════════════════════════════
// GURU BK — REKAP HARIAN / BULANAN / SEMESTER / TAHUNAN
// (halaman baru, terpisah dari renderRekap yang dipakai Wali Kelas)
// ════════════════════════════════════════════════════════
function setPrintOrientation(mode, compact) {
  let style = document.getElementById('dynamicPrintOrientation');
  if (!style) { style = document.createElement('style'); style.id = 'dynamicPrintOrientation'; document.head.appendChild(style); }
  const margin = compact ? '8mm 6mm' : '12mm';
  style.textContent = `@media print { @page { size: A4 ${mode}; margin: ${margin}; } }`;
  const printArea = document.getElementById('bkRekapPrintArea');
  if (printArea) printArea.classList.toggle('print-a4-compact', !!compact);
}

function renderBkRekap() {
  const kelasOptions = (AppState.master.kelas || []).map(k => `<option value="${k.ID}">${escapeHtml(k.NamaKelas)}</option>`).join('');
  const tahunAjaranDefault = AppState.master.config.tahunAjaran || '2024/2025';
  const semesterDefault = AppState.master.config.semester || 'Ganjil';
  const now = new Date();
  const bulanDefault = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  setContainer(`
    <div class="page-hero">
      <div class="page-eyebrow">Laporan Resmi · Bimbingan &amp; Konseling</div>
      <h2><i class="bi bi-printer"></i> Rekap &amp; Cetak Laporan Kehadiran</h2>
      <p>Pilih jenis rekap: Harian, Bulanan, Semester, atau Tahunan — siap dicetak sebagai laporan resmi A4.</p>
    </div>

    <div class="row g-2 mb-3 no-print">
      <div class="col-md-3">
        <label class="form-label">Jenis Rekap</label>
        <select class="form-select" id="bkRekapJenis" onchange="onBkRekapJenisChange()">
          <option value="harian">Harian</option>
          <option value="bulanan" selected>Bulanan</option>
          <option value="semester">Semester</option>
          <option value="tahunan">Tahunan</option>
        </select>
      </div>
      <div class="col-md-3">
        <label class="form-label">Kelas</label>
        <select class="form-select" id="bkRekapKelas">${kelasOptions}</select>
      </div>
      <div class="col-md-3" id="bkRekapFilterDinamis"><!-- diisi sesuai jenis --></div>
      <div class="col-md-3 d-flex align-items-end">
        <button class="btn btn-primary w-100" onclick="loadBkRekap()"><i class="bi bi-search"></i> Tampilkan</button>
      </div>
    </div>

    <div class="d-flex justify-content-end mb-2 no-print">
      <button class="btn btn-outline-secondary btn-sm" onclick="unduhRekapXLSX()"><i class="bi bi-file-earmark-excel"></i> Unduh Excel (.xlsx)</button>
      <button class="btn btn-outline-secondary btn-sm" onclick="window.print()"><i class="bi bi-printer"></i> Cetak Dokumen Resmi (A4)</button>
    </div>

    <div id="bkRekapContainer"></div>
    <div id="bkRekapPrintArea" class="print-a4"></div>`);

  document.getElementById('bkRekapFilterDinamis').innerHTML = `
    <label class="form-label">Bulan</label>
    <input type="month" class="form-control" id="bkRekapBulan" value="${bulanDefault}">`;
  window._bkRekapTahunAjaranDefault = tahunAjaranDefault;
  window._bkRekapSemesterDefault = semesterDefault;

  loadBkRekap();
}

function onBkRekapJenisChange() {
  const jenis = document.getElementById('bkRekapJenis').value;
  const now = new Date();
  const bulanDefault = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const tahunAjaranDefault = window._bkRekapTahunAjaranDefault || '2024/2025';
  const semesterDefault = window._bkRekapSemesterDefault || 'Ganjil';
  const box = document.getElementById('bkRekapFilterDinamis');

  if (jenis === 'harian') {
    box.innerHTML = `<label class="form-label">Tanggal</label><input type="date" class="form-control" id="bkRekapTanggal" value="${todayStr()}">`;
  } else if (jenis === 'bulanan') {
    box.innerHTML = `<label class="form-label">Bulan</label><input type="month" class="form-control" id="bkRekapBulan" value="${bulanDefault}">`;
  } else if (jenis === 'semester') {
    box.innerHTML = `<label class="form-label">Semester &amp; Tahun Ajaran</label>
      <div class="d-flex gap-2">
        <select class="form-select" id="bkRekapSemester">
          <option value="Ganjil" ${semesterDefault === 'Ganjil' ? 'selected' : ''}>Ganjil</option>
          <option value="Genap" ${semesterDefault === 'Genap' ? 'selected' : ''}>Genap</option>
        </select>
        <input type="text" class="form-control" id="bkRekapTahunAjaran" value="${tahunAjaranDefault}" placeholder="2024/2025">
      </div>`;
  } else {
    box.innerHTML = `<label class="form-label">Tahun Ajaran</label><input type="text" class="form-control" id="bkRekapTahunAjaran2" value="${tahunAjaranDefault}" placeholder="2024/2025">`;
  }
}

function loadBkRekap() {
  const jenis = document.getElementById('bkRekapJenis').value;
  const kelasId = document.getElementById('bkRekapKelas').value;
  if (!kelasId) { showToast('Peringatan', 'Pilih kelas terlebih dahulu.', 'warning'); return; }
  showLoadingInline('bkRekapContainer');

  if (jenis === 'harian') {
    setPrintOrientation('portrait');
    const tanggal = document.getElementById('bkRekapTanggal').value;
    google.script.run.withSuccessHandler(res => handleBkRekapResult(res, () => renderBkRekapHarian(res.data)))
      .withFailureHandler(err => showToast('Error', err.message, 'danger')).getRekapHarian(AppState.token, kelasId, tanggal);
  } else if (jenis === 'bulanan') {
    setPrintOrientation('landscape', true);
    const bulan = document.getElementById('bkRekapBulan').value;
    google.script.run.withSuccessHandler(res => handleBkRekapResult(res, () => renderBkRekapBulanan(res.data)))
      .withFailureHandler(err => showToast('Error', err.message, 'danger')).getRekapBulanan(AppState.token, kelasId, bulan);
  } else if (jenis === 'semester') {
    setPrintOrientation('landscape', true);
    const semester = document.getElementById('bkRekapSemester').value;
    const tahunAjaran = document.getElementById('bkRekapTahunAjaran').value;
    google.script.run.withSuccessHandler(res => handleBkRekapResult(res, () => renderBkRekapPerBulan(res.data, 'Rekap Semester')))
      .withFailureHandler(err => showToast('Error', err.message, 'danger')).getRekapSemesteran(AppState.token, kelasId, semester, tahunAjaran);
  } else {
    setPrintOrientation('landscape', true);
    const tahunAjaran = document.getElementById('bkRekapTahunAjaran2').value;
    google.script.run.withSuccessHandler(res => handleBkRekapResult(res, () => renderBkRekapPerBulan(res.data, 'Rekap Tahunan')))
      .withFailureHandler(err => showToast('Error', err.message, 'danger')).getRekapTahunan(AppState.token, kelasId, tahunAjaran);
  }
}

function handleBkRekapResult(res, renderFn) {
  if (!res.success) { showToast('Error', res.message, 'danger'); document.getElementById('bkRekapContainer').innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>${escapeHtml(res.message)}</p></div>`; return; }
  renderFn();
}

function signBlockHtml(kelas) {
  if (AppState.role !== 'GuruBK') return ''; // blok tanda tangan resmi hanya untuk cetakan Guru BK
  return `<div class="print-a4-sign">
    <div class="sign-block"><div>Mengetahui,<br>Guru Bimbingan &amp; Konseling</div><div class="sign-space"></div><div style="text-decoration:underline;">${escapeHtml(AppState.nama)}</div></div>
    <div class="sign-block"><div>Wali Kelas ${escapeHtml(kelas.nama)}</div><div class="sign-space"></div><div style="text-decoration:underline;">${escapeHtml(kelas.waliNama)}</div><div>NIP. ${escapeHtml(kelas.waliNip)}</div></div>
  </div>`;
}
function printHeaderHtml(cfg, judul, subjudul) {
  return `<div class="print-a4-header">
    <div style="font-weight:700;">${escapeHtml(cfg.namaSekolah || '')}</div>
    <div style="font-size:9pt;">${escapeHtml(cfg.alamatSekolah || '')}</div>
    <div style="font-weight:700; margin-top:.5rem; text-decoration:underline;">${judul}</div>
    <div style="font-size:9pt;">${subjudul}</div>
  </div>`;
}

// ── 1. Rekap Harian ──
function renderBkRekapHarian(data) {
  AppState.lastRekap = { jenis: 'harian', data: data };
  const pillClass = { Hadir: 'pill-hadir', Sakit: 'pill-sakit', Izin: 'pill-izin', Alpa: 'pill-alpa' };
  document.getElementById('bkRekapContainer').innerHTML = `
    <div class="row g-3 mb-3">
      ${[['Hadir', data.totals.hadir], ['Sakit', data.totals.sakit], ['Izin', data.totals.izin], ['Alpa', data.totals.alpa]]
        .map(([l, v]) => `<div class="col-6 col-md-3"><div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div></div>`).join('')}
    </div>
    <div class="table-responsive"><table class="table">
      <thead><tr><th>No</th><th>NISN</th><th>Nama Siswa</th><th>Status</th><th>Keterangan</th></tr></thead>
      <tbody>${data.rows.map((r, i) => `<tr><td>${i + 1}</td><td class="cell-mono">${escapeHtml(r.nisn)}</td><td class="fw-semibold">${escapeHtml(r.nama)}</td>
        <td><span class="pill ${pillClass[r.status] || 'pill-neutral'}">${escapeHtml(r.status)}</span></td><td>${escapeHtml(r.keterangan)}</td></tr>`).join('')
        || `<tr><td colspan="5"><div class="empty-state"><i class="bi bi-inbox"></i><p>Tidak ada data.</p></div></td></tr>`}</tbody>
    </table></div>`;

  const cfg = AppState.master.config;
  document.getElementById('bkRekapPrintArea').innerHTML =
    printHeaderHtml(cfg, 'LAPORAN REKAPITULASI PRESENSI HARIAN', `Tanggal: ${data.tanggal} · Kelas: ${escapeHtml(data.kelas.nama)}`) +
    `<table><thead><tr><th>No</th><th>NISN</th><th>Nama Siswa</th><th>Status</th><th>Keterangan</th></tr></thead>
     <tbody>${data.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.nisn)}</td><td>${escapeHtml(r.nama)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.keterangan)}</td></tr>`).join('')}</tbody></table>` +
    signBlockHtml(data.kelas);
}

// ── 2. Rekap Bulanan (grid per-tanggal) ──
function buildBulananTableHtml(data, forPrint) {
  const narrowCls = forPrint ? ' class="print-narrow-col"' : '';
  // Kelas penanda warna: kuning untuk hari libur nasional, oranye untuk akhir pekan (Sabtu/Minggu).
  // Hanya diterapkan pada tampilan layar — tampilan cetak tetap seperti yang sudah disepakati.
  const colorCls = dt => forPrint ? '' : (dt.libur ? ' bg-holiday-col' : (dt.weekend ? ' bg-weekend-col' : ''));
  const dateHeadCells = data.dates.map(dt => `<th${narrowCls} class="${colorCls(dt).trim()}" title="${dt.libur ? escapeHtml(dt.namaLibur) : ''}">${dt.tanggal}</th>`).join('');
  const hariHeadCells = data.dates.map(dt => `<th${narrowCls} class="${colorCls(dt).trim()}" style="font-weight:400;">${dt.hari}</th>`).join('');
  const bodyRows = data.perSiswa.map((s, i) => `
    <tr>
      <td>${i + 1}</td><td class="${forPrint ? '' : 'cell-mono'}">${escapeHtml(s.nisn)}</td><td class="${forPrint ? 'print-nama-cell' : 'fw-semibold'}" style="text-align:left;">${escapeHtml(s.nama)}</td>
      ${s.statuses.map((st, di) => `<td${narrowCls} class="${colorCls(data.dates[di]).trim()}">${st || ''}</td>`).join('')}
      <td>${s.totalH}</td><td>${s.totalS}</td><td>${s.totalI}</td><td>${s.totalA}</td><td></td>
    </tr>`).join('');
  return `
    <table class="${forPrint ? '' : 'table table-bordered text-center'}" style="${forPrint ? '' : 'min-width:1400px;'}">
      <thead>
        <tr>
          <th rowspan="3">No</th><th rowspan="3">NISN</th><th rowspan="3">Nama Siswa</th>
          <th colspan="${data.dates.length}">Bulan: ${data.bulanLabel}</th>
          <th rowspan="3">H</th><th rowspan="3">S</th><th rowspan="3">I</th><th rowspan="3">A</th><th rowspan="3">Keterangan</th>
        </tr>
        <tr>${dateHeadCells}</tr>
        <tr>${hariHeadCells}</tr>
      </thead>
      <tbody>${bodyRows || `<tr><td colspan="${data.dates.length + 8}">Tidak ada data.</td></tr>`}</tbody>
    </table>
    ${forPrint ? '' : `<div class="d-flex gap-3 mt-2 small text-muted flex-wrap">
      <span><span class="legend-swatch bg-weekend-col"></span> Akhir Pekan (Sabtu/Minggu)</span>
      <span><span class="legend-swatch bg-holiday-col"></span> Hari Libur Nasional</span>
    </div>`}`;
}
function renderBkRekapBulanan(data) {
  AppState.lastRekap = { jenis: 'bulanan', data: data };
  document.getElementById('bkRekapContainer').innerHTML = `<div class="table-responsive">${buildBulananTableHtml(data, false)}</div>`;
  const cfg = AppState.master.config;
  document.getElementById('bkRekapPrintArea').innerHTML =
    printHeaderHtml(cfg, 'LAPORAN REKAPITULASI PRESENSI BULANAN', `${data.bulanLabel} · Kelas: ${escapeHtml(data.kelas.nama)}`) +
    buildBulananTableHtml(data, true) + signBlockHtml(data.kelas);
}

// ── 3 & 4. Rekap per-Bulan (Semester / Tahunan) ──
function buildPerBulanTableHtml(data, forPrint) {
  const monthHead = data.months.map(mo => `<th colspan="4">${mo.label}</th>`).join('');
  const subHead = data.months.map(() => `<th>H</th><th>S</th><th>I</th><th>A</th>`).join('');
  const bodyRows = data.perSiswa.map((s, i) => `
    <tr>
      <td>${i + 1}</td><td class="${forPrint ? '' : 'cell-mono'}">${escapeHtml(s.nisn)}</td><td class="${forPrint ? 'print-nama-cell' : 'fw-semibold'}" style="text-align:left;">${escapeHtml(s.nama)}</td>
      ${s.perBulan.map(b => `<td>${b.h || ''}</td><td>${b.s || ''}</td><td>${b.i || ''}</td><td>${b.a || ''}</td>`).join('')}
      <td>${s.totalH}</td><td>${s.totalS}</td><td>${s.totalI}</td><td>${s.totalA}</td>
    </tr>`).join('');
  return `
    <table class="${forPrint ? '' : 'table table-bordered text-center'}" style="${forPrint ? '' : 'min-width:1500px;'}">
      <thead>
        <tr><th rowspan="2">No</th><th rowspan="2">NISN</th><th rowspan="2">Nama Siswa</th>${monthHead}<th colspan="4">Total</th></tr>
        <tr>${subHead}<th>H</th><th>S</th><th>I</th><th>A</th></tr>
      </thead>
      <tbody>${bodyRows || `<tr><td colspan="${3 + data.months.length * 4 + 4}">Tidak ada data.</td></tr>`}</tbody>
    </table>`;
}
function renderBkRekapPerBulan(data, judul) {
  AppState.lastRekap = { jenis: 'perbulan', data: data, judul: judul };
  document.getElementById('bkRekapContainer').innerHTML = `
    <div class="mb-2 fw-semibold">${escapeHtml(data.periodeLabel)} · Kelas ${escapeHtml(data.kelas.nama)}</div>
    <div class="table-responsive">${buildPerBulanTableHtml(data, false)}</div>`;
  const cfg = AppState.master.config;
  document.getElementById('bkRekapPrintArea').innerHTML =
    printHeaderHtml(cfg, judul.toUpperCase(), `${escapeHtml(data.periodeLabel)} · Kelas: ${escapeHtml(data.kelas.nama)}`) +
    buildPerBulanTableHtml(data, true) + signBlockHtml(data.kelas);
}

// ════════════════════════════════════════════════════════
// UNDUH REKAP SEBAGAI FILE EXCEL (.xlsx)
// Mengekspor rekap yang SEDANG DITAMPILKAN (harian/bulanan/semester/tahunan)
// dengan struktur kolom yang sama seperti di layar & cetakan.
// Fitur Cetak (window.print) tetap berjalan seperti semula — ini murni tambahan.
// ════════════════════════════════════════════════════════
async function unduhRekapXLSX() {
  const last = AppState.lastRekap;
  if (!last || !last.data) {
    showToast('Peringatan', 'Tampilkan rekap terlebih dahulu sebelum mengunduh.', 'warning');
    return;
  }
  try {
    const cfg = AppState.master.config || {};
    const d = last.data;
    let aoa, judul, namaFile, lebarKolom;
    let headerRowCount, dataRowCount, dateColorMap = null;
    let headerMerges = []; // {r1,c1,r2,c2} 1-indexed — dipakai agar header tabel benar-benar rata tengah (bukan cuma terlihat rata karena teks pendek)
    const HEADER_ROW_START = 5; // baris ke-6 (0-indexed 5): posisi awal baris judul kolom, setelah kop 4 baris + 1 baris kosong
    const row1 = HEADER_ROW_START + 1;      // baris header pertama (1-indexed)
    const row2 = HEADER_ROW_START + 2;      // baris header kedua (1-indexed) — hanya dipakai jika headerRowCount = 2

    if (last.jenis === 'harian') {
      judul = 'LAPORAN REKAPITULASI PRESENSI HARIAN';
      aoa = [
        [cfg.namaSekolah || ''], [cfg.alamatSekolah || ''], [judul],
        [`Tanggal: ${d.tanggal}  ·  Kelas: ${d.kelas.nama}  ·  Wali Kelas: ${d.kelas.waliNama}`],
        [],
        ['No', 'NISN', 'Nama Siswa', 'Status', 'Keterangan']
      ];
      d.rows.forEach((r, i) => aoa.push([i + 1, r.nisn, r.nama, r.status, r.keterangan]));
      headerRowCount = 1; dataRowCount = d.rows.length;
      aoa.push([]);
      aoa.push(['', '', 'REKAPITULASI', `Hadir: ${d.totals.hadir}`, `Sakit: ${d.totals.sakit} · Izin: ${d.totals.izin} · Alpa: ${d.totals.alpa}`]);
      lebarKolom = [{ wch: 5 }, { wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 40 }];
      namaFile = `Rekap_Harian_${d.kelas.nama}_${d.tanggal}.xlsx`;

    } else if (last.jenis === 'bulanan') {
      judul = 'LAPORAN REKAPITULASI PRESENSI BULANAN';
      // Header bertingkat: baris tanggal lalu baris nama hari (sama seperti tampilan layar)
      const barisTanggal = ['No', 'NISN', 'Nama Siswa'].concat(d.dates.map(dt => dt.tanggal)).concat(['H', 'S', 'I', 'A', 'Keterangan']);
      const barisHari = ['', '', ''].concat(d.dates.map(dt => dt.hari)).concat(['', '', '', '', '']);
      aoa = [
        [cfg.namaSekolah || ''], [cfg.alamatSekolah || ''], [judul],
        [`${d.bulanLabel}  ·  Kelas: ${d.kelas.nama}  ·  Wali Kelas: ${d.kelas.waliNama}`],
        [],
        barisTanggal, barisHari
      ];
      d.perSiswa.forEach((s, i) => {
        aoa.push([i + 1, s.nisn, s.nama].concat(s.statuses).concat([s.totalH, s.totalS, s.totalI, s.totalA, '']));
      });
      headerRowCount = 2; dataRowCount = d.perSiswa.length;
      // No/NISN/Nama Siswa dan H/S/I/A/Keterangan masing-masing digabung vertikal (2 baris jadi 1 sel) —
      // supaya rata-tengahnya benar-benar terlihat, bukan cuma teks di baris atas dengan sel kosong di bawahnya.
      [1, 2, 3].forEach(c => headerMerges.push({ r1: row1, c1: c, r2: row2, c2: c }));
      const kolomAkhirTetap = 4 + d.dates.length; // kolom pertama dari H,S,I,A,Keterangan
      for (let c = kolomAkhirTetap; c <= kolomAkhirTetap + 4; c++) headerMerges.push({ r1: row1, c1: c, r2: row2, c2: c });
      // Peta warna kolom tanggal: kuning = hari libur nasional, oranye = akhir pekan — sama seperti tampilan layar
      dateColorMap = {};
      d.dates.forEach((dt, di) => {
        const col = 3 + di; // kolom setelah No, NISN, Nama Siswa
        if (dt.libur) dateColorMap[col] = 'FEF9C3';
        else if (dt.weekend) dateColorMap[col] = 'FFEDD5';
      });
      aoa.push([]);
      aoa.push(['Keterangan:', 'H = Hadir', 'S = Sakit', 'I = Izin', 'A = Alpa', '- = Libur/Akhir Pekan']);
      lebarKolom = [{ wch: 5 }, { wch: 14 }, { wch: 28 }]
        .concat(d.dates.map(() => ({ wch: 4 })))
        .concat([{ wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 22 }]);
      namaFile = `Rekap_Bulanan_${d.kelas.nama}_${d.bulanLabel.replace(/\s+/g, '_')}.xlsx`;

    } else {
      judul = (last.judul || 'REKAPITULASI PRESENSI').toUpperCase();
      // Header bertingkat: baris nama bulan lalu baris H/S/I/A per bulan
      const barisBulan = ['No', 'NISN', 'Nama Siswa'];
      const barisSub = ['', '', ''];
      d.months.forEach(mo => {
        barisBulan.push(mo.label, '', '', '');
        barisSub.push('H', 'S', 'I', 'A');
      });
      barisBulan.push('TOTAL', '', '', '');
      barisSub.push('H', 'S', 'I', 'A');
      aoa = [
        [cfg.namaSekolah || ''], [cfg.alamatSekolah || ''], [judul],
        [`${d.periodeLabel}  ·  Kelas: ${d.kelas.nama}  ·  Wali Kelas: ${d.kelas.waliNama}`],
        [],
        barisBulan, barisSub
      ];
      d.perSiswa.forEach((s, i) => {
        const baris = [i + 1, s.nisn, s.nama];
        s.perBulan.forEach(b => baris.push(b.h, b.s, b.i, b.a));
        baris.push(s.totalH, s.totalS, s.totalI, s.totalA);
        aoa.push(baris);
      });
      headerRowCount = 2; dataRowCount = d.perSiswa.length;
      // No/NISN/Nama Siswa digabung vertikal; label tiap bulan & "TOTAL" digabung horizontal (menaungi 4 sub-kolom H/S/I/A)
      [1, 2, 3].forEach(c => headerMerges.push({ r1: row1, c1: c, r2: row2, c2: c }));
      d.months.forEach((mo, mi) => {
        const c1 = 4 + mi * 4;
        headerMerges.push({ r1: row1, c1: c1, r2: row1, c2: c1 + 3 });
      });
      const totalStartCol = 4 + d.months.length * 4;
      headerMerges.push({ r1: row1, c1: totalStartCol, r2: row1, c2: totalStartCol + 3 });
      aoa.push([]);
      aoa.push(['Keterangan:', 'H = Hadir', 'S = Sakit', 'I = Izin', 'A = Alpa']);
      lebarKolom = [{ wch: 5 }, { wch: 14 }, { wch: 28 }];
      d.months.forEach(() => lebarKolom.push({ wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 4 }));
      lebarKolom.push({ wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 });
      namaFile = `${(last.judul || 'Rekap').replace(/\s+/g, '_')}_${d.kelas.nama}.xlsx`;
    }

    // Blok tanda tangan — hanya untuk Guru BK, konsisten dengan aturan pada cetakan resmi.
    // Posisi kolom dihitung PROPORSIONAL terhadap lebar tabel (bukan kolom tetap C/F),
    // supaya tetap terlihat rapi baik untuk laporan sempit (Harian) maupun lebar (Bulanan/Tahunan).
    const signatureNameCells = []; // {row, col} — dipakai buildAndDownloadRekapXLSX untuk menebalkan & menggarisbawahi nama
    if (AppState.role === 'GuruBK') {
      const totalKolom = lebarKolom.length;
      const kolKiri = Math.max(0, Math.round(totalKolom * 0.05));
      const kolKanan = Math.min(Math.max(totalKolom - 4, kolKiri + 4), Math.round(totalKolom * 0.58));
      const sparseRow = (entries) => {
        const maxIdx = Math.max(kolKiri, kolKanan, ...entries.map(e => e[0]));
        const row = new Array(maxIdx + 1).fill('');
        entries.forEach(([idx, val]) => { row[idx] = val; });
        return row;
      };
      aoa.push([]);
      aoa.push(sparseRow([[kolKiri, 'Mengetahui,'], [kolKanan, `Wali Kelas ${d.kelas.nama}`]]));
      aoa.push(sparseRow([[kolKiri, 'Guru Bimbingan & Konseling']]));
      aoa.push([]); aoa.push([]); aoa.push([]);
      const namaRowNum = aoa.length + 1; // baris nama (1-indexed, setelah push berikutnya)
      aoa.push(sparseRow([[kolKiri, AppState.nama], [kolKanan, d.kelas.waliNama]]));
      aoa.push(sparseRow([[kolKanan, `NIP. ${d.kelas.waliNip}`]]));
      signatureNameCells.push({ row: namaRowNum, col: kolKiri + 1 }, { row: namaRowNum, col: kolKanan + 1 });
    }

    await buildAndDownloadRekapXLSX(aoa, lebarKolom, HEADER_ROW_START, headerRowCount, dataRowCount, dateColorMap, headerMerges, signatureNameCells, namaFile);
    showToast('Berhasil', `Laporan diunduh: ${namaFile}`, 'success');
  } catch (err) {
    showToast('Gagal Mengunduh', err.message || 'Terjadi kesalahan saat membuat file Excel.', 'danger');
  }
}

/**
 * Bangun file .xlsx dengan ExcelJS (bukan SheetJS) khusus untuk unduhan rekap ini,
 * karena SheetJS versi gratis TIDAK menyimpan border/warna/rata-tengah ke file —
 * sudah diuji dan terbukti hilang saat dibuka. ExcelJS mendukung penuh hal itu.
 * Kop surat & blok tanda tangan sengaja dibiarkan polos (tanpa garis) agar tampak
 * seperti kop resmi; hanya area tabel data yang diberi border + rata-tengah header.
 */
async function buildAndDownloadRekapXLSX(aoa, lebarKolom, headerRowStart, headerRowCount, dataRowCount, dateColorMap, headerMerges, signatureNameCells, namaFile) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Rekap Presensi');
  aoa.forEach(row => sheet.addRow(row.length ? row : [null])); // baris kosong tetap dianggap 1 baris

  const lebarTotal = Math.max(1, (aoa[headerRowStart] || []).length);
  (lebarKolom || []).forEach((lk, i) => { if (i < lebarTotal) sheet.getColumn(i + 1).width = lk.wch; });

  // Gabung & rata-tengah 4 baris kop surat (nama sekolah, alamat, judul, sub-judul)
  for (let r = 1; r <= 4; r++) {
    if (lebarTotal > 1) sheet.mergeCells(r, 1, r, lebarTotal);
    sheet.getCell(r, 1).alignment = { horizontal: 'center' };
  }
  sheet.getCell(1, 1).font = { bold: true, size: 13 };
  sheet.getCell(3, 1).font = { bold: true, size: 11 };

  // Border penuh + rata-tengah header pada area tabel data (baris header s.d. baris data terakhir)
  const headerStartRowNum = headerRowStart + 1; // ExcelJS 1-indexed
  const dataStartRowNum = headerStartRowNum + headerRowCount;
  const tableEndRowNum = dataStartRowNum + dataRowCount - 1;
  const nameColIndex1 = 3; // kolom "Nama Siswa" (1-indexed)
  const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  // Gabungkan sel header (No/NISN/Nama Siswa vertikal, label bulan & TOTAL horizontal) LEBIH DULU,
  // baru diberi border/alignment — supaya header benar-benar rata tengah secara visual di Excel,
  // bukan sekadar teks di pojok kiri sel yang kebetulan terlihat rapi karena pendek.
  (headerMerges || []).forEach(m => {
    try { sheet.mergeCells(m.r1, m.c1, m.r2, m.c2); } catch (e) { /* rentang sudah tergabung, abaikan */ }
  });

  for (let r = headerStartRowNum; r <= tableEndRowNum; r++) {
    const isHeaderRow = r < dataStartRowNum;
    for (let c = 1; c <= lebarTotal; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = border;
      cell.alignment = isHeaderRow
        ? { horizontal: 'center', vertical: 'middle', wrapText: true }
        : { horizontal: c === nameColIndex1 ? 'left' : 'center', vertical: 'middle' };
      if (isHeaderRow) cell.font = { bold: true };
      const colorHex = dateColorMap && dateColorMap[c - 1] !== undefined ? dateColorMap[c - 1] : null;
      if (colorHex) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + colorHex } };
    }
  }

  // Blok tanda tangan: nama ditebalkan & digarisbawahi — sesuai standar laporan resmi
  (signatureNameCells || []).forEach(({ row, col }) => {
    const cell = sheet.getCell(row, col);
    cell.font = { bold: true, underline: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = namaFile; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
