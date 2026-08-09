// ===== ID CHAT: UUID v4, disinkronkan dengan URL (?chat=...) =====
function generateUUID() {
    // crypto.randomUUID() didukung semua browser modern, gak perlu library tambahan
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    // fallback jaga-jaga buat browser lawas
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}
function getChatIdFromUrl() {
    const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/);
    return match ? match[1] : null;
}
function syncChatUrl(id, push = true) {
    const url = `/c/${id}`;
    if (push) history.pushState({ chatId: id }, '', url);
    else history.replaceState({ chatId: id }, '', url);
}

let currentChatId = getChatIdFromUrl() || localStorage.getItem('activeChatId') || generateUUID();
localStorage.setItem('activeChatId', currentChatId);
syncChatUrl(currentChatId, false); // replaceState: gak nambah entry history baru pas load pertama

let isLoaded = false;
let pendingImage = null;
let pendingDocument = null; // { data: dataURL, filename, mimeType } -- buat PDF/Word/Excel/CSV/TXT/JSON

// ===== MODE GELAP (disambungkan dari toggle di halaman Setelan) =====
function terapkanModeGelap() {
    const isDark = localStorage.getItem('darkMode') === 'true';
    document.body.classList.toggle('dark-mode', isDark);
}
terapkanModeGelap();
window.addEventListener('storage', (e) => {
    if (e.key === 'darkMode') terapkanModeGelap();
});

// ===== WARNA KUSTOM (disambungkan dari halaman Setelan) =====
// Terapkan warna background & teks yang sudah disimpan user di halaman Setelan.
function terapkanWarnaKustom() {
    const bg = localStorage.getItem('customBgColor');
    const text = localStorage.getItem('customTextColor');
    const root = document.documentElement;
    if (bg) {
        root.style.setProperty('--user-bg', bg);
        root.style.setProperty('--bg-main', bg); // variabel utama background di cyber.css
        root.style.setProperty('--bg-sidebar', bg); // background sidebar
    }
    if (text) {
        root.style.setProperty('--user-text', text);
        root.style.setProperty('--text-primary', text); // variabel utama warna teks di cyber.css
    }
}
terapkanWarnaKustom();

// Kalau user ganti warna di tab/halaman Setelan saat halaman chat ini juga terbuka,
// langsung ikut berubah tanpa perlu refresh manual.
window.addEventListener('storage', (e) => {
    if (e.key === 'customBgColor' || e.key === 'customTextColor') terapkanWarnaKustom();
});

const chatBox = document.getElementById('chat-box');

// ===== SAPAAN WELCOME SCREEN (ganti logo besar jadi teks sapaan) =====
function sapaanWaktu() {
    const jam = new Date().getHours();
    if (jam >= 4 && jam < 11) return 'Selamat Pagi';
    if (jam >= 11 && jam < 15) return 'Selamat Siang';
    if (jam >= 15 && jam < 19) return 'Selamat Sore';
    return 'Selamat Malam';
}
function namaUserSaatIni() {
    const user = firebase.auth().currentUser;
    if (!user) return 'Sobat';
    if (user.displayName) return user.displayName.trim().split(' ')[0];
    if (user.email) return user.email.split('@')[0];
    return 'Sobat';
}
function welcomeScreenHTML() {
    return `
        <div id="welcome-screen">
            <h2 class="welcome-greeting">${sapaanWaktu()}, <span class="welcome-username">${namaUserSaatIni()}</span> 👋</h2>
            <p class="welcome-sub">Ada yang bisa Whale Shark bantu hari ini?</p>
        </div>`;
}
function renderWelcomeScreen() {
    if (chatBox) chatBox.innerHTML = welcomeScreenHTML();
}

const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-button');
const fileInput = document.getElementById('file-input'); 
const uploadBtn = document.getElementById('upload-btn'); 
const previewContainer = document.getElementById('image-preview-container');
const previewImg = document.getElementById('image-preview');
const docPreviewContainer = document.getElementById('document-preview-container');
const docPreviewName = document.getElementById('document-preview-name');
const modelButton = document.getElementById('model-button');
const modelMenu = document.getElementById('model-menu');
const selectedModelLabel = document.getElementById('selected-model-label');
let selectedModel = localStorage.getItem('selectedModel') || 'groq';

// Ekstensi dokumen yang kontennya bisa dibaca server (bukan gambar).
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'json'];

function getFileExtension(filename) {
    return (filename.split('.').pop() || '').toLowerCase();
}

const firebaseConfig = {
  apiKey: "AIzaSyBFJSDfU9tpbzt08SLWWKTH0jvk7EuamJE",
  authDomain: "cyber-ai-login.firebaseapp.com",
  projectId: "cyber-ai-login",
  storageBucket: "cyber-ai-login.firebasestorage.app",
  messagingSenderId: "264159618394",
  appId: "1:264159618394:web:fec6285d7b96b58b623f63"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
renderWelcomeScreen(); // baru aman dipanggil di sini, Firebase sudah siap

// ===== Isi user-pill di sidebar kalau lagi login (gak ganggu flow login/redirect yang ada) =====
firebase.auth().onAuthStateChanged((user) => {
    const nameEl = document.querySelector('.user-pill .user-name');
    const avatarEl = document.querySelector('.user-pill .user-avatar');
    if (document.getElementById('welcome-screen')) renderWelcomeScreen(); // update sapaan pas nama user sudah kebaca
    if (!nameEl || !avatarEl) return;
    if (user) {
        nameEl.textContent = user.displayName || user.email || 'Akun Saya';
        avatarEl.innerHTML = user.photoURL
            ? `<img src="${user.photoURL}" alt="avatar">`
            : `<i class="fa-solid fa-user"></i>`;
        if (typeof window.tampilkanDaftarSidebar === 'function') window.tampilkanDaftarSidebar();
        if (typeof window.muatRiwayatChat === 'function') window.muatRiwayatChat(); // muat chat yang lagi aktif (dari URL/localStorage)
    } else {
        nameEl.textContent = 'Akun Saya';
        avatarEl.innerHTML = `<i class="fa-solid fa-user"></i>`;
    }
});

const SB_URL = 'https://oatgbiamflsvppykohvo.supabase.co'; 
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdGdiaWFtZmxzdnBweWtvaHZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTk5NjMsImV4cCI6MjA5MjkzNTk2M30.Nb8dPo6P_GOW6qfLn2PMC1YBJ7hevseGvGW2aGBNgGI'; 
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

// Nama bucket Supabase Storage tempat gambar (hasil AI maupun upload user) disimpan.
// GANTI string ini kalau nama bucket kamu beda (cek di Supabase Dashboard > Storage).
const IMAGE_BUCKET = 'ai-galery';

// Ubah data URL (base64) jadi Blob, perlu buat di-upload ke Supabase Storage.
async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return await res.blob();
}

function getExtensionFromDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:[a-zA-Z0-9]+\/([a-zA-Z0-9.+-]+);base64,/);
    let ext = match ? match[1] : 'png';
    if (ext === 'jpeg') ext = 'jpg';
    return ext;
}

// Upload satu gambar (data URL) ke Supabase Storage, balikin URL publiknya.
// Kalau gagal (misal belum login/RLS nolak), balikin null -- pemanggil harus
// siap handle null ini (skip simpan field gambar, jangan sampai gagal total).
async function uploadImageToSupabase(dataUrl, folderPath) {
    if (!dataUrl) return null;
    try {
        const blob = await dataUrlToBlob(dataUrl);
        const ext = getExtensionFromDataUrl(dataUrl);
        const filePath = `${folderPath}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

        const { error: uploadError } = await supabaseClient
            .storage
            .from(IMAGE_BUCKET)
            .upload(filePath, blob, { contentType: blob.type || `image/${ext}`, upsert: false });

        if (uploadError) {
            console.error('Gagal upload gambar ke Supabase Storage:', uploadError.message || uploadError);
            return null;
        }

        const { data: publicUrlData } = supabaseClient
            .storage
            .from(IMAGE_BUCKET)
            .getPublicUrl(filePath);

        return publicUrlData?.publicUrl || null;
    } catch (err) {
        console.error('Gagal proses upload gambar:', err);
        return null;
    }
}

if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;

        const isImage = file.type.startsWith('image/');
        const ext = getFileExtension(file.name);

        if (isImage) {
            if (file.size > 800000) { 
                alert("Gambar kegedean Bosku, maksimal 800KB!");
                fileInput.value = "";
                return;
            }
            cancelDocument(); // satu attachment aja per pesan, gambar atau dokumen
            const reader = new FileReader();
            reader.onload = (e) => {
                pendingImage = e.target.result; 
                previewImg.src = e.target.result;
                previewContainer.style.display = 'flex'; 
                uploadBtn.style.color = "#000000"; 
                uploadBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
            };
            reader.readAsDataURL(file);
            return;
        }

        if (!DOCUMENT_EXTENSIONS.includes(ext)) {
            alert(`Format ".${ext}" belum didukung Bosku. Yang bisa: gambar, PDF, Word (.doc/.docx), Excel (.xls/.xlsx), CSV, TXT, JSON.`);
            fileInput.value = "";
            return;
        }

        if (file.size > 8 * 1024 * 1024) { // 8MB, dokumen biasanya lebih besar dari gambar chat
            alert("File kegedean Bosku, maksimal 8MB!");
            fileInput.value = "";
            return;
        }

        cancelImage(); // satu attachment aja per pesan, gambar atau dokumen
        const reader = new FileReader();
        reader.onload = (e) => {
            pendingDocument = {
                data: e.target.result,
                filename: file.name,
                mimeType: file.type || `application/${ext}`
            };
            docPreviewName.textContent = file.name;
            docPreviewContainer.style.display = 'flex';
            uploadBtn.style.color = "#adff2f";
            uploadBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span>';
        };
        reader.readAsDataURL(file);
    });
}

window.cancelImage = () => {
    pendingImage = null;
    previewContainer.style.display = 'none';
    if (!pendingDocument) {
        uploadBtn.style.color = "#000000";
        uploadBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
        fileInput.value = "";
    }
};

window.cancelDocument = () => {
    pendingDocument = null;
    docPreviewContainer.style.display = 'none';
    if (!pendingImage) {
        uploadBtn.style.color = "#000000";
        uploadBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
        fileInput.value = "";
    }
};

// ===== HELPER UNTUK STREAMING (efek ngetik live, kayak Gemini) =====

// Bikin bubble AI kosong begitu chunk pertama nyampe. contentDiv ini yang
// terus-terusan di-update isinya selama teks masih ngalir.
function createStreamingAiMessage() {
    const chatBox = document.getElementById('chat-box');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ai-msg';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content streaming-cursor';
    msgDiv.appendChild(contentDiv);

    chatBox.appendChild(msgDiv);
    scrollToBottom();

    return { msgDiv, contentDiv };
}

// Selama masih streaming, render versi sederhana dulu (belum parse blok kode ```),
// biar ringan & gak flicker tiap chunk masuk.
function updateStreamingContent(contentDiv, fullText) {
    contentDiv.innerHTML = formatPlainAiText(fullText);
    scrollToBottom();
}

// Begitu stream selesai ({done:true}), render ulang versi final: blok kode beneran
// (dengan syntax highlight + tombol copy/download), sumber riset, gambar/video (kalau ada).
function finalizeStreamingMessage(msgDiv, contentDiv, fullText, sources, imageSrc, videoSrc) {
    if (contentDiv && contentDiv.parentNode === msgDiv) contentDiv.remove();
    msgDiv.appendChild(renderAiTextContent(fullText));

    if (sources && sources.length > 0) {
        msgDiv.appendChild(buildSourcesElement(sources));
    }
    if (videoSrc) {
        msgDiv.classList.add('has-media');
        msgDiv.prepend(buildChatVideoElement(videoSrc));
    }
    if (imageSrc) {
        msgDiv.classList.add('has-media');
        msgDiv.prepend(buildChatImageElement(imageSrc));
    }
    scrollToBottom();
}

// ===== JUDUL CHAT OTOMATIS (kayak ChatGPT/Gemini) =====
// Dipanggil sekali di awal chat baru, paralel sama request /chat utama
// biar gak nambah delay ke jawaban AI.
async function generateChatTitle(pesanPertama) {
    try {
        const res = await fetch('/chat/title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: pesanPertama })
        });
        const data = await res.json();
        return data.title || pesanPertama.slice(0, 40);
    } catch (e) {
        console.error('Gagal bikin judul chat otomatis:', e);
        return pesanPertama.slice(0, 40); // fallback: potong pesan aslinya
    }
}

async function sendMessage() {
    const text = userInput.value.trim();
    const user = firebase.auth().currentUser;
    const currentImage = pendingImage;
    const currentDocument = pendingDocument;

    if (text === "" && !currentImage && !currentDocument) return;

    const originalBtn = sendBtn.innerHTML;
    sendBtn.innerHTML = '<span class="loading-box"></span>';
    sendBtn.disabled = true;

    if (document.getElementById('welcome-screen')) document.getElementById('welcome-screen').remove();

    let contextData = "";
    if (user) {
        try {
            const { data: memories } = await supabaseClient
                .from('ai_memories')
                .select('chat_context')
                .eq('user_email', user.email)
                .order('created_at', { ascending: false })
                .limit(3);
            if (memories && memories.length > 0) {
                contextData = memories.map(m => m.chat_context).reverse().join("\n");
            }
        } catch (err) { console.error("Gagal tarik memori:", err); }
    }

    appendMessage('user', text, currentImage, null, currentDocument ? currentDocument.filename : null);
    cancelImage();
    cancelDocument();
    userInput.value = "";
    userInput.style.height = 'auto';
    showTypingIndicator();

    // Chat baru (belum punya judul) & ada teks -> minta AI bikinin judul,
    // jalan BARENGAN sama request jawaban utama (gak nunggu berurutan).
    const isChatBaru = !localStorage.getItem('currentChatTitle');
    const titlePromise = (isChatBaru && text) ? generateChatTitle(text) : Promise.resolve(null);

    try {
        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                context: contextData,
                image: currentImage,
                file: currentDocument,
                model: selectedModel
            })
        });

        const data = await res.json();
        hideTypingIndicator();

        const replyText = data.reply || 'Duh Bosku, aku lagi ngelamun. Tanya lagi yuk!';
        const msgEl = createStreamingAiMessage();
        updateStreamingContent(msgEl.contentDiv, replyText);
        finalizeStreamingMessage(msgEl.msgDiv, msgEl.contentDiv, replyText, data.sources || null, data.image || null, data.video || null);

        if (user) {
            supabaseClient.from('ai_memories').insert([{
                user_email: user.email,
                user_name: user.displayName,
                chat_context: `User: ${text} | AI: ${replyText}`
            }]).then(() => console.log("Memori aman di Supabase"));

            const folderPath = `${user.uid}/${currentChatId}`;
            const gambarUserUrl = await uploadImageToSupabase(currentImage, folderPath);

            const autoTitle = await titlePromise; // sudah jalan paralel dari atas, biasanya udah selesai duluan
            if (autoTitle) localStorage.setItem('currentChatTitle', autoTitle);
            const judulUntukDisimpan = localStorage.getItem('currentChatTitle') || "Chat Baru";

            await db.collection("riwayat_chat").add({
                uid: user.uid,
                chat_id: currentChatId,
                judul_chat: judulUntukDisimpan,
                pesan: text,
                gambarUrl: gambarUserUrl,
                jawaban: replyText,
                gambarAiUrl: data.image || null,
                videoAiUrl: data.video || null,
                waktu: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (typeof window.tampilkanDaftarSidebar === "function") window.tampilkanDaftarSidebar();
        }
    } catch (err) {
        console.error("Error chat:", err);
        hideTypingIndicator();
        appendMessage('ai', "Server sedang ada masalah.");
    } finally {
        hideTypingIndicator();
        sendBtn.innerHTML = originalBtn;
        sendBtn.disabled = false;
    }
}

function scrollToBottom() {
    const chatBox = document.getElementById('chat-box');
    if (chatBox) {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

// Escape karakter HTML spesial supaya teks/kode nggak dianggap tag oleh browser.
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Suntik CSS sekali aja buat rapiin heading/list/paragraf hasil markdown AI,
// biar gak tergantung sama stylesheet eksternal yang mungkin belum punya aturan ini.
(function injectMarkdownStyles() {
    if (document.getElementById('ws-markdown-style')) return; // jangan dobel
    const style = document.createElement('style');
    style.id = 'ws-markdown-style';
    style.textContent = `
        .msg-content { line-height: 1.55; }
        .msg-content p { margin: 0 0 10px; }
        .msg-content p:last-child { margin-bottom: 0; }
        .msg-content ul.msg-list,
        .msg-content ol.msg-list {
            margin: 4px 0 12px;
            padding-left: 22px;
        }
        .msg-content ul.msg-list { list-style: disc; }
        .msg-content ol.msg-list { list-style: decimal; }
        .msg-content li { margin-bottom: 6px; }
        .msg-content li:last-child { margin-bottom: 0; }
        .msg-content li > ul.msg-list,
        .msg-content li > ol.msg-list { margin: 6px 0 0; }
        .msg-heading {
            margin: 14px 0 8px;
            font-weight: 700;
            line-height: 1.3;
        }
        .msg-content > .msg-heading:first-child { margin-top: 0; }
        h4.msg-heading { font-size: 1.15em; }
        h5.msg-heading { font-size: 1.08em; }
        h6.msg-heading { font-size: 1em; }
        .msg-content code.inline-code {
            padding: 1px 5px;
            border-radius: 4px;
            background: rgba(127,127,127,0.18);
            font-size: 0.92em;
        }
    `;
    document.head.appendChild(style);
})();

// Format inline SAJA (bold **teks**, italic *teks*, inline `code`) untuk satu baris teks.
// Dipakai di dalam markdownToHtml, bukan buat teks multi-baris langsung.
function formatInlineAiText(line) {
    let cleaned = line
        .replace(/\$/g, '')
        .replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '($1 / $2)')
        .replace(/\\times/g, 'x')
        .replace(/\\cdot/g, '.')
        .replace(/\\/g, '');
    let escaped = escapeHtml(cleaned);
    escaped = escaped.replace(/`([^`]+)`/g, (m, code) => `<code class="inline-code">${code}</code>`);
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return escaped;
}

// Ubah teks markdown (heading, list bernomor/bullet, paragraf) jadi HTML rapi.
// PENTING: ini cuma dipanggil untuk bagian teks biasa, bukan isi blok kode -- soalnya
// strip backslash di sini bisa ngerusak kode (regex, path Windows, escape sequence, dll).
function markdownToHtml(text) {
    // Kalau model nulis "1. **Judul** - keterangan 2. **Judul lain** - ..." dalam satu baris
    // panjang (tanpa newline beneran), pecah dulu jadi baris terpisah tiap nomor baru,
    // biar tetap kebaca sebagai list meski AI lupa kasih newline.
    const normalized = text.replace(/([^\n])\s+(\d+)\.\s+(?=\*\*|[A-Za-z0-9])/g, '$1\n$2. ');

    const lines = normalized.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let listType = null; // 'ul' | 'ol' | null
    let paragraphBuffer = [];

    const flushParagraph = () => {
        if (paragraphBuffer.length) {
            html += `<p>${paragraphBuffer.join('<br>')}</p>`;
            paragraphBuffer = [];
        }
    };
    const closeList = () => {
        if (listType) {
            html += `</${listType}>`;
            listType = null;
        }
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line === '') {
            flushParagraph();
            closeList();
            continue;
        }

        const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            flushParagraph();
            closeList();
            const level = Math.min(headingMatch[1].length + 3, 6); // # -> h4 ... #### -> h6
            html += `<h${level} class="msg-heading">${formatInlineAiText(headingMatch[2])}</h${level}>`;
            continue;
        }

        const ulMatch = line.match(/^[-*•]\s+(.+)$/);
        if (ulMatch) {
            flushParagraph();
            if (listType !== 'ul') { closeList(); html += '<ul class="msg-list">'; listType = 'ul'; }
            html += `<li>${formatInlineAiText(ulMatch[1])}</li>`;
            continue;
        }

        const olMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
        if (olMatch) {
            flushParagraph();
            if (listType !== 'ol') { closeList(); html += '<ol class="msg-list">'; listType = 'ol'; }
            html += `<li>${formatInlineAiText(olMatch[2])}</li>`;
            continue;
        }

        closeList();
        paragraphBuffer.push(formatInlineAiText(line));
    }

    flushParagraph();
    closeList();

    return html || formatInlineAiText(text);
}

// Alias biar kompatibel dengan kode lama yang masih manggil nama ini.
function formatPlainAiText(text) {
    return markdownToHtml(text);
}

// Format teks user: cuma escape HTML + dukung **bold**, tanpa strip LaTeX (pesan user apa adanya).
function formatUserText(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

// Tebak ekstensi file yang masuk akal dari nama bahasa, buat tombol download kode.
function guessFileExtension(lang) {
    const map = {
        javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
        python: 'py', py: 'py', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp',
        csharp: 'cs', 'c#': 'cs', html: 'html', css: 'css', json: 'json',
        bash: 'sh', shell: 'sh', sh: 'sh', sql: 'sql', php: 'php',
        go: 'go', rust: 'rs', ruby: 'rb', kotlin: 'kt', swift: 'swift',
        yaml: 'yml', xml: 'xml', dart: 'dart'
    };
    if (!lang) return 'txt';
    return map[lang.toLowerCase()] || lang.toLowerCase();
}

// Bikin satu kotak blok kode: header (label bahasa + tombol salin & download) + isi kode
// dengan syntax highlighting (lewat highlight.js, kalau library-nya berhasil ke-load).
function buildCodeBlockElement(lang, code) {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const header = document.createElement('div');
    header.className = 'code-block-header';

    const langLabel = document.createElement('span');
    langLabel.className = 'code-block-lang';
    langLabel.textContent = lang || 'text';

    const actions = document.createElement('div');
    actions.className = 'code-block-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'code-block-btn';
    copyBtn.title = 'Salin kode';
    copyBtn.setAttribute('aria-label', 'Salin kode');
    copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span>';
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(code);
            const original = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span class="material-symbols-outlined">check</span>';
            setTimeout(() => { copyBtn.innerHTML = original; }, 1500);
        } catch (err) {
            console.error('Gagal menyalin kode:', err);
        }
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'code-block-btn';
    downloadBtn.title = 'Download kode';
    downloadBtn.setAttribute('aria-label', 'Download kode');
    downloadBtn.innerHTML = '<span class="material-symbols-outlined">download</span>';
    downloadBtn.addEventListener('click', () => {
        const ext = guessFileExtension(lang);
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `code-${Date.now()}.${ext}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(downloadBtn);
    header.appendChild(langLabel);
    header.appendChild(actions);

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    if (lang) codeEl.className = `language-${lang}`;
    codeEl.textContent = code; // textContent otomatis aman dari HTML injection

    pre.appendChild(codeEl);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);

    if (window.hljs) {
        try { window.hljs.highlightElement(codeEl); } catch (e) { /* bahasa nggak dikenal, biarin polos */ }
    }

    return wrapper;
}

