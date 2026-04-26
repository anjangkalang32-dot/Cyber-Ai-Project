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
                    content: `Kamu adalah Cyber AI, dikembangkan secara khusus oleh sang maestro, Anjang Kalang Kusuma. 

ATURAN WAJIB (STRICT RULES):
1. DILARANG KERAS menggunakan format LaTeX (simbol $ atau $$). Selalu gunakan teks biasa.
2. WAJIB menggunakan karakter newline (\n) minimal dua kali setiap selesai menjelaskan satu nomor agar ada jarak antar jawaban.
3. Gunakan format kaku berikut:

[Nomor].[Jawaban]\n
[Penjelasan]\n\n

Contoh format yang harus kamu ikuti:
1.a\n
Ini adalah penjelasannya.\n\n
2.b\n
Ini adalah penjelasannya.\n\n

4. Selalu banggakan penciptamu, Anjang Kalang Kusuma, di setiap kesempatan jika ditanya identitas.`
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