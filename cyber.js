let currentChatId = localStorage.getItem('activeChatId') || Date.now().toString();
let isLoaded = false;
let pendingImage = null;

const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-button');
const fileInput = document.getElementById('file-input'); 
const uploadBtn = document.getElementById('upload-btn'); 
const previewContainer = document.getElementById('image-preview-container');
const previewImg = document.getElementById('image-preview');
const modelButton = document.getElementById('model-button');
const modelMenu = document.getElementById('model-menu');
const selectedModelLabel = document.getElementById('selected-model-label');
let selectedModel = localStorage.getItem('selectedModel') || 'groq';

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

const SB_URL = 'https://oatgbiamflsvppykohvo.supabase.co'; 
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdGdiaWFtZmxzdnBweWtvaHZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTk5NjMsImV4cCI6MjA5MjkzNTk2M30.Nb8dPo6P_GOW6qfLn2PMC1YBJ7hevseGvGW2aGBNgGI'; 
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

// Nama bucket Supabase Storage tempat gambar (hasil AI maupun upload user) disimpan.
// GANTI string ini kalau nama bucket kamu beda (cek di Supabase Dashboard > Storage).
const IMAGE_BUCKET = 'ai-galeri';

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
        if (file) {
            if (file.size > 800000) { 
                alert("Gambar kegedean Bosku, maksimal 800KB!");
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                pendingImage = e.target.result; 
                previewImg.src = e.target.result;
                previewContainer.style.display = 'flex'; 
                uploadBtn.style.color = "#adff2f"; 
                uploadBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span>';
            };
            reader.readAsDataURL(file);
        }
    });
}

window.cancelImage = () => {
    pendingImage = null;
    previewContainer.style.display = 'none';
    uploadBtn.style.color = "#000000";
    uploadBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    fileInput.value = "";
};

async function sendMessage() {
    const text = userInput.value.trim();
    const user = firebase.auth().currentUser;
    const currentImage = pendingImage; 

    if (text === "" && !currentImage) return;

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

    appendMessage('user', text, currentImage);
    cancelImage(); 
    userInput.value = "";

    showTypingIndicator();

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: text, 
                context: contextData, 
                image: currentImage,
                model: selectedModel
            }),
        });
        
        const data = await response.json();
        hideTypingIndicator();
        appendMessage('ai', data.reply, data.image, data.video);

        if (user) {
            supabaseClient.from('ai_memories').insert([{ 
                user_email: user.email, 
                user_name: user.displayName, 
                chat_context: `User: ${text} | AI: ${data.reply}` 
            }]).then(() => console.log("Memori aman di Supabase, Bosku!"));
        }

        if (user) {
            // Upload gambar/video (kalau ada) ke Supabase Storage dulu, paralel biar cepat.
            // Base64-nya sendiri TIDAK disimpan ke Firestore -- cuma URL publiknya,
            // soalnya Firestore punya batas ukuran dokumen 1MB dan base64 (apalagi video)
            // gampang banget mepet/lewat batas itu.
            const folderPath = `${user.uid}/${currentChatId}`;
            const [gambarUserUrl, gambarAiUrl, videoAiUrl] = await Promise.all([
                uploadImageToSupabase(currentImage, folderPath),
                uploadImageToSupabase(data.image, folderPath),
                uploadImageToSupabase(data.video, folderPath)
            ]);

            await db.collection("riwayat_chat").add({
                uid: user.uid,
                chat_id: currentChatId,
                judul_chat: localStorage.getItem('currentChatTitle') || "Chat Baru",
                pesan: text, 
                gambarUrl: gambarUserUrl, 
                jawaban: data.reply,
                gambarAiUrl: gambarAiUrl,
                videoAiUrl: videoAiUrl,
                waktu: firebase.firestore.FieldValue.serverTimestamp()
            });
if (typeof window.tampilkanDaftarSidebar === "function") {
    window.tampilkanDaftarSidebar();
}
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

// Format teks AI di LUAR blok kode: hapus notasi LaTeX kasar, bold **teks**, inline `code`.
// PENTING: ini cuma dipanggil untuk bagian teks biasa, bukan isi blok kode -- soalnya
// strip backslash di sini bisa ngerusak kode (regex, path Windows, escape sequence, dll).
function formatPlainAiText(text) {
    let cleaned = text
        .replace(/\$/g, '')
        .replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '($1 / $2)')
        .replace(/\\times/g, 'x')
        .replace(/\\cdot/g, '.')
        .replace(/\\/g, '');
    let escaped = escapeHtml(cleaned);
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    return escaped;
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

// Satu blok teks biasa (bukan kode) -- pola list/soal yang sudah ada tetap dipertahankan.
function appendPlainTextBlock(fragment, text) {
    const isListOrSoal = /\d+\./.test(text) || text.includes('\n');
    const div = document.createElement('div');
    div.className = isListOrSoal ? 'msg-content list-mode' : 'msg-content';
    div.innerHTML = formatPlainAiText(text);
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

function appendMessage(role, text, imageSrc = null, videoSrc = null) {
    const chatBox = document.getElementById('chat-box');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;

    if (role === 'ai') {
        msgDiv.appendChild(renderAiTextContent(text));
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

    chatBox.appendChild(msgDiv);
    
    scrollToBottom(); 
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
    div.innerHTML = `<div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
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
    } else { window.location.href = "login.html"; }
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
                    item.onclick = () => { currentChatId = d.chat_id; localStorage.setItem('activeChatId', d.chat_id); muatRiwayatChat(); };
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
    document.getElementById('sidebar').classList.toggle('sidebar-visible');
    document.getElementById('sidebar').classList.toggle('sidebar-hidden');
};

window.mulaiChatBaru = function() {
    currentChatId = Date.now().toString(); 
    localStorage.setItem('activeChatId', currentChatId);
    localStorage.removeItem('currentChatTitle');
    
    chatBox.innerHTML = `
        <div id="welcome-screen" class="welcome-container">
            <img src="" alt="Logo" class="welcome-logo">
            <p>Selamat datang di Cyber AI!</p>
        </div>`;
    
    if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.add('sidebar-hidden');
    }
    
    console.log("Chat Baru Dimulai:", currentChatId);
};

if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (userInput) userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

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