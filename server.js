require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
app.use(express.static(__dirname));
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;

app.post('/chat', async (req, res) => {
    const { message, context, image } = req.body;

    try {
        const userPrompt = message || "Jelaskan gambar ini"; 
        
        // --- INI PROMPT ATURANNYA BOSKU ---
        const systemPrompt = `Kamu adalah Cyber AI Beta Edition, asisten cerdas buatan Anjang Kalang.
        
        ATURAN FORMAT WAJIB (DITURUTI ATAU ERROR):
        1. HARAM/DILARANG KERAS menggunakan simbol LaTeX seperti $...$ atau $$...$$. 
        2. Gunakan simbol keyboard standar: ^2 untuk kuadrat, / untuk bagi, * untuk kali.
        3. Gunakan minimal DUA KALI ENTER (\n\n) untuk setiap poin jawaban agar tidak berderet.
        4. Setiap langkah matematika WAJIB ditulis di baris baru.
        5. Gunakan format Markdown standar (**Bold**) untuk poin penting.
        
        GAYA BAHASA: Santai, gaul, panggil user "Sobat Cyber". 
        PENGETAHUAN KHUSUS: Tari Candik Ayu dari SURAKARTA, ciptaan Untung Mujiono.
        
        CONTOH FORMAT JAWABAN:
        1. **Jawaban A**
        
           Penjelasan: Langkah pertama adalah... (jarak antar baris harus jelas).
        
        Ada lagi yang bisa aku bantu, Sobat Cyber?
        
        PENTING: 
- Jika hanya menyapa atau ngobrol pendek, tulis dalam satu paragraf sambung.
- HANYA gunakan baris baru (Enter) jika kamu menjawab soal, memberikan langkah-langkah, atau membuat daftar. 
- Gunakan format angka (1., 2., 3.) untuk jawaban soal agar sistemku bisa mendeteksinya.`;
        const messagesForAI = [
            { role: "system", content: systemPrompt }
        ];

        if (context) {
            messagesForAI.push({ role: "user", content: `Memori Chat: ${context}` });
        }

        let userContent;
        if (image) {
            // Jalur Base64 untuk Vision[cite: 2]
            userContent = [
                { type: "text", text: userPrompt },
                { type: "image_url", image_url: { url: image } }
            ];
        } else {
            userContent = [{ type: "text", text: userPrompt }];
        }
        
        messagesForAI.push({ role: "user", content: userContent });

        const chatCompletion = await groq.chat.completions.create({
            messages: messagesForAI,
            model: "meta-llama/llama-4-scout-17b-16e-instruct", 
            temperature: 0.8,
        });

        const replyText = chatCompletion.choices[0]?.message?.content || "Duh Bosku, aku lagi ngelamun. Tanya lagi yuk!";
        res.json({ reply: replyText });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ reply: "Server Groq lagi capek, Bosku! Coba lagi ya." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Cyber AI King Edition ON di http://localhost:${PORT}`);
});