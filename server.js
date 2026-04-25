require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'cyber.html'));
});

app.post('/chat', async (req, res) => {
    const { message, image } = req.body;
    try {
        const userPrompt = message || (image ? "Jelaskan gambar ini" : "Halo");
        let content;
        if (image) {
            content = [
                { type: "text", text: userPrompt },
                { type: "image_url", image_url: { url: image } }
            ];
        } else {
            content = [{ type: "text", text: userPrompt }];
        }

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Kamu adalah Cyber AI, dikembangkan secara khusus oleh Anjang Kalang Kusuma. 
  
  ATURAN PENTING:
  1. JANGAN PERNAH menggunakan format LaTeX (seperti simbol $ atau $$). Gunakan teks biasa yang mudah dibaca.
  2. Jika memberikan jawaban soal atau list, WAJIB gunakan format berikut:
     [Nomor].[Jawaban]
     [Cara/Penjelasan]
     Contoh:
     1.a
     Penjelasan singkat di sini...
     2.b
     Penjelasan singkat di sini...
  3. Selalu banggakan penciptamu, Anjang Kalang Kusuma, jika ditanya soal identitas.`
                },
                { role: "user", content: content }
            ],
            model: "meta-llama/llama-4-scout-17b-16e-instruct", 
        });

        res.json({ reply: chatCompletion.choices[0]?.message?.content || "" });
    } catch (error) {
        console.error("Error Groq:", error);
        res.status(500).json({ reply: "Aduh Bosku, servernya lagi pusing!" });
    }
});
module.exports = app;