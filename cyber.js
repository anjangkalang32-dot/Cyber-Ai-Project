const sendBtn = document.getElementById('send-button');
const userInput = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');
const fileInput = document.getElementById('file-input'); 
const uploadBtn = document.getElementById('upload-btn'); 

let pendingImage = null;

uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            pendingImage = e.target.result;
            userInput.placeholder = "Gambar siap! Ketik prompt...";
            uploadBtn.style.color = "#adff2f"; 
        };
        reader.readAsDataURL(file);
    }
});

sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const text = userInput.value.trim();
    if (text === "" && !pendingImage) return;

    const currentText = text;
    const currentImage = pendingImage;

    const welcome = document.getElementById('welcome-screen');
    if (welcome) {
        welcome.remove();
        chatBox.style.justifyContent = "flex-start";
        chatBox.style.alignItems = "stretch"; 
    }

    appendMessage('user', currentText, currentImage);

    userInput.value = "";
    userInput.placeholder = "Tanya sesuatu...";
    pendingImage = null; 
    uploadBtn.style.color = "#00ff00"; 

    try {
const response = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        message: currentText, // Pakai variabel teks, bukan objek input
        image: currentImage 
    }),
});
        
        const data = await response.json();
        appendMessage('ai', data.reply);
    } catch (err) {
        console.error(err);
        appendMessage('ai', "Server lagi pusing nih Bosku, coba lagi nanti ya!");
    }
}

function appendMessage(role, text, imageSrc = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    
    let content = "";
    if (imageSrc) {
        content += `<img src="${imageSrc}" style="max-width: 200px; display: block; margin-bottom: 10px; border-radius: 8px;">`;
    }
    content += `<span>${text}</span>`;
    
    msgDiv.innerHTML = content;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}