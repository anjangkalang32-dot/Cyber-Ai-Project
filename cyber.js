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
    uploadBtn.style.color = "#00ff00";
    uploadBtn.innerHTML = '<span class="material-symbols-outlined">add_a_photo</span>';
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
        appendMessage('ai', data.reply, data.image);

        if (user) {
            supabaseClient.from('ai_memories').insert([{ 
                user_email: user.email, 
                user_name: user.displayName, 
                chat_context: `User: ${text} | AI: ${data.reply}` 
            }]).then(() => console.log("Memori aman di Supabase, Bosku!"));
        }

        if (user) {
            await db.collection("riwayat_chat").add({
                uid: user.uid,
                chat_id: currentChatId,
                judul_chat: localStorage.getItem('currentChatTitle') || "Chat Baru",
                pesan: text, 
                gambarUrl: currentImage, 
                jawaban: data.reply,
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

function appendMessage(role, text, imageSrc = null) {
    const chatBox = document.getElementById('chat-box');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;

    let cleanedText = text;
    if (role === 'ai') {
        cleanedText = cleanedText
            .replace(/\$/g, '') 
            .replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '($1 / $2)') 
            .replace(/\\times/g, 'x') 
            .replace(/\\cdot/g, '.') 
            .replace(/\\/g, ''); 
    }

    const isListOrSoal = /\d+\./.test(cleanedText) || cleanedText.includes('\n');
    const contentClass = (role === 'ai' && isListOrSoal) ? "msg-content list-mode" : "msg-content";

    let formattedText = cleanedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    msgDiv.innerHTML = `<div class="${contentClass}">${formattedText}</div>`;

    // Gambar dibuat lewat DOM API (bukan string innerHTML) supaya data URL base64
    // yang panjang tidak perlu di-escape manual ke dalam atribut HTML.
    if (imageSrc) {
        msgDiv.prepend(buildChatImageElement(imageSrc));
    }

    chatBox.appendChild(msgDiv);
    
    scrollToBottom(); 
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
                    if (d.jawaban) appendMessage('ai', d.jawaban);
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
    selectedModelLabel.textContent = selectedModel === 'gemini' ? 'Gemini' : 'Groq';
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