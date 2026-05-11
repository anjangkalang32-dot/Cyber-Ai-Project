/* cyber_37.js - FULL EXTENDED VERSION */

// 1. Deklarasi Variabel Global (Wajib Paling Atas)
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

// 2. Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyBFJSDfU9tpbzt08SLWWKTH0jvk7EuamJE",
  authDomain: "cyber-ai-login.firebaseapp.com",
  projectId: "cyber-ai-login",
  storageBucket: "cyber-ai-login.firebasestorage.app",
  messagingSenderId: "264159618394",
  appId: "1:264159618394:web:fec6285d7b96b58b623f63"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// 3. Supabase Config (Disesuaikan dengan URL Bosku)
const SB_URL = 'https://oatgbiamflsvppykohvo.supabase.co/rest/v1/';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdGdiaWFtZmxzdnBweWtvaHZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTk5NjMsImV4cCI6MjA5MjkzNTk2M30.Nb8dPo6P_GOW6qfLn2PMC1YBJ7hevseGvGW2aGBNgGI'; // TEMPEL ANON KEY PANJANG DI SINI
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

// 4. Logika Utama (Kirim Pesan & Memori)
window.sendMessage = async () => {
    const message = userInput.value.trim();
    if (!message && !pendingImage) return;

    const user = firebase.auth().currentUser;
    let contextData = "";

    // TARIK MEMORI DARI SUPABASE
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
        } catch (err) {
            console.error("Gagal tarik memori:", err);
        }
    }

    appendMessage('user', message, pendingImage);
    userInput.value = '';
    const currentImage = pendingImage;
    cancelImage();

    // KIRIM KE SERVER VERCEL
    fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            message: message, 
            context: contextData, 
            image: currentImage 
        })
    })
    .then(res => res.json())
    .then(data => {
        appendMessage('ai', data.reply);
        
        // SIMPAN MEMORI BARU KE SUPABASE
        if (user) {
            supabaseClient.from('ai_memories').insert([{ 
                user_email: user.email, 
                user_name: user.displayName, 
                chat_context: `User: ${message} | AI: ${data.reply}` 
            }]).then(() => console.log("Memori Tersimpan!"));
        }
    })
    .catch(err => {
        console.error("Error:", err);
        appendMessage('ai', "Maaf Bosku, sistem lagi ada gangguan.");
    });
};

// 5. Fungsi UI & Sidebar (Versi Lengkap)
function appendMessage(sender, text, image = null) {
    const welcome = document.getElementById('welcome-screen');
    if (welcome) welcome.remove();

    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender === 'user' ? 'user-message' : 'ai-message');
    
    if (image) {
        const img = document.createElement('img');
        img.src = image;
        img.style.maxWidth = '200px';
        img.style.borderRadius = '10px';
        img.style.marginBottom = '5px';
        msgDiv.appendChild(img);
    }

    const textDiv = document.createElement('div');
    textDiv.innerText = text;
    msgDiv.appendChild(textDiv);
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// LOGIKA UPLOAD GAMBAR
uploadBtn.onclick = () => fileInput.click();
fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            pendingImage = event.target.result;
            previewImg.src = pendingImage;
            previewContainer.style.display = 'flex';
        };
        reader.readAsDataURL(file);
    }
};

window.cancelImage = () => {
    pendingImage = null;
    fileInput.value = '';
    previewContainer.style.display = 'none';
};

// LOGIKA SIDEBAR & CHAT BARU
window.toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('sidebar-visible');
    sidebar.classList.toggle('sidebar-hidden');
};

window.mulaiChatBaru = function() {
    currentChatId = Date.now().toString();
    localStorage.setItem('activeChatId', currentChatId);
    chatBox.innerHTML = `
        <div id="welcome-screen" class="welcome-container">
            <img src="center.png" alt="Logo" class="welcome-logo">
            <p>Selamat datang di Cyber AI!</p>
        </div>`;
    if (window.innerWidth < 768) toggleSidebar();
};

// Event Listeners
if (sendBtn) sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Jalankan saat load
console.log("Cyber AI Ready, Bosku! ID:", currentChatId);