// Satu blok teks biasa (bukan kode) -- dirender lewat markdownToHtml (heading/list/paragraf).
function appendPlainTextBlock(fragment, text) {
    const div = document.createElement('div');
    div.className = 'msg-content';
    div.innerHTML = markdownToHtml(text);
    fragment.appendChild(div);
}

// Parse balasan AI: pisahin blok kode (```bahasa ... ```) dari teks biasa,
// render masing-masing dengan caranya sendiri, gabung jadi satu fragment terurut.
function renderAiTextContent(rawText) {
    const fragment = document.createDocumentFragment();
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;

    let lastIndex = 0;
    let match;
    let hasContent = false;

    while ((match = codeBlockRegex.exec(rawText)) !== null) {
        const [fullMatch, lang, code] = match;

        if (match.index > lastIndex) {
            const beforeText = rawText.slice(lastIndex, match.index);
            if (beforeText.trim() !== '') {
                appendPlainTextBlock(fragment, beforeText);
                hasContent = true;
            }
        }

        fragment.appendChild(buildCodeBlockElement(lang, code.replace(/\n$/, '')));
        hasContent = true;
        lastIndex = match.index + fullMatch.length;
    }

    if (lastIndex < rawText.length) {
        const remaining = rawText.slice(lastIndex);
        if (remaining.trim() !== '') {
            appendPlainTextBlock(fragment, remaining);
            hasContent = true;
        }
    }

    if (!hasContent) {
        appendPlainTextBlock(fragment, rawText);
    }

    return fragment;
}

function appendMessage(role, text, imageSrc = null, videoSrc = null, documentName = null, sources = null) {
    const chatBox = document.getElementById('chat-box');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;

    // Kalau ada gambar/video/dokumen, bubble pakai sudut yang lebih wajar (bukan pill 1000px),
    // soalnya pill ekstrem itu yang bikin background media "ketarik" jadi oval raksasa
    // dan keliatan nyatu sama background chat.
    if (imageSrc || videoSrc || documentName) {
        msgDiv.classList.add('has-media');
    }

    if (role === 'ai') {
        msgDiv.appendChild(renderAiTextContent(text));
        if (sources && sources.length > 0) {
            msgDiv.appendChild(buildSourcesElement(sources));
        }
    } else {
        const div = document.createElement('div');
        div.className = 'msg-content';
        div.innerHTML = formatUserText(text);
        msgDiv.appendChild(div);
    }

    // Gambar/video dibuat lewat DOM API (bukan string innerHTML) supaya data URL base64
    // yang panjang (apalagi video, bisa jauh lebih besar dari gambar) tidak perlu
    // di-escape manual ke dalam atribut HTML.
    if (videoSrc) {
        msgDiv.prepend(buildChatVideoElement(videoSrc));
    }
    if (imageSrc) {
        msgDiv.prepend(buildChatImageElement(imageSrc));
    }
    if (documentName) {
        msgDiv.prepend(buildChatDocumentChip(documentName));
    }

    chatBox.appendChild(msgDiv);
    
    scrollToBottom(); 
}

// Daftar link sumber hasil riset web (Tavily), ditaruh di bawah jawaban AI.
function buildSourcesElement(sources) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-sources';

    const label = document.createElement('div');
    label.className = 'ai-sources-label';
    label.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Sumber riset web:';
    wrapper.appendChild(label);

    const list = document.createElement('div');
    list.className = 'ai-sources-list';
    sources.forEach((src) => {
        const a = document.createElement('a');
        a.href = src.link;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'ai-source-chip';
        a.textContent = src.title || src.link;
        list.appendChild(a);
    });
    wrapper.appendChild(list);

    return wrapper;
}

// Chip kecil penanda "file ini yang diupload" di bubble user (bukan thumbnail, cuma nama file).
function buildChatDocumentChip(filename) {
    const chip = document.createElement('div');
    chip.className = 'chat-document-chip';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-file-lines';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = filename;
    chip.appendChild(icon);
    chip.appendChild(nameSpan);
    return chip;
}


// Bikin elemen video chat: tag <video> dengan kontrol native, plus tombol download kecil
// di pojok kanan atas (konsisten dengan gambar). Nggak pakai lightbox karena <video>
// sudah punya kontrol play/pause/fullscreen bawaan.
function buildChatVideoElement(videoSrc) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-image-wrapper chat-video-wrapper';

    const video = document.createElement('video');
    video.src = videoSrc;
    video.controls = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'chat-image-download';
    downloadBtn.title = 'Download video';
    downloadBtn.setAttribute('aria-label', 'Download video');
    downloadBtn.innerHTML = '<span class="material-symbols-outlined">download</span>';
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.downloadChatImage(videoSrc, 'video-ai');
    });

    wrapper.appendChild(video);
    wrapper.appendChild(downloadBtn);
    return wrapper;
}

// Bikin elemen gambar chat yang interaktif: klik untuk perbesar (lightbox),
// plus tombol download kecil di pojok kanan atas.
function buildChatImageElement(imageSrc) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-image-wrapper';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = 'Gambar chat';
    img.loading = 'lazy';
    img.addEventListener('click', () => window.openImageLightbox(imageSrc));

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'chat-image-download';
    downloadBtn.title = 'Download gambar';
    downloadBtn.setAttribute('aria-label', 'Download gambar');
    downloadBtn.innerHTML = '<span class="material-symbols-outlined">download</span>';
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // jangan ikut buka lightbox
        window.downloadChatImage(imageSrc);
    });

    wrapper.appendChild(img);
    wrapper.appendChild(downloadBtn);
    return wrapper;
}

// Download gambar (data URL base64) langsung ke device, tanpa perlu request ke server.
window.downloadChatImage = function(src, filenameHint = 'gambar-ai') {
    try {
        const mimeMatch = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
        let extension = 'png';
        if (mimeMatch) {
            extension = mimeMatch[1].split('/')[1] || 'png';
            if (extension === 'jpeg') extension = 'jpg';
        }
        const link = document.createElement('a');
        link.href = src;
        link.download = `${filenameHint}-${Date.now()}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (err) {
        console.error('Gagal download gambar:', err);
        alert('Gagal download gambar, Bosku. Coba tahan/klik kanan gambar lalu simpan manual.');
    }
};

// Lightbox sederhana: dibuat sekali secara dinamis lewat JS, lalu dipakai ulang tiap kali gambar di-klik.
function getOrCreateLightbox() {
    let overlay = document.getElementById('image-lightbox-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'image-lightbox-overlay';
    overlay.innerHTML = `
        <div class="lightbox-content">
            <button class="lightbox-close" type="button" aria-label="Tutup">&times;</button>
            <img id="lightbox-img" src="" alt="Gambar diperbesar">
            <div class="lightbox-actions">
                <button class="lightbox-btn" type="button" id="lightbox-download-btn">
                    <span class="material-symbols-outlined" style="padding:0;font-size:18px;">download</span> Download
                </button>
                <button class="lightbox-btn secondary" type="button" id="lightbox-close-btn">Tutup</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) window.closeImageLightbox();
    });
    overlay.querySelector('.lightbox-close').addEventListener('click', window.closeImageLightbox);
    overlay.querySelector('#lightbox-close-btn').addEventListener('click', () => window.closeImageLightbox());
    overlay.querySelector('#lightbox-download-btn').addEventListener('click', () => {
        if (overlay.dataset.currentSrc) window.downloadChatImage(overlay.dataset.currentSrc);
    });

    return overlay;
}

window.openImageLightbox = function(src) {
    const overlay = getOrCreateLightbox();
    overlay.querySelector('#lightbox-img').src = src;
    overlay.dataset.currentSrc = src;
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
};

window.closeImageLightbox = function() {
    const overlay = document.getElementById('image-lightbox-overlay');
    if (overlay) overlay.classList.remove('visible');
    document.body.style.overflow = '';
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.closeImageLightbox();
});

function showTypingIndicator() {
    const typingId = 'typing-indicator';
    if (document.getElementById(typingId)) return;
    const div = document.createElement('div');
    div.id = typingId;
    div.className = 'message ai-msg typing';
    div.innerHTML = `<div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><span class="typing-label"></span>`;
    chatBox.appendChild(div);
    scrollToBottom();
}

function hideTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
}

firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        document.getElementById('login-btn').innerHTML = `<img src="${user.photoURL}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        if (!isLoaded) { isLoaded = true; muatRiwayatChat(); tampilkanDaftarSidebar(); }
    } else { window.location.href = "/login.html"; }
});

window.muatRiwayatChat = function() {
    const user = firebase.auth().currentUser;
    if (user && chatBox) {
        db.collection("riwayat_chat")
            .where("uid", "==", user.uid)
            .where("chat_id", "==", currentChatId)
            .orderBy("waktu", "asc")
            .get()
            .then((snap) => {
                if (snap.empty) { renderWelcomeScreen(); return; } // chat baru/kosong -> tetap tampil sapaan
                chatBox.innerHTML = "";
                snap.forEach((doc) => {
                    const d = doc.data();
                    appendMessage('user', d.pesan, d.gambarUrl);
                    if (d.jawaban) appendMessage('ai', d.jawaban, d.gambarAiUrl, d.videoAiUrl);
                });
            })
            .catch(err => console.error("Error muat riwayat:", err));
    }
};

window.tampilkanDaftarSidebar = function() {
    const user = firebase.auth().currentUser;
    const listContainer = document.getElementById('riwayat-list');
    if (user && listContainer) {
        db.collection("riwayat_chat").where("uid", "==", user.uid).orderBy("waktu", "desc").get().then((snap) => {
            listContainer.innerHTML = "";
            const ids = new Set();
            snap.forEach((doc) => {
                const d = doc.data();
                if (!ids.has(d.chat_id)) {
                    ids.add(d.chat_id);
                    const item = document.createElement('div');
                    item.className = 'history-item';
                    item.innerHTML = `<i class="far fa-comment"></i> <span>${d.judul_chat || d.pesan.substring(0,20)}</span>`;
                    item.onclick = () => {
                        currentChatId = d.chat_id;
                        localStorage.setItem('activeChatId', d.chat_id);
                        localStorage.setItem('currentChatTitle', d.judul_chat || 'Chat Baru');
                        syncChatUrl(d.chat_id); // update URL biar bisa di-refresh/share balik ke chat ini
                        muatRiwayatChat();
                        if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('sidebar-hidden');
                    };
                    listContainer.appendChild(item);
                }
            });
        });
    }
};

window.ubahNamaChat = function() {
    const namaBaru = prompt("Sobat Cyber mau ganti nama chat ini jadi apa?");
    
    if (namaBaru && namaBaru.trim() !== "") {
        const user = firebase.auth().currentUser;
        if (!user) {
            alert("Sobat Cyber harus login dulu ya!");
            return;
        }

        const activeChatId = localStorage.getItem('activeChatId');

        if (activeChatId) {
            db.collection("riwayat_chat")
                .where("uid", "==", user.uid)
                .where("chat_id", "==", activeChatId)
                .get()
                .then((snap) => {
                    const batch = db.batch();
                    snap.forEach((doc) => {
                        batch.update(doc.ref, { judul_chat: namaBaru });
                    });
                    return batch.commit();
                })
                .then(() => {
                    localStorage.setItem('currentChatTitle', namaBaru);
                    alert("Nama chat berhasil diubah, Bosku!");
                    if (typeof tampilkanDaftarSidebar === "function") {
                        tampilkanDaftarSidebar();
                    }
                })
                .catch((err) => {
                    console.error("Error ganti nama:", err);
                    alert("Waduh, gagal ganti nama nih.");
                });
        }
    }
};

window.toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    const isDesktop = window.innerWidth > 768;
    if (isDesktop) {
        sidebar.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('sidebar-collapsed'));
    } else {
        sidebar.classList.toggle('sidebar-visible');
        sidebar.classList.toggle('sidebar-hidden');
    }
};

window.filterRiwayat = (keyword) => {
    const k = keyword.trim().toLowerCase();
    document.querySelectorAll('#riwayat-list .history-item').forEach((item) => {
        const text = item.textContent.toLowerCase();
        item.style.display = !k || text.includes(k) ? 'flex' : 'none';
    });
};

// Sidebar selalu persistent di desktop (rail ikon kalau di-collapse), tetap drawer di mobile.
(function initSidebarState() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (window.innerWidth > 768) {
        sidebar.classList.remove('sidebar-hidden');
        sidebar.classList.add('sidebar-visible');
        if (localStorage.getItem('sidebarCollapsed') === 'true') sidebar.classList.add('sidebar-collapsed');
    }
})();

window.bukaSetting = function() {
    window.location.href = '/setting';
};

// Tombol back/forward browser -> pindah chat sesuai ID di URL, bukan keluar app
window.addEventListener('popstate', () => {
    const idFromUrl = getChatIdFromUrl();
    currentChatId = idFromUrl || generateUUID();
    localStorage.setItem('activeChatId', currentChatId);
    if (firebase.auth().currentUser) {
        muatRiwayatChat();
    } else {
        renderWelcomeScreen();
    }
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.add('sidebar-hidden');
});

window.mulaiChatBaru = function() {
    currentChatId = generateUUID();
    localStorage.setItem('activeChatId', currentChatId);
    localStorage.removeItem('currentChatTitle');
    syncChatUrl(currentChatId); // pushState: nambah entry history baru, bisa di-back

    renderWelcomeScreen();
    
    if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.add('sidebar-hidden');
    }
    
    console.log("Chat Baru Dimulai:", currentChatId);
};

if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (userInput) {
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
    });
}

function updateModelUI() {
    if (!selectedModelLabel || !modelMenu) return;
    if (selectedModel === 'gemini') {
        selectedModelLabel.textContent = 'Gemini';
    } else if (selectedModel === 'gpt-oss') {
        selectedModelLabel.textContent = 'GPT-OSS 120B';
    } else {
        selectedModelLabel.textContent = 'Groq';
    }
    const options = modelMenu.querySelectorAll('.model-option');
    options.forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.model === selectedModel);
    });
}

if (modelButton) {
    modelButton.addEventListener('click', () => {
        if (!modelMenu) return;
        modelMenu.classList.toggle('visible');
        modelButton.setAttribute('aria-expanded', modelMenu.classList.contains('visible'));
    });
}

if (modelMenu) {
    modelMenu.addEventListener('click', (event) => {
        const option = event.target.closest('.model-option');
        if (!option) return;
        selectedModel = option.dataset.model;
        localStorage.setItem('selectedModel', selectedModel);
        updateModelUI();
        modelMenu.classList.remove('visible');
        if (modelButton) modelButton.setAttribute('aria-expanded', 'false');
    });
}

document.addEventListener('click', (event) => {
    if (!modelMenu || !modelButton) return;
    if (!modelButton.contains(event.target) && !modelMenu.contains(event.target)) {
        modelMenu.classList.remove('visible');
        modelButton.setAttribute('aria-expanded', 'false');
    }
});

updateModelUI();

// Poll server model status and disable Gemini option when unavailable
async function checkModelStatus() {
    try {
        const res = await fetch('/models/status');
        if (!res.ok) return;
        const json = await res.json();
        const geminiAvailable = json?.gemini?.available === true;
        const options = modelMenu.querySelectorAll('.model-option');
        options.forEach(opt => {
            if (opt.dataset.model === 'gemini') {
                opt.classList.toggle('disabled', !geminiAvailable);
                opt.disabled = !geminiAvailable;
                opt.setAttribute('aria-disabled', String(!geminiAvailable));
            }
        });

        // If Gemini is not available but currently selected, switch to Groq
        if (!geminiAvailable && selectedModel === 'gemini') {
            selectedModel = 'groq';
            localStorage.setItem('selectedModel', selectedModel);
            updateModelUI();
        }
    } catch (e) {
        console.warn('Gagal cek model status:', e.message);
    }
}

// Start polling every 20 seconds
checkModelStatus();
setInterval(checkModelStatus, 20000);