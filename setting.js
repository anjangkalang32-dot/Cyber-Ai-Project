// ============================================================
// setting.js — Script halaman Setelan Nexus AI
// ============================================================

// ===== KONFIGURASI =====
const firebaseConfig = {
    apiKey: "AIzaSyBFJSDfU9tpbzt08SLWWKTH0jvk7EuamJE",
    authDomain: "cyber-ai-login.firebaseapp.com",
    projectId: "cyber-ai-login",
    storageBucket: "cyber-ai-login.firebasestorage.app",
    messagingSenderId: "264159618394",
    appId: "1:264159618394:web:fec6285d7b96b58b623f63"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ===== WARNA KUSTOM: DEFAULT & STATE =====
const DEFAULT_BG = '#ffffff';
const DEFAULT_TEXT = '#000000';
let warnaBgTersimpan = localStorage.getItem('customBgColor') || DEFAULT_BG;
let warnaTextTersimpan = localStorage.getItem('customTextColor') || DEFAULT_TEXT;

// ===== INISIALISASI SAAT DOM SIAP =====
window.addEventListener('DOMContentLoaded', () => {
    muatPreferensi();
    tutupModalKlikLuar();
    terapkanWarna(warnaBgTersimpan, warnaTextTersimpan);
});

// ===== MUAT PROFIL DARI FIREBASE AUTH =====
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        document.getElementById('profileName').textContent = user.displayName || 'Pengguna Nexus';
        document.getElementById('profileEmail').textContent = user.email || '-';
        document.getElementById('input-nama').value = user.displayName || '';

        if (user.photoURL) {
            document.getElementById('profileAvatar').innerHTML =
                `<img src="${user.photoURL}" alt="Foto profil">`;
        }
    }
});

// ===== PREFERENSI localStorage =====
function muatPreferensi() {
    document.getElementById('toggle-darkmode').checked  = localStorage.getItem('darkMode') === 'true';
    document.getElementById('select-fontsize').value    = localStorage.getItem('fontSize') || 'normal';
    document.getElementById('select-lang').value        = localStorage.getItem('lang') || 'id';
    document.getElementById('select-model').value       = localStorage.getItem('selectedModel') || 'groq';
    document.getElementById('toggle-enter').checked     = localStorage.getItem('enterSend') !== 'false';
    document.getElementById('toggle-websearch').checked = localStorage.getItem('webSearch') === 'true';
}

// ===== TOAST =====
function showToast(msg, dur = 2500) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), dur);
}

// ===== MODAL =====
function bukaModal(id) { document.getElementById(id).classList.add('active'); }
function tutupModal(id) { document.getElementById(id).classList.remove('active'); }
function tutupModalKlikLuar() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });
}

// ===== AKUN =====
function bukaModalNama() { bukaModal('modal-nama'); }

function simpanNama() {
    const nama = document.getElementById('input-nama').value.trim();
    if (!nama) { showToast('Nama tidak boleh kosong!'); return; }
    const user = firebase.auth().currentUser;
    if (!user) { showToast('Kamu harus login dulu!'); return; }
    user.updateProfile({ displayName: nama }).then(() => {
        document.getElementById('profileName').textContent = nama;
        tutupModal('modal-nama');
        showToast('✅ Nama berhasil diperbarui!');
    }).catch(() => showToast('Gagal memperbarui nama.'));
}

function kirimResetPassword() {
    const user = firebase.auth().currentUser;
    if (!user || !user.email) { showToast('Tidak ada email pada akun ini.'); return; }
    firebase.auth().sendPasswordResetEmail(user.email).then(() => {
        showToast(`📧 Email reset dikirim ke ${user.email}`);
    }).catch(err => showToast('Gagal kirim email: ' + err.message));
}

function konfirmasiLogout() { bukaModal('modal-logout'); }

function doLogout() {
    firebase.auth().signOut().then(() => {
        window.location.href = 'login.html';
    }).catch(() => showToast('Gagal logout.'));
}

// ===== TAMPILAN =====
function toggleDarkMode(el) {
    localStorage.setItem('darkMode', el.checked);
    showToast(el.checked ? '🌙 Dark mode aktif' : '☀️ Light mode aktif');
}
function gantiFont(val) {
    localStorage.setItem('fontSize', val);
    showToast('✅ Ukuran font disimpan');
}
function gantiLang(val) {
    localStorage.setItem('lang', val);
    showToast('✅ Bahasa disimpan');
}

// ===== WARNA KUSTOM =====
function terapkanWarna(bg, text) {
    document.documentElement.style.setProperty('--user-bg', bg);
    document.documentElement.style.setProperty('--user-text', text);
}

function bukaModalWarna() {
    document.getElementById('input-warna-bg').value = warnaBgTersimpan;
    document.getElementById('input-warna-text').value = warnaTextTersimpan;
    previewWarna();
    bukaModal('modal-warna');
}

function previewWarna() {
    const bg = document.getElementById('input-warna-bg').value;
    const text = document.getElementById('input-warna-text').value;
    const preview = document.getElementById('warna-preview');
    preview.style.background = bg;
    preview.style.color = text;
    terapkanWarna(bg, text); // pratinjau langsung di halaman
}

function batalWarnaKustom() {
    terapkanWarna(warnaBgTersimpan, warnaTextTersimpan); // kembalikan ke warna tersimpan
    tutupModal('modal-warna');
}

function simpanWarnaKustom() {
    warnaBgTersimpan = document.getElementById('input-warna-bg').value;
    warnaTextTersimpan = document.getElementById('input-warna-text').value;
    localStorage.setItem('customBgColor', warnaBgTersimpan);
    localStorage.setItem('customTextColor', warnaTextTersimpan);
    terapkanWarna(warnaBgTersimpan, warnaTextTersimpan);
    tutupModal('modal-warna');
    showToast('✅ Warna kustom disimpan');
}

function resetWarnaKustom() {
    document.getElementById('input-warna-bg').value = DEFAULT_BG;
    document.getElementById('input-warna-text').value = DEFAULT_TEXT;
    previewWarna();
}

// ===== CHAT =====
function gantiModelDefault(val) {
    localStorage.setItem('selectedModel', val);
    showToast('✅ Model default disimpan');
}
function simpanToggle(key, val) {
    localStorage.setItem(key, val);
    const label = { enterSend: 'Enter untuk kirim', webSearch: 'Riset web' }[key] || key;
    showToast(`✅ ${label} ${val ? 'aktif' : 'nonaktif'}`);
}

function hapusSemuaRiwayat() { bukaModal('modal-hapus-riwayat'); }
function doHapusRiwayat() {
    const user = firebase.auth().currentUser;
    if (!user) { showToast('Harus login dulu!'); return; }
    db.collection('riwayat_chat').where('uid', '==', user.uid).get().then(snap => {
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        return batch.commit();
    }).then(() => {
        tutupModal('modal-hapus-riwayat');
        showToast('🗑️ Semua riwayat berhasil dihapus');
    }).catch(() => showToast('Gagal menghapus riwayat.'));
}

// ===== LAINNYA =====
function bukaLink(url) { window.open(url, '_blank'); }

function konfirmasiHapusAkun() {
    document.getElementById('input-konfirmasi-hapus').value = '';
    bukaModal('modal-hapus-akun');
}
function doHapusAkun() {
    const konfirmasi = document.getElementById('input-konfirmasi-hapus').value.trim();
    if (konfirmasi !== 'HAPUS') { showToast('Ketik HAPUS dengan huruf kapital!'); return; }
    const user = firebase.auth().currentUser;
    if (!user) { showToast('Tidak ada sesi login.'); return; }
    db.collection('riwayat_chat').where('uid', '==', user.uid).get().then(snap => {
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        return batch.commit();
    }).then(() => user.delete()).then(() => {
        window.location.href = 'login.html';
    }).catch(err => {
        showToast('Gagal hapus akun. Mungkin perlu login ulang dulu.');
        console.error(err);
    });
}