require('dotenv').config();
const dns = require('dns');
// Beberapa jaringan/ISP punya IPv6 yang bermasalah (connect timeout),
// sementara IPv4 lancar. Paksa Node prioritaskan IPv4 supaya request
// keluar (Hugging Face, dll) tidak hang.
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { HfInference } = require('@huggingface/inference');
const path = require('path');

const app = express();
app.use(express.static(__dirname));
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'cyber.html'));
});
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Inisialisasi kedua AI
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PORT = process.env.PORT || 3000;

// ===== RAG (Retrieval-Augmented Generation) PAKAI TAVILY =====
// Tavily didesain khusus buat dipakai LLM/RAG: hasilnya sudah bersih (content per hasil)
// dan bisa juga minta ringkasan jawaban langsung (include_answer).
// Setup: daftar gratis di https://tavily.com -> dashboard -> copy API key -> isi TAVILY_API_KEY di .env.
// Tier gratis: 1000 request/bulan.
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
// Matikan tanpa hapus API key: set ENABLE_WEB_SEARCH=false di .env.
const ENABLE_WEB_SEARCH = process.env.ENABLE_WEB_SEARCH !== 'false';

// System prompt yang sama untuk kedua model
const systemPrompt = `Kamu adalah Whale Shark, asisten cerdas buatan Anjang Kalang Kusuma.

ATURAN FORMAT WAJIB (DITURUTI ATAU ERROR):
1. HARAM/DILARANG KERAS menggunakan simbol LaTeX seperti $...$ atau $$...$$. 
2. Gunakan simbol keyboard standar: ^2 untuk kuadrat, / untuk bagi, * untuk kali.
3. Gunakan minimal SATU KALI ENTER (\n) untuk setiap poin jawaban agar tidak berderet.
4. Setiap langkah matematika WAJIB ditulis di baris baru.
5. Gunakan format Markdown standar (**Bold**) untuk poin penting.

GAYA BAHASA: Santai, gaul. 

ATURAN BACA FILE:
- Kalau ada blok "[ISI FILE TERLAMPIR: ...]" di pesan, itu adalah isi file (PDF/Word/Excel/CSV/teks) yang diupload user. Jawab berdasarkan isi file itu, jangan mengarang isi yang tidak ada di sana.
- Kalau ada catatan "gagal membaca file" dari sistem, bilang terus terang ke user bahwa filenya tidak bisa kamu baca, jangan berasumsi atau mengarang isinya.

ATURAN RISET WEB:
- Kalau ada blok "[HASIL RISET WEB ...]" di pesan, itu adalah data pencarian terbaru dari internet. WAJIB pakai itu sebagai sumber utama untuk hal-hal yang sifatnya baru/berubah-ubah (berita, harga, jadwal, data terkini, dll), jangan mengarang fakta yang berlawanan dengan itu.
- Kalau tidak ada blok riset web, atau hasilnya tidak relevan dengan pertanyaan, jawab pakai pengetahuanmu sendiri tapi bilang terus terang kalau kamu tidak punya data terbaru untuk hal yang sifatnya berubah-ubah.

CONTOH FORMAT JAWABAN:
1. **Jawaban A**

   Penjelasan: Langkah pertama adalah... (jarak antar baris harus jelas).

Ada lagi yang bisa aku bantu?

PENTING: 
- Jika hanya menyapa atau ngobrol pendek, tulis dalam satu paragraf sambung.
- HANYA gunakan baris baru (Enter) jika kamu menjawab soal, memberikan langkah-langkah, atau membuat daftar. 
- Gunakan format angka (1., 2., 3.) untuk jawaban soal agar sistemku bisa mendeteksinya.`;

// Fungsi untuk memanggil Groq
async function callGroq(message, context, image, modelName = "meta-llama/llama-4-scout-17b-16e-instruct", extraContext = "") {
    const messagesForAI = [
        { role: "system", content: systemPrompt }
    ];

    if (context) {
        messagesForAI.push({ role: "user", content: `Memori Chat: ${context}` });
    }

    if (extraContext) {
        messagesForAI.push({ role: "user", content: extraContext });
    }

    const isReasoningModel = modelName.includes('gpt-oss');

    // Reasoning model (gpt-oss) HANYA terima content berupa string.
    // Kalau dikasih array [{ type: 'text', ... }], Groq return content=null diam-diam.
    // Model biasa (llama, dll) bisa array (butuh untuk image).
    let userContent;
    if (image && !isReasoningModel) {
        userContent = [
            { type: "text", text: message || "Jelaskan gambar ini" },
            { type: "image_url", image_url: { url: image } }
        ];
    } else {
        // String biasa -- wajib untuk reasoning model, aman untuk semua model lain
        userContent = message || "Halo";
    }
    
    messagesForAI.push({ role: "user", content: userContent });
    const completionParams = {
        messages: messagesForAI,
        model: modelName,
    };
    if (isReasoningModel) {
        // PENTING: reasoning model Groq TIDAK boleh pakai temperature selain 1 (atau tidak diset).
        // Kalau temperature != 1 dikirim, API Groq mengembalikan content=null/kosong tanpa error.
        // Juga butuh max_completion_tokens yang cukup buat fase "berpikir" + jawaban final.
        completionParams.max_completion_tokens = 4096;
        completionParams.reasoning_effort = 'low';
        // temperature sengaja tidak diset (default 1) untuk reasoning model
    } else {
        completionParams.temperature = 0.8;
    }

    const chatCompletion = await groq.chat.completions.create(completionParams);

    const msg = chatCompletion.choices[0]?.message;
    // Reasoning model kadang taruh jawaban di content, kadang di reasoning_content kalau content kosong.
    const content = msg?.content || msg?.reasoning_content || "";
    if (!content) {
        console.warn('\u26a0\ufe0f [callGroq] Jawaban kosong dari model, full message:', JSON.stringify(msg));
    }
    return content || "Duh Bosku, aku lagi ngelamun. Tanya lagi yuk!";
}

// Fungsi untuk memanggil Gemini
async function callGemini(message, context, image, extraContext = "") {
    let model;
    let result;
    // Use API model identifier (no spaces). Change here if your project uses another Gemini model id.
    const geminiModelName = "gemini-3.5-flash";

    if (image) {
        // Pake model vision untuk gambar
        model = genAI.getGenerativeModel({ model: geminiModelName });
        
        const base64Image = image.split(',')[1] || image;
        const mimeType = image.match(/data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
        
        result = await model.generateContent([
            { text: systemPrompt + "\n\n" + (message || "Jelaskan gambar ini") },
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            }
        ]);
    } else {
        // Pake model teks dengan versi Gemini yang biasanya lebih tersedia di API
        model = genAI.getGenerativeModel({ model: geminiModelName });
        
        // Buat history chat
        let fullPrompt = systemPrompt + "\n\n";
        if (context) {
            fullPrompt += `[MEMORI SEBELUMNYA: ${context}]\n\n`;
        }
        if (extraContext) {
            fullPrompt += extraContext + "\n\n";
        }
        fullPrompt += message || "Halo";
        
        result = await model.generateContent(fullPrompt);
    }

    return result.response.text();
}

// ===== VERSI STREAMING (buat efek ngetik real-time kayak Gemini/ChatGPT) =====
// Bedanya sama callGroq/callGemini biasa: di sini kita gak nunggu jawaban full kelar,
// tapi manggil onChunk(potongan_teks) tiap ada potongan baru yang nyampe dari API.
// Tetep return teks lengkapnya juga di akhir, buat disimpen ke memori/riwayat.

async function callGroqStream(message, context, image, modelName = "meta-llama/llama-4-scout-17b-16e-instruct", extraContext = "", onChunk = () => {}) {
    const messagesForAI = [
        { role: "system", content: systemPrompt }
    ];

    if (context) {
        messagesForAI.push({ role: "user", content: `Memori Chat: ${context}` });
    }

    if (extraContext) {
        messagesForAI.push({ role: "user", content: extraContext });
    }

    const isReasoningModel = modelName.includes('gpt-oss');

    // Reasoning model tidak support content array -- kasih string biasa
    let userContent;
    if (image && !isReasoningModel) {
        userContent = [
            { type: "text", text: message || "Jelaskan gambar ini" },
            { type: "image_url", image_url: { url: image } }
        ];
    } else {
        userContent = message || "Halo";
    }

    messagesForAI.push({ role: "user", content: userContent });

    // Model GPT-OSS (openai/gpt-oss-*) adalah "reasoning model": dia mikir (chain-of-thought)
    // dulu sebelum nulis jawaban final, dan proses mikir itu makan token sendiri.
    // Kalau nggak dikasih jatah token yang cukup, bisa kejadian token habis pas masih
    // di fase "mikir" -> delta.content kosong dari awal sampai akhir walau stream-nya sukses
    // (nggak ada error sama sekali, cuma jawabannya nggak pernah sempet ditulis).
    const streamParams = {
        messages: messagesForAI,
        model: modelName,
        stream: true,
    };
    if (isReasoningModel) {
        // PENTING: reasoning model Groq tidak boleh pakai temperature != 1
        streamParams.max_completion_tokens = 4096;
        streamParams.reasoning_effort = 'low';
        // temperature tidak diset (default 1)
    } else {
        streamParams.temperature = 0.8;
    }

    const stream = await groq.chat.completions.create(streamParams);

    let fullText = "";
    let chunkIndex = 0;
    for await (const chunk of stream) {
        // Log struktur chunk PERTAMA aja (biar nggak spam console) -- kalau suatu saat
        // delta.content ternyata selalu kosong, log ini bakal nunjukin field mana yang
        // sebenarnya dipakai sama provider/model ini buat nyimpen teksnya.
        if (chunkIndex === 0) {
            console.log('🔍 [Groq stream] contoh chunk pertama:', JSON.stringify(chunk));
        }
        chunkIndex++;

        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
            fullText += delta;
            onChunk(delta);
        }
    }

    console.log(`✅ [Groq stream] loop selesai. Total chunk: ${chunkIndex}, panjang jawaban: ${fullText.length} karakter`);

    if (!fullText) {
        console.log(`⚠️ [Groq stream] ${chunkIndex} chunk diterima tapi semua delta.content kosong (model=${modelName})`);
    }

    return fullText || "Duh Bosku, aku lagi ngelamun. Tanya lagi yuk!";
}

async function callGeminiStream(message, context, image, extraContext = "", onChunk = () => {}) {
    const geminiModelName = "gemini-3.5-flash";
    const model = genAI.getGenerativeModel({ model: geminiModelName });

    let streamResult;
    if (image) {
        const base64Image = image.split(',')[1] || image;
        const mimeType = image.match(/data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';

        streamResult = await model.generateContentStream([
            { text: systemPrompt + "\n\n" + (message || "Jelaskan gambar ini") },
            { inlineData: { data: base64Image, mimeType: mimeType } }
        ]);
    } else {
        let fullPrompt = systemPrompt + "\n\n";
        if (context) {
            fullPrompt += `[MEMORI SEBELUMNYA: ${context}]\n\n`;
        }
        if (extraContext) {
            fullPrompt += extraContext + "\n\n";
        }
        fullPrompt += message || "Halo";

        streamResult = await model.generateContentStream(fullPrompt);
    }

    let fullText = "";
    let chunkIndex = 0;
    for await (const chunk of streamResult.stream) {
        if (chunkIndex === 0) {
            try { console.log('🔍 [Gemini stream] contoh chunk pertama:', JSON.stringify(chunk)); } catch (e) { /* ignore */ }
        }
        chunkIndex++;

        const chunkText = typeof chunk.text === "function" ? chunk.text() : "";
        if (chunkText) {
            fullText += chunkText;
            onChunk(chunkText);
        }
    }

    console.log(`✅ [Gemini stream] loop selesai. Total chunk: ${chunkIndex}, panjang jawaban: ${fullText.length} karakter`);

    if (!fullText) {
        console.log(`⚠️ [Gemini stream] ${chunkIndex} chunk diterima tapi semua chunk.text() kosong`);
    }

    return fullText || "Duh Bosku, aku lagi ngelamun. Tanya lagi yuk!";
}

async function callGeminiImageFromText(prompt, context) {
    const geminiImageModelName = process.env.GEMINI_IMAGE_MODEL || "gemini-3.5-flash-image";
    const geminiImageFallbacks = [geminiImageModelName, "gemini-3.1-flash-image"].filter(Boolean);

    let fullPrompt = prompt || "Buat gambar dengan deskripsi detail.";
    if (context) {
        fullPrompt = `Memori Chat:\n${context}\n\n${fullPrompt}`;
    }

    for (const modelName of geminiImageFallbacks) {
        try {
            console.log('🖼️ Menggunakan Gemini image model:', modelName);
            const imageModel = genAI.getGenerativeModel({ model: modelName });
            const result = await imageModel.generateContent(fullPrompt);

            console.log("🖼️ [GeminiImage] extraction start", {
                modelName,
                hasResponse: Boolean(result?.response),
                hasCandidates: Boolean(result?.response?.candidates || result?.candidates),
                resultType: typeof result
            });

            const maybeTextFn = result?.response?.text;
            const maybeText = typeof maybeTextFn === "function" ? maybeTextFn.call(result.response) : null;
            if (typeof maybeText === "string" && maybeText.startsWith("data:image/")) {
                return maybeText;
            }

            const candidates = result?.response?.candidates || result?.candidates;
            const parts = candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
                for (const p of parts) {
                    if (!p) continue;
                    if (typeof p === "string" && p.startsWith("data:image/")) return p;
                    const inlineData = p?.inlineData;
                    if (inlineData?.data) {
                        const mimeType = inlineData.mimeType || "image/png";
                        const b64 = inlineData.data;
                        if (b64.startsWith("data:image/")) return b64;
                        return `data:${mimeType};base64,${b64}`;
                    }
                    const dataMaybe = p?.data;
                    const mimeMaybe = p?.mimeType || p?.contentType;
                    if (typeof dataMaybe === "string" && dataMaybe.length > 50) {
                        if (dataMaybe.startsWith("data:image/")) return dataMaybe;
                        if (mimeMaybe && String(mimeMaybe).startsWith("image/")) {
                            return `data:${mimeMaybe};base64,${dataMaybe}`;
                        }
                    }
                }
            }

            const json = JSON.stringify(result);
            if (json.includes("data:image/")) {
                throw new Error("Response contains data:image/ marker but extraction failed. Check server logs.");
            }

            throw new Error(`Gemini image model ${modelName} returned no image data.`);
        } catch (e) {
            console.warn(`Gemini image model ${modelName} failed:`, e?.message || e);
            if (String(e?.message || "").toLowerCase().includes("quota")) {
                console.warn(`Gemini image model ${modelName} quota error detected, trying next fallback if available.`);
                continue;
            }
            if (String(e?.message || "").toLowerCase().includes("not available") || String(e?.message || "").toLowerCase().includes("not found")) {
                continue;
            }
            if (modelName === geminiImageFallbacks[geminiImageFallbacks.length - 1]) {
                throw e;
            }
        }
    }

    throw new Error("Semua model Gemini image gagal. Periksa quota atau model di GEMINI_IMAGE_MODEL.");

    // Best-effort extraction
    // 1) If SDK returns text containing base64 data url
    const maybeTextFn = result?.response?.text;
    const maybeText = typeof maybeTextFn === "function" ? maybeTextFn.call(result.response) : null;
    if (typeof maybeText === "string" && maybeText.startsWith("data:image/")) {
        return maybeText;
    }

    // 2) Try to extract image parts from candidates
    const candidates = result?.response?.candidates || result?.candidates;
    const parts = candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
        for (const p of parts) {
            if (!p) continue;

            // direct data url
            if (typeof p === "string" && p.startsWith("data:image/")) return p;

            // inlineData: { data, mimeType }
            const inlineData = p?.inlineData;
            if (inlineData?.data) {
                const mimeType = inlineData.mimeType || "image/png";
                const b64 = inlineData.data;
                if (b64.startsWith("data:image/")) return b64;
                return `data:${mimeType};base64,${b64}`;
            }

            // alternative keys
            const dataMaybe = p?.data;
            const mimeMaybe = p?.mimeType || p?.contentType;
            if (typeof dataMaybe === "string" && dataMaybe.length > 50) {
                if (dataMaybe.startsWith("data:image/")) return dataMaybe;
                if (mimeMaybe && String(mimeMaybe).startsWith("image/")) {
                    return `data:${mimeMaybe};base64,${dataMaybe}`;
                }
            }
        }
    }

    // Last resort: check if response contains marker
    try {
        const s = JSON.stringify(result);
        if (s.includes("data:image/")) {
            throw new Error("Response contains data:image/ marker, but extraction couldn't isolate base64. Check server logs for exact structure.");
        }
    } catch (e) {
        // ignore stringify failures
    }

    throw new Error("Gemini image generation succeeded but image extraction failed (unknown response shape). Check server logs.");
}

async function callHuggingFaceImage(prompt) {
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    if (!hfKey) return null;

    const hfModel = process.env.HF_IMAGE_MODEL || "Tongyi-MAI/Z-Image-Turbo";
    // PENTING: tiap model di HF cuma dilayani provider tertentu (cek halaman model > "Inference Providers").
    // Tongyi-MAI/Z-Image-Turbo saat ini cuma dilayani provider "fal-ai".
    // Setiap provider eksternal (fal-ai, replicate, dll) punya skema request sendiri-sendiri yang
    // BERBEDA dari format generik {"inputs": prompt} milik hf-inference, jadi kita tidak bisa
    // menebak URL/payload-nya secara manual lewat fetch(). Karena itu kita pakai library resmi
    // @huggingface/inference, yang sudah tau cara merutekan & format payload yang benar per-provider.
    const hfProvider = process.env.HF_IMAGE_PROVIDER || "fal-ai";

    try {
        console.log(`📡 HuggingFace request: model="${hfModel}", provider="${hfProvider}"`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 detik timeout

        const hf = new HfInference(hfKey);
        const blob = await hf.textToImage({
            model: hfModel,
            inputs: prompt,
            provider: hfProvider,
        }, { signal: controller.signal });

        clearTimeout(timeoutId);

        const buffer = Buffer.from(await blob.arrayBuffer());
        const mimeType = blob.type || "image/png";
        const b64 = buffer.toString("base64");
        return { image: `data:${mimeType};base64,${b64}`, provider: "huggingface" };
    } catch (e) {
        const errorMsg = e?.name === 'AbortError' ? 'Request timeout (30s)' : (e?.message || String(e));
        console.warn("HuggingFace image generation error:", errorMsg, "| errorName:", e?.name);
        if (e?.cause) console.warn("  Cause:", e.cause);
        return null;
    }
}

async function callHuggingFaceVideo(prompt) {
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    if (!hfKey) return null;

    // Wan-AI/Wan2.2-TI2V-5B dipilih karena ini contoh RESMI dari dokumentasi provider fal-ai
    // khusus untuk task text-to-video (beda dengan LTX-Video yang di fal-ai cuma didaftarkan
    // untuk image-to-video, walau namanya kedengaran umum).
    const hfModel = process.env.HF_VIDEO_MODEL || "Wan-AI/Wan2.2-TI2V-5B";
    const hfProvider = process.env.HF_VIDEO_PROVIDER || "fal-ai";

    try {
        console.log(`📡 HuggingFace video request: model="${hfModel}", provider="${hfProvider}"`);
        const controller = new AbortController();
        // Video butuh waktu jauh lebih lama dari gambar, jadi timeout-nya dikasih lega (280 detik).
        // CATATAN: kalau di-deploy ke Vercel dengan vercel.json versi "builds" yang sekarang,
        // Vercel sendiri yang akan motong duluan sebelum 280 detik ini sempat tercapai
        // (Vercel "builds" config tidak bisa diatur maxDuration-nya). Lokal (node server.js)
        // tidak kena batas ini sama sekali.
        const timeoutId = setTimeout(() => controller.abort(), 280000);

        const hf = new HfInference(hfKey);
        const blob = await hf.textToVideo({
            model: hfModel,
            inputs: prompt,
            provider: hfProvider,
        }, { signal: controller.signal });

        clearTimeout(timeoutId);

        const buffer = Buffer.from(await blob.arrayBuffer());
        const mimeType = blob.type || "video/mp4";
        const b64 = buffer.toString("base64");
        return { video: `data:${mimeType};base64,${b64}`, provider: "huggingface" };
    } catch (e) {
        const errorMsg = e?.name === 'AbortError' ? 'Request timeout (280s)' : (e?.message || String(e));
        console.warn("HuggingFace video generation error:", errorMsg, "| errorName:", e?.name);
        if (e?.cause) console.warn("  Cause:", e.cause);
        return null;
    }
}

async function callReplicateImage(prompt) {
    const repToken = process.env.REPLICATE_API_TOKEN;
    const repVersion = process.env.REPLICATE_MODEL_VERSION;
    if (!repToken || !repVersion) return null;

    try {
        const createResp = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
                Authorization: `Token ${repToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ version: repVersion, input: { prompt } })
        });

        const createJson = await createResp.json();
        if (!createResp.ok) {
            console.warn('Replicate create prediction failed:', createJson);
            return null;
        }

        let status = createJson.status;
        let prediction = createJson;
        const baseUrl = 'https://api.replicate.com';

        while (status === 'starting' || status === 'processing') {
            await new Promise(resolve => setTimeout(resolve, 1500));
            const pollResp = await fetch(`${baseUrl}/v1/predictions/${createJson.id}`, {
                headers: { Authorization: `Token ${repToken}` }
            });
            prediction = await pollResp.json();
            status = prediction.status;
            if (!pollResp.ok) {
                console.warn('Replicate polling failed:', status, prediction);
                return null;
            }
        }

        if (prediction.status === 'succeeded' && prediction.output) {
            const outUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
            if (!outUrl) return null;
            const imgResp = await fetch(outUrl);
            if (!imgResp.ok) {
                console.warn('Replicate image download failed:', imgResp.status, imgResp.statusText);
                return null;
            }
            const buffer = await imgResp.arrayBuffer();
            const b64 = Buffer.from(buffer).toString('base64');
            return { image: `data:image/png;base64,${b64}`, provider: 'replicate' };
        }

        console.warn('Replicate prediction failed or returned no image:', prediction);
        return null;
    } catch (e) {
        console.warn('Replicate image generation error:', e?.message || e);
        return null;
    }
}

async function callExternalImageProvider(prompt) {
    const fallbackProviders = [callHuggingFaceImage, callReplicateImage];

    for (const providerFn of fallbackProviders) {
        const result = await providerFn(prompt);
        if (result && result.image) {
            return result;
        }
    }

    return null;
}

// Call a local Automatic1111 / Stable Diffusion WebUI instance (phone or LAN)

function isGeminiQuotaError(error) {
    const message = String(error?.message || '').toLowerCase();
    // Treat rate-limit, quota, and temporary service unavailability as recoverable/fallback-worthy
    return message.includes('quota exceeded') || message.includes('too many requests') || message.includes('free_tier') || message.includes('service unavailable') || message.includes('high demand') || message.includes('503');
}

/**
 * Detect if a user text likely requests image generation.
 * Tujuan: lebih fleksibel supaya prompt seperti "gambar kucing..." langsung memicu jalur image.
 */
function isImageIntent(text) {
    if (!text) return false;
    const t = String(text).toLowerCase().trim();

    // Hindari false-positive untuk kata "gambar" di konteks selain perintah gambar
    // (tetap cukup longgar, tapi tidak terlalu agresif).
    const negativeKeywords = [
        'gambarnya', // biasanya masih bisa, tapi biar lebih aman
        'gambarku', 'gambarkah'
    ];

    if (negativeKeywords.some(k => t.includes(k))) {
        // Kalau ada frasa perintah gambar, tetap dianggap intent.
        const positiveOverride = [
            'buat gambar', 'buat ilustrasi', 'generate image', 'create image', 'buat poster',
            'buat logo', 'draw', 'paint', 'sketsa', 'ilustrasi', 'gambarkan', 'render', 'buat foto', 'synthesize image', 'tolong'
        ];
        if (!positiveOverride.some(k => t.includes(k))) return false;
    }

    const patterns = [
        // Frasa perintah gambar (Indonesia/English)
        /buat\s+gambar/g,
        /buat\s+(ilustrasi|poster|logo)/g,
        /(generate|create)\s+image/g,
        /generate\s+(a\s+)?picture/g,

        // Kata kunci gambar
        /\bgambar\b/g,
        /\bilustrasi\b/g,
        /\bposter\b/g,
        /\blogo\b/g,
        /\bdraw\b/g,
        /\bpaint\b/g,
        /\bsketsa\b/g,
        /\brender\b/g,
        /\bgambarkan\b/g,
        /\bbuat\s+foto\b/g,
        /\bsynthesize\s+image\b/g,

        // Pola permintaan: "tolong ... gambar" / "bikin ... logo" / "buatkan ..."
        /(tolong|bikin|buatkan)\s+.*\b(gambar|ilustrasi|poster|logo|foto)\b/g,
    ];

    return patterns.some(re => re.test(t));
}

/**
 * Detect if a user text likely requests video generation.
 */
function isVideoIntent(text) {
    if (!text) return false;
    const t = String(text).toLowerCase().trim();

    const patterns = [
        /buat\s+video/g,
        /buatkan\s+video/g,
        /bikin\s+video/g,
        /(generate|create)\s+video/g,
        /\bvideo\b/g,
        /\banimasikan\b/g,
        /\banimasi\b/g,
        /(tolong|bikin|buatkan)\s+.*\bvideo\b/g,
    ];

    return patterns.some(re => re.test(t));
}

// ===== RAG: RISET WEB PAKAI TAVILY =====

/**
 * Panggil Tavily Search API. Balikin { answer, results: [{title, url, content}] } atau null kalau gagal.
 */
async function tavilySearch(query, maxResults = 5) {
    if (!TAVILY_API_KEY) {
        console.warn('⚠️ TAVILY_API_KEY belum diatur di .env, skip riset web.');
        return null;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 detik, jangan sampai bikin chat lama nunggu

        const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: TAVILY_API_KEY,
                query: query,
                search_depth: 'basic',
                include_answer: true,
                max_results: maxResults,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!resp.ok) {
            const errBody = await resp.text();
            console.warn('❌ Tavily API error:', resp.status, errBody.slice(0, 300));
            return null;
        }

        const json = await resp.json();
        const results = (json.results || []).map(r => ({
            title: r.title,
            url: r.url,
            content: r.content,
        }));

        return { answer: json.answer || null, results };
    } catch (e) {
        const msg = e?.name === 'AbortError' ? 'Tavily timeout (10s)' : (e?.message || String(e));
        console.warn('❌ Gagal riset web (Tavily):', msg);
        return null;
    }
}

// Ubah hasil Tavily jadi blok teks tambahan buat disuntik ke prompt AI.
function formatTavilyForPrompt(query, tavilyData) {
    if (!tavilyData || (!tavilyData.answer && (!tavilyData.results || tavilyData.results.length === 0))) {
        return '';
    }

    let formatted = `\n\n[HASIL RISET WEB untuk "${query}" - dari Tavily, WAJIB dipakai sebagai acuan utama untuk hal yang sifatnya baru/berubah-ubah, jangan ngarang]\n`;

    if (tavilyData.answer) {
        formatted += `Ringkasan: ${tavilyData.answer}\n\n`;
    }

    (tavilyData.results || []).forEach((r, i) => {
        formatted += `${i + 1}. ${r.title}\n   ${r.content}\n   Sumber: ${r.url}\n`;
    });

    formatted += '\nKalau hasil di atas memang relevan, dasarkan jawabanmu dari situ. Kalau tidak relevan/tidak cukup, bilang terang-terangan ke user kalau itu di luar hasil riset, jangan mengarang.';
    return formatted;
}

/**
 * Tentukan apakah pesan user butuh riset web dulu sebelum dijawab.
 * Sapaan/obrolan kasual di-skip biar nggak buang kuota gratis (1000 request/bulan di Tavily).
 */
function needsResearch(text) {
    if (!text) return false;
    const t = String(text).toLowerCase().trim();

    if (t.length < 3) return false;

    const casualPatterns = [
        /^(hai|halo|hello|hi+|hey|woi|pagi|siang|sore|malam)\b/,
        /^(apa kabar|gimana kabar)/,
        /^(makasih|terima kasih|thanks|thx|sip|mantap)\b/,
        /^(oke|ok|baik|y|ya|iya)$/,
        /^(siapa( kamu| anda)?( sih)?\??)$/,
        /^(kamu siapa\??)$/,
        /^(test|tes|ping)$/,
    ];

    return !casualPatterns.some(re => re.test(t));
}

// ===== BACA ISI FILE (PDF, Word, Excel/CSV, teks/kode, dll) =====
// Butuh 3 library tambahan: pdf-parse (PDF), mammoth (.docx), xlsx (.xlsx/.xls).
// Kalau belum di-install, fitur untuk format itu otomatis nonaktif (server tetap jalan,
// cuma kasih warning di log) -- jalankan ini dulu di folder project:
//   npm install pdf-parse mammoth xlsx
async function extractTextFromDocument(file) {
    if (!file || !file.data) return null;

    const filename = file.filename || 'file';
    const ext = filename.toLowerCase().split('.').pop();
    const mime = String(file.mimeType || '').toLowerCase();

    try {
        const base64 = String(file.data).includes(',') ? file.data.split(',')[1] : file.data;
        const buffer = Buffer.from(base64, 'base64');

        // ---- PDF ----
        if (mime === 'application/pdf' || ext === 'pdf') {
            try {
                const pdfParse = require('pdf-parse');
                const result = await pdfParse(buffer);
                return result.text;
            } catch (e) {
                console.warn('⚠️ Gagal baca PDF. Pastikan sudah jalankan "npm install pdf-parse". Detail:', e.message);
                return null;
            }
        }

        // ---- DOCX (Word baru) ----
        if (mime.includes('wordprocessingml') || ext === 'docx') {
            try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ buffer });
                return result.value;
            } catch (e) {
                console.warn('⚠️ Gagal baca DOCX. Pastikan sudah jalankan "npm install mammoth". Detail:', e.message);
                return null;
            }
        }

        // ---- DOC (Word lama, format binary lawas, belum didukung) ----
        if (ext === 'doc') {
            console.warn('⚠️ Format .doc (Word lama) belum didukung. User perlu convert ke .docx atau .pdf.');
            return null;
        }

        // ---- XLSX / XLS (Excel) -> di-extract per-sheet jadi teks CSV ----
        if (mime.includes('spreadsheet') || ext === 'xlsx' || ext === 'xls') {
            try {
                const XLSX = require('xlsx');
                const workbook = XLSX.read(buffer, { type: 'buffer' });
                let out = '';
                workbook.SheetNames.forEach((sheetName) => {
                    out += `--- Sheet: ${sheetName} ---\n`;
                    out += XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]) + '\n\n';
                });
                return out;
            } catch (e) {
                console.warn('⚠️ Gagal baca Excel. Pastikan sudah jalankan "npm install xlsx". Detail:', e.message);
                return null;
            }
        }

        // ---- Default: anggap teks biasa (txt, csv, json, md, kode .js/.py/.html, dll) ----
        return buffer.toString('utf8');
    } catch (e) {
        console.warn('❌ Gagal proses file', filename, ':', e?.message || e);
        return null;
    }
}

// Potong isi file kalau kepanjangan, biar prompt ke AI nggak meledak ukurannya.
function truncateText(text, maxChars = 15000) {
    if (!text) return text;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + `\n\n...[isi file dipotong, total ${text.length} karakter, cuma ${maxChars} karakter pertama yang dikirim ke AI]`;
}

// Bungkus isi file jadi blok teks yang disisipkan ke prompt AI.
function formatDocumentForPrompt(filename, text) {
    return `\n\n[ISI FILE TERLAMPIR: "${filename}"]\n${text}\n[AKHIR ISI FILE]\nJawab pertanyaan user berdasarkan isi file di atas kalau relevan.`;
}

// Endpoint untuk test koneksi text-to-video ke Hugging Face
app.get('/test-hf-video', async (req, res) => {
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    const hfModel = process.env.HF_VIDEO_MODEL || "Wan-AI/Wan2.2-TI2V-5B";
    const hfProvider = process.env.HF_VIDEO_PROVIDER || "fal-ai";

    if (!hfKey) {
        return res.json({ ok: false, error: "HUGGINGFACE_API_KEY tidak ditemukan di .env", apiKeyPresent: false, model: hfModel, provider: hfProvider });
    }

    try {
        console.log(`🧪 Testing HF text-to-video: model="${hfModel}", provider="${hfProvider}"`);
        const result = await callHuggingFaceVideo("a cat walking on green grass, short clip");
        if (result && result.video) {
            return res.json({ ok: true, apiKeyPresent: true, model: hfModel, provider: hfProvider, videoPreviewLength: result.video.length });
        }
        res.json({ ok: false, error: "Tidak ada video yang dihasilkan, cek log server untuk detail error.", apiKeyPresent: true, model: hfModel, provider: hfProvider });
    } catch (e) {
        res.json({
            ok: false,
            error: e?.message || String(e),
            errorName: e?.name,
            apiKeyPresent: true,
            model: hfModel,
            provider: hfProvider
        });
    }
});

// Endpoint untuk test koneksi ke Hugging Face
app.get('/test-hf', async (req, res) => {
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    const hfModel = process.env.HF_IMAGE_MODEL || "Tongyi-MAI/Z-Image-Turbo";
    const hfProvider = process.env.HF_IMAGE_PROVIDER || "fal-ai";

    if (!hfKey) {
        return res.json({ ok: false, error: "HUGGINGFACE_API_KEY tidak ditemukan di .env", apiKeyPresent: false, model: hfModel, provider: hfProvider });
    }

    try {
        console.log(`🧪 Testing HF text-to-image: model="${hfModel}", provider="${hfProvider}"`);
        const result = await callHuggingFaceImage("a simple red apple on white background");
        if (result && result.image) {
            return res.json({ ok: true, apiKeyPresent: true, model: hfModel, provider: hfProvider, imagePreviewLength: result.image.length });
        }
        res.json({ ok: false, error: "Tidak ada gambar yang dihasilkan, cek log server untuk detail error.", apiKeyPresent: true, model: hfModel, provider: hfProvider });
    } catch (e) {
        res.json({
            ok: false,
            error: e?.message || String(e),
            errorName: e?.name,
            apiKeyPresent: true,
            model: hfModel,
            provider: hfProvider
        });
    }
});

// Endpoint utama dengan pemilihan model
app.post('/chat', async (req, res) => {
    const { message, context, image, model, file } = req.body; // model bisa 'groq'/'gpt-oss'/'gemini', file = dokumen non-gambar (opsional)
    
    // Default ke groq jika tidak ditentukan
    let selectedModel = model || 'groq';

    try {
        // Video dicek lebih dulu & cuma dari teks (belum dukung image-to-video).
        const wantsVideo = !image && isVideoIntent(message);
        if (wantsVideo) {
            console.log('🎬 Video generation path triggered');

            if (!process.env.HUGGINGFACE_API_KEY) {
                console.warn('❌ HUGGINGFACE_API_KEY tidak ditemukan');
                return res.json({
                    reply: 'Maaf, pembuatan video hanya didukung lewat Hugging Face. Silakan atur HUGGINGFACE_API_KEY di .env.',
                    modelUsed: 'huggingface-video-unavailable'
                });
            }

            console.log('🟡 Mencoba Hugging Face video provider', process.env.HF_VIDEO_MODEL || 'Wan-AI/Wan2.2-TI2V-5B');
            const hfVideoResult = await callHuggingFaceVideo(message || '');
            if (hfVideoResult && hfVideoResult.video) {
                console.log('✅ Hugging Face video generated successfully');
                return res.json({ reply: 'Video selesai dibuat.', video: hfVideoResult.video, modelUsed: 'huggingface-video' });
            }

            console.warn('❌ Hugging Face video provider returned null/empty');
            return res.json({
                reply: 'Maaf, pembuatan video gagal. Bisa jadi prosesnya kelamaan (timeout), kuota/saldo provider habis, atau konfigurasi HF_VIDEO_MODEL/HF_VIDEO_PROVIDER salah. Cek log server untuk detail.',
                modelUsed: 'huggingface-video-error'
            });
        }

        // PENTING: ini dua hal yang BEDA dan harus dipisah total:
        // 1) wantsImageAnalysis -> user UPLOAD gambar, minta dijelaskan/dianalisa (vision).
        // 2) wantsImageGeneration -> user TIDAK upload gambar, minta dibuatkan gambar baru dari teks.
        // Kalau digabung jadi satu flag, begitu vision gagal kode malah lanjut nganggep
        // pertanyaan user sebagai prompt generate gambar baru (bug lama).
        const wantsImageAnalysis = Boolean(image);
        const wantsImageGeneration = !image && isImageIntent(message);
        console.log(`📨 Chat request: model=${selectedModel}, hasImage=${Boolean(image)}, hasFile=${Boolean(file)}, isImageIntent=${isImageIntent(message)}, wantsImageAnalysis=${wantsImageAnalysis}, wantsImageGeneration=${wantsImageGeneration}, message="${message?.slice(0, 50)}..."`);

        if (wantsImageAnalysis) {
            console.log(`👁️ Image analysis (vision) path triggered, model dipilih: ${selectedModel}`);
            try {
                let visionReply;
                if (selectedModel === 'gemini') {
                    visionReply = await callGemini(message, context, image);
                    return res.json({ reply: visionReply, modelUsed: 'gemini-vision' });
                } else {
                    // Groq & GPT-OSS sama-sama dilewatkan ke Llama 4 Scout di Groq,
                    // karena itu yang vision-capable (gpt-oss-120b di Groq teks-only).
                    visionReply = await callGroq(message, context, image, 'meta-llama/llama-4-scout-17b-16e-instruct');
                    return res.json({ reply: visionReply, modelUsed: 'groq-vision' });
                }
            } catch (visionError) {
                console.error('❌ Gagal menganalisa gambar:', visionError.message);
                return res.json({
                    reply: `Maaf Bosku, gagal menganalisa gambarnya. (Error: ${visionError.message})`,
                    modelUsed: 'vision-error'
                });
            }
        }

        if (wantsImageGeneration) {
            console.log('🎨 Image generation path triggered');

            if (!process.env.HUGGINGFACE_API_KEY) {
                console.warn('❌ HUGGINGFACE_API_KEY tidak ditemukan');
                return res.json({
                    reply: 'Maaf, pembuatan gambar hanya didukung lewat Hugging Face. Silakan atur HUGGINGFACE_API_KEY di .env.',
                    modelUsed: 'huggingface-image-unavailable'
                });
            }

            console.log('🟡 Mencoba Hugging Face image provider', process.env.HF_IMAGE_MODEL || 'Tongyi-MAI/Z-Image-Turbo');
            const hfResult = await callHuggingFaceImage(message || '');
            if (hfResult && hfResult.image) {
                console.log('✅ Hugging Face image generated successfully');
                return res.json({ reply: 'Gambar selesai dibuat.', image: hfResult.image, modelUsed: 'huggingface' });
            }

            console.warn('❌ Hugging Face image provider returned null/empty');
            return res.json({
                reply: 'Maaf, pembuatan gambar gagal. Hugging Face tidak mengembalikan gambar atau konfigurasi tidak benar. Periksa HUGGINGFACE_API_KEY dan HF_IMAGE_MODEL di .env.',
                modelUsed: 'huggingface-image-error'
            });
        }

        // ===== BACA ISI FILE DULU (kalau user upload PDF/Word/Excel/teks, BUKAN gambar) =====
        let documentContext = "";
        if (file && file.data) {
            console.log(`📄 Membaca file: ${file.filename} (${file.mimeType})`);
            const extracted = await extractTextFromDocument(file);
            if (extracted && extracted.trim()) {
                documentContext = formatDocumentForPrompt(file.filename, truncateText(extracted));
                console.log(`✅ Berhasil baca file, ${extracted.length} karakter`);
            } else {
                documentContext = `\n\n[Catatan untuk AI: user upload file "${file.filename}" tapi server gagal membaca isinya (format belum didukung, library belum di-install, atau filenya kosong). Bilang terus terang ke user soal ini, jangan mengarang isi filenya.]`;
                console.warn('⚠️ Gagal extract isi file atau hasilnya kosong:', file.filename);
            }
        }

        // ===== RAG: RISET WEB DULU PAKAI TAVILY (sebelum AI jawab) =====
        let searchContext = "";
        let searchSources = [];
        if (ENABLE_WEB_SEARCH && needsResearch(message)) {
            console.log('🔎 Riset web (Tavily) untuk:', message?.slice(0, 80));
            const tavilyData = await tavilySearch(message);
            if (tavilyData && (tavilyData.answer || (tavilyData.results && tavilyData.results.length > 0))) {
                searchContext = formatTavilyForPrompt(message, tavilyData);
                searchSources = (tavilyData.results || []).map(r => ({ title: r.title, link: r.url }));
                console.log(`✅ Riset web dapat ${tavilyData.results?.length || 0} hasil${tavilyData.answer ? ' + ringkasan' : ''}`);
            } else {
                console.log('⚠️ Riset web tidak menghasilkan apa-apa, lanjut tanpa konteks tambahan.');
            }
        }

        // Gabung isi dokumen + hasil riset web jadi satu konteks tambahan buat prompt AI.
        const extraContext = [documentContext, searchContext].filter(Boolean).join('\n');

        let replyText;
        
        console.log(`📡 Menggunakan model: ${selectedModel.toUpperCase()}`);
        if (selectedModel === 'gemini') {
            try {
                replyText = await callGemini(message, context, image, extraContext);
            } catch (geminiError) {
                if (isGeminiQuotaError(geminiError)) {
                    console.warn('Gemini quota exceeded, fallback ke Groq:', geminiError.message);
                    replyText = await callGroq(message, context, image, undefined, extraContext);
                    selectedModel = 'groq';
                } else {
                    throw geminiError;
                }
            }
        } else if (selectedModel === 'gpt-oss') {
            replyText = await callGroq(message, context, image, 'openai/gpt-oss-120b', extraContext);
        } else {
            replyText = await callGroq(message, context, image, undefined, extraContext);
        }
        
        res.json({ 
            reply: replyText,
            modelUsed: selectedModel,
            sources: searchSources.length > 0 ? searchSources : undefined
        });

    } catch (error) {
        console.error(`Error dengan ${selectedModel}:`, error);
        
        // Fallback: coba model lain jika satu gagal
        try {
            console.log(`⚠️ ${selectedModel} gagal, fallback ke model lain...`);
            const fallbackModel = selectedModel === 'groq' ? 'gemini' : 'groq';
            let fallbackReply;
            
            if (fallbackModel === 'gemini') {
                fallbackReply = await callGemini(message, context, image);
            } else {
                fallbackReply = await callGroq(message, context, image);
            }
            
            res.json({ 
                reply: `[Fallback ke ${fallbackModel}] ${fallbackReply}`,
                modelUsed: fallbackModel,
                fallback: true
            });
        } catch (fallbackError) {
            res.status(500).json({ 
                reply: `Server lagi sibuk, Bosku! Coba lagi ya. (Error: ${error.message})` 
            });
        }
    }
});

// ===== ENDPOINT STREAMING (Server-Sent Events) =====
// Tujuannya sama kayak /chat, tapi balasan AI dikirim sepotong-sepotong begitu kelar
// digenerate (token-by-token), bukan nunggu jawaban full kelar dulu kayak /chat biasa.
// Efeknya di frontend: teks "ngetik" sendiri secara live, sama seperti Gemini/ChatGPT.
//
// Format tiap event: "data: {...json...}\n\n"
//   - { delta: "..." }              -> potongan teks baru, ditambahin ke teks yang udah ada
//   - { done: true, modelUsed, sources, image, video } -> tanda selesai + metadata tambahan
app.post('/chat/stream', async (req, res) => {
    const { message, context, image, model, file } = req.body;
    let selectedModel = model || 'groq';
    console.log(`\n=== /chat/stream MULAI === model=${selectedModel}, message="${String(message).slice(0, 60)}"`);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // biar nggak dibuffer proxy/nginx, chunk langsung diteruskan
    });

    const send = (payload) => {
        try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (e) { /* koneksi mungkin udah putus */ }
    };

    let clientClosed = false;
    req.on('close', () => { clientClosed = true; });

    try {
        // ===== VIDEO: belum ada streaming token, jadi dikirim sebagai satu "delta" utuh =====
        const wantsVideo = !image && isVideoIntent(message);
        if (wantsVideo) {
            if (!process.env.HUGGINGFACE_API_KEY) {
                send({ delta: 'Maaf, pembuatan video hanya didukung lewat Hugging Face. Silakan atur HUGGINGFACE_API_KEY di .env.' });
                send({ done: true, modelUsed: 'huggingface-video-unavailable' });
                return res.end();
            }
            const hfVideoResult = await callHuggingFaceVideo(message || '');
            if (hfVideoResult && hfVideoResult.video) {
                send({ delta: 'Video selesai dibuat.' });
                send({ done: true, modelUsed: 'huggingface-video', video: hfVideoResult.video });
                return res.end();
            }
            send({ delta: 'Maaf, pembuatan video gagal. Bisa jadi prosesnya kelamaan (timeout), kuota/saldo provider habis, atau konfigurasi HF_VIDEO_MODEL/HF_VIDEO_PROVIDER salah.' });
            send({ done: true, modelUsed: 'huggingface-video-error' });
            return res.end();
        }

        // ===== VISION / IMAGE GENERATION: sama, satu "delta" utuh (bukan streaming token) =====
        const wantsImageAnalysis = Boolean(image);
        const wantsImageGeneration = !image && isImageIntent(message);

        if (wantsImageAnalysis) {
            try {
                let visionReply;
                if (selectedModel === 'gemini') {
                    visionReply = await callGemini(message, context, image);
                    send({ delta: visionReply });
                    send({ done: true, modelUsed: 'gemini-vision' });
                } else {
                    visionReply = await callGroq(message, context, image, 'meta-llama/llama-4-scout-17b-16e-instruct');
                    send({ delta: visionReply });
                    send({ done: true, modelUsed: 'groq-vision' });
                }
            } catch (visionError) {
                send({ delta: `Maaf Bosku, gagal menganalisa gambarnya. (Error: ${visionError.message})` });
                send({ done: true, modelUsed: 'vision-error' });
            }
            return res.end();
        }

        if (wantsImageGeneration) {
            if (!process.env.HUGGINGFACE_API_KEY) {
                send({ delta: 'Maaf, pembuatan gambar hanya didukung lewat Hugging Face. Silakan atur HUGGINGFACE_API_KEY di .env.' });
                send({ done: true, modelUsed: 'huggingface-image-unavailable' });
                return res.end();
            }
            const hfResult = await callHuggingFaceImage(message || '');
            if (hfResult && hfResult.image) {
                send({ delta: 'Gambar selesai dibuat.' });
                send({ done: true, modelUsed: 'huggingface', image: hfResult.image });
                return res.end();
            }
            send({ delta: 'Maaf, pembuatan gambar gagal. Hugging Face tidak mengembalikan gambar atau konfigurasi tidak benar. Periksa HUGGINGFACE_API_KEY dan HF_IMAGE_MODEL di .env.' });
            send({ done: true, modelUsed: 'huggingface-image-error' });
            return res.end();
        }

        // ===== BACA FILE + RISET WEB (logikanya sama persis dengan /chat biasa) =====
        let documentContext = "";
        if (file && file.data) {
            const extracted = await extractTextFromDocument(file);
            if (extracted && extracted.trim()) {
                documentContext = formatDocumentForPrompt(file.filename, truncateText(extracted));
            } else {
                documentContext = `\n\n[Catatan untuk AI: user upload file "${file.filename}" tapi server gagal membaca isinya (format belum didukung, library belum di-install, atau filenya kosong). Bilang terus terang ke user soal ini, jangan mengarang isinya.]`;
            }
        }

        let searchContext = "";
        let searchSources = [];
        if (ENABLE_WEB_SEARCH && needsResearch(message)) {
            const tavilyData = await tavilySearch(message);
            if (tavilyData && (tavilyData.answer || (tavilyData.results && tavilyData.results.length > 0))) {
                searchContext = formatTavilyForPrompt(message, tavilyData);
                searchSources = (tavilyData.results || []).map(r => ({ title: r.title, link: r.url }));
            }
        }

        const extraContext = [documentContext, searchContext].filter(Boolean).join('\n');

        let chunkCount = 0;
        const onChunk = (delta) => {
            chunkCount++;
            if (!clientClosed) send({ delta });
        };

        // ===== STREAMING BENERAN: token demi token dari Groq/Gemini =====
        // Catatan: gpt-oss adalah reasoning model. Temperature harus 1 (default) dan
        // jawaban finalnya lebih andal lewat non-streaming (content tidak terpotong).
        if (selectedModel === 'gpt-oss') {
            // gpt-oss butuh waktu lama untuk reasoning sebelum menghasilkan jawaban.
            // Masalah: browser menutup koneksi SSE kalau terlalu lama tidak ada data.
            // Solusi dua lapis:
            // 1. Kirim send({ thinking:true }) dulu -- ini bukan delta, jadi frontend
            //    mengabaikannya, tapi cukup untuk membuat koneksi 'aktif' di mata browser.
            // 2. Kirim komentar SSE ': ping' setiap 5 detik sebagai keepalive tambahan.
            console.log('INFO gpt-oss: memanggil callGroq non-streaming...');
            send({ thinking: true });
            const heartbeat = setInterval(() => {
                if (!clientClosed) {
                    try { res.write(': ping\n\n'); } catch(e) {}
                }
            }, 5000);
            let gptOssText;
            try {
                gptOssText = await callGroq(message, context, image, 'openai/gpt-oss-120b', extraContext);
            } finally {
                clearInterval(heartbeat);
            }
            console.log('INFO gpt-oss: selesai, panjang:', gptOssText?.length, '| clientClosed:', clientClosed);
            if (!clientClosed) send({ delta: gptOssText });
            chunkCount++;
        } else if (selectedModel === 'gemini') {
            try {
                await callGeminiStream(message, context, image, extraContext, onChunk);
            } catch (geminiError) {
                if (isGeminiQuotaError(geminiError)) {
                    console.warn('Gemini quota exceeded (stream), fallback ke Groq:', geminiError.message);
                    selectedModel = 'groq';
                    await callGroqStream(message, context, image, undefined, extraContext, onChunk);
                } else {
                    throw geminiError;
                }
            }
        } else {
            await callGroqStream(message, context, image, undefined, extraContext, onChunk);
        }

        // ===== SAFETY NET =====
        // Kadang format chunk streaming dari provider/model tertentu beda dari yang diharapkan,
        // jadi loop di atas kelar tanpa error TAPI nggak ada satupun delta yang berhasil diekstrak
        // (chunkCount tetap 0). Daripada user cuma dikasih kalimat "ngelamun" yang nggak ada
        // jawaban beneran, di sini kita fallback diam-diam ke pemanggilan non-streaming biasa
        // (yang sudah teruji jalan), terus hasilnya dikirim sebagai satu delta utuh.
        if (chunkCount === 0 && !clientClosed) {
            console.log(`⚠️ Streaming 0 chunk untuk model=${selectedModel}, fallback ke pemanggilan non-streaming...`);
            try {
                let fallbackText;
                if (selectedModel === 'gemini') {
                    fallbackText = await callGemini(message, context, image, extraContext);
                } else if (selectedModel === 'gpt-oss') {
                    fallbackText = await callGroq(message, context, image, 'openai/gpt-oss-120b', extraContext);
                } else {
                    fallbackText = await callGroq(message, context, image, undefined, extraContext);
                }
                send({ delta: fallbackText });
            } catch (fallbackErr) {
                console.log('❌ Fallback non-streaming juga gagal:', fallbackErr.message);
                send({ delta: `Maaf Bosku, server lagi bermasalah. (Error: ${fallbackErr.message})` });
            }
        }

        send({ done: true, modelUsed: selectedModel, sources: searchSources.length > 0 ? searchSources : undefined });
        console.log(`=== /chat/stream SELESAI (sukses) === modelUsed=${selectedModel}\n`);
        res.end();

    } catch (error) {
        console.log('Error di /chat/stream:', error.message, error.stack);
        send({ delta: `\n\n(Server lagi sibuk, Bosku! Coba lagi ya. Error: ${error.message})` });
        send({ done: true, modelUsed: selectedModel, error: true });
        console.log(`=== /chat/stream SELESAI (error) ===\n`);
        try { res.end(); } catch (e) { /* ignore */ }
    }
});

// Endpoint untuk cek kedua model (testing)
app.get('/models/status', async (req, res) => {
    const status = {
        groq: { available: false, message: '' },
        gemini: { available: false, message: '' }
    };
    
    // Test Groq
    try {
        await callGroq("Ping", null, null);
        status.groq.available = true;
        status.groq.message = "✅ Groq ready";
    } catch (e) {
        status.groq.message = `❌ ${e.message}`;
    }
    
    // Test Gemini
    try {
        await callGemini("Ping", null, null);
        status.gemini.available = true;
        status.gemini.message = "✅ Gemini ready";
    } catch (e) {
        if (isGeminiQuotaError(e)) {
            status.gemini.available = false;
            status.gemini.message = `❌ Gemini quota error: ${e.message}`;
        } else {
            status.gemini.message = `❌ ${e.message}`;
        }
    }
    
    res.json(status);
});

app.listen(PORT, () => {
    console.log(`🚀 DUAL MODEL AI READY!`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`🤖 Models: Groq (Llama 4) & Gemini 2.0`);
});