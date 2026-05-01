/* cyber_37.js */
// 1. Deklarasi Variabel Global (Wajib Paling Atas)[cite: 13]
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

// 2. Firebase Config[cite: 13]
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

// 3. Logika Upload & Preview (Attention!)[cite: 13, 14]
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
                previewContainer.style.display = 'flex'; // Tanda gambar masuk[cite: 13]
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

// 4. Fungsi Kirim Pesan[cite: 13, 15]
async function sendMessage() {
    const text = userInput.value.trim();
    const user = firebase.auth().currentUser;
    const currentImage = pendingImage; 

    if (text === "" && !currentImage) return;

    // Loading State[cite: 14]
    const originalBtn = sendBtn.innerHTML;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    sendBtn.disabled = true;

    if (document.getElementById('welcome-screen')) document.getElementById('welcome-screen').remove();
    
    appendMessage('user', text, currentImage);
    cancelImage(); 
    userInput.value = "";

    try {
        // Kirim ke Backend[cite: 15]
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, image: currentImage }),
        });
        
        const data = await response.json();
        appendMessage('ai', data.reply);

        // Simpan ke Firestore[cite: 13]
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
            tampilkanDaftarSidebar();
        }
    } catch (err) {
        appendMessage('ai', "Server lagi korslet, Bosku!");
    } finally {
        sendBtn.innerHTML = originalBtn;
        sendBtn.disabled = false;
    }
}
/* Letakkan ini di bagian atas file cyber.js */
function scrollToBottom() {
    const chatBox = document.getElementById('chat-box');
    if (chatBox) {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

// 5. Fungsi UI & Sidebar (Tetap Utuh)[cite: 13]
function appendMessage(role, text, imageSrc = null) {
    const chatBox = document.getElementById('chat-box');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;

    // --- JURUS PEMBERSIH LATEX ---
    let cleanedText = text;
    if (role === 'ai') {
        cleanedText = cleanedText
            .replace(/\$/g, '') // Hapus semua simbol dollar ($)
            .replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '($1 / $2)') // Ubah pecahan \frac{a}{b} jadi (a / b)
            .replace(/\\times/g, 'x') // Ubah \times jadi x
            .replace(/\\cdot/g, '.') // Ubah \cdot jadi titik
            .replace(/\\/g, ''); // Hapus sisa backslash yang tertinggal
    }

    // Logika deteksi list agar tetap rapi
    const isListOrSoal = /\d+\./.test(cleanedText) || cleanedText.includes('\n');
    const contentClass = (role === 'ai' && isListOrSoal) ? "msg-content list-mode" : "msg-content";

    let contentHTML = imageSrc ? `<img src="${imageSrc}" style="max-width: 250px; display: block; border-radius: 8px; margin-bottom: 8px;">` : "";
    
    // Format Bold standar
    let formattedText = cleanedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    contentHTML += `<div class="${contentClass}">${formattedText}</div>`;
    
    msgDiv.innerHTML = contentHTML; 
    chatBox.appendChild(msgDiv);
    
    scrollToBottom(); 
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
        db.collection("riwayat_chat").where("uid", "==", user.uid).where("chat_id", "==", currentChatId).orderBy("waktu", "asc").get().then((snap) => {
            chatBox.innerHTML = "";
            snap.forEach((doc) => {
                const d = doc.data();
                appendMessage('user', d.pesan, d.gambarUrl);
                if(d.jawaban) appendMessage('ai', d.jawaban);
            });
        });
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

/* Tambahkan ini di cyber.js Bosku */

window.ubahNamaChat = function() {
    const namaBaru = prompt("Sobat Cyber mau ganti nama chat ini jadi apa?");
    
    if (namaBaru && namaBaru.trim() !== "") {
        const user = firebase.auth().currentUser;
        if (!user) {
            alert("Sobat Cyber harus login dulu ya!");
            return;
        }

        // Ambil chat_id aktif dari localStorage
        const activeChatId = localStorage.getItem('activeChatId');

        if (activeChatId) {
            // Update nama chat di Firebase
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
                    // Panggil fungsi buat refresh daftar di sidebar
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
/* Tambahkan ini di cyber_37.js */
window.mulaiChatBaru = function() {
    currentChatId = Date.now().toString(); // ID unik baru
    localStorage.setItem('activeChatId', currentChatId);
    localStorage.removeItem('currentChatTitle');
    
    // Bersihkan layar
    chatBox.innerHTML = `
        <div id="welcome-screen" class="welcome-container">
            <img src="center.png" alt="Logo" class="welcome-logo">
            <p>Selamat datang di Cyber AI!</p>
        </div>`;
    
    // Tutup sidebar jika di mobile
    if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.add('sidebar-hidden');
    }
    
    console.log("Chat Baru Dimulai:", currentChatId);
};
if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (userInput) userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });