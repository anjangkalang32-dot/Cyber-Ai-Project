require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

// System prompt yang sama untuk kedua model
const systemPrompt = `Kamu adalah Nexus AI Beta Edition, asisten cerdas buatan Anjang Kalang.

ATURAN FORMAT WAJIB (DITURUTI ATAU ERROR):
1. HARAM/DILARANG KERAS menggunakan simbol LaTeX seperti $...$ atau $$...$$. 
2. Gunakan simbol keyboard standar: ^2 untuk kuadrat, / untuk bagi, * untuk kali.
3. Gunakan minimal DUA KALI ENTER (\n\n) untuk setiap poin jawaban agar tidak berderet.
4. Setiap langkah matematika WAJIB ditulis di baris baru.
5. Gunakan format Markdown standar (**Bold**) untuk poin penting.

GAYA BAHASA: Santai, gaul. 

CONTOH FORMAT JAWABAN:
1. **Jawaban A**

   Penjelasan: Langkah pertama adalah... (jarak antar baris harus jelas).

Ada lagi yang bisa aku bantu?

PENTING: 
- Jika hanya menyapa atau ngobrol pendek, tulis dalam satu paragraf sambung.
- HANYA gunakan baris baru (Enter) jika kamu menjawab soal, memberikan langkah-langkah, atau membuat daftar. 
- Gunakan format angka (1., 2., 3.) untuk jawaban soal agar sistemku bisa mendeteksinya.`;

// Fungsi untuk memanggil Groq
async function callGroq(message, context, image) {
    const messagesForAI = [
        { role: "system", content: systemPrompt }
    ];

    if (context) {
        messagesForAI.push({ role: "user", content: `Memori Chat: ${context}` });
    }

    let userContent;
    if (image) {
        userContent = [
            { type: "text", text: message || "Jelaskan gambar ini" },
            { type: "image_url", image_url: { url: image } }
        ];
    } else {
        userContent = [{ type: "text", text: message || "Halo" }];
    }
    
    messagesForAI.push({ role: "user", content: userContent });

    const chatCompletion = await groq.chat.completions.create({
        messages: messagesForAI,
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0.8,
    });

    return chatCompletion.choices[0]?.message?.content || "Duh Bosku, aku lagi ngelamun. Tanya lagi yuk!";
}

// Fungsi untuk memanggil Gemini
async function callGemini(message, context, image) {
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
        fullPrompt += message || "Halo";
        
        result = await model.generateContent(fullPrompt);
    }

    return result.response.text();
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
    const hfUrl = process.env.HUGGINGFACE_API_URL?.trim() || `https://api-inference.huggingface.co/models/${hfModel}`;

    try {
        console.log(`📡 HuggingFace request: URL="${hfUrl}", model="${hfModel}"`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 detik timeout

        const resp = await fetch(hfUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${hfKey}`,
                Accept: "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                inputs: prompt,
                options: { wait_for_model: true }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const contentType = resp.headers.get("content-type") || "";
        if (!resp.ok) {
            const bodyText = await resp.text();
            console.warn("HuggingFace image API failed:", resp.status, resp.statusText, bodyText.slice(0, 300));
            return null;
        }

        if (contentType.includes("application/json")) {
            const json = await resp.json();
            if (json?.error) {
                console.warn("HuggingFace image API returned error payload:", json.error);
                return null;
            }

            const maybeImage = Array.isArray(json?.data) ? json.data[0] : json?.data || json?.image || json?.output || json?.outputs?.[0];
            if (typeof maybeImage === 'string') {
                if (maybeImage.startsWith('data:image/')) {
                    return { image: maybeImage, provider: 'huggingface' };
                }
                return { image: `data:image/png;base64,${maybeImage}`, provider: 'huggingface' };
            }
            if (typeof json?.data === 'object' && json.data?.[0]?.b64) {
                return { image: `data:image/png;base64,${json.data[0].b64}`, provider: 'huggingface' };
            }

            console.warn('HuggingFace image API returned JSON without image data:', JSON.stringify(json).slice(0, 300));
            return null;
        }

        const buffer = await resp.arrayBuffer();
        const mimeType = contentType.split(";")[0] || "image/png";
        const b64 = Buffer.from(buffer).toString("base64");
        return { image: `data:${mimeType};base64,${b64}`, provider: "huggingface" };
    } catch (e) {
        const errorMsg = e?.name === 'AbortError' ? 'Request timeout (30s)' : (e?.message || String(e));
        const errorCode = e?.code;
        console.warn("HuggingFace image generation error:", errorMsg, "| errorCode:", errorCode, "| errorName:", e?.name);
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

// Endpoint untuk test koneksi ke Hugging Face
app.get('/test-hf', async (req, res) => {
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    const hfModel = process.env.HF_IMAGE_MODEL || "Tongyi-MAI/Z-Image-Turbo";
    const hfUrl = `https://api-inference.huggingface.co/models/${hfModel}`;

    try {
        console.log(`🧪 Testing HF connection to: ${hfUrl}`);
        const resp = await fetch(hfUrl, {
            method: "HEAD",
            headers: { Authorization: `Bearer ${hfKey}` }
        });
        
        res.json({ 
            status: resp.status, 
            statusText: resp.statusText,
            headers: Object.fromEntries(resp.headers),
            url: hfUrl,
            apiKeyPresent: !!hfKey,
            model: hfModel
        });
    } catch (e) {
        res.json({ 
            error: e?.message || String(e),
            errorName: e?.name,
            errorCode: e?.code,
            url: hfUrl,
            apiKeyPresent: !!hfKey,
            model: hfModel
        });
    }
});

// Endpoint utama dengan pemilihan model
app.post('/chat', async (req, res) => {
    const { message, context, image, model } = req.body; // model bisa 'groq' atau 'gemini'
    
    // Default ke groq jika tidak ditentukan
    let selectedModel = model || 'groq';

    try {
        // If user provided an image or wants an image from text intent, attempt image generation first
        const wantsImage = Boolean(image) || isImageIntent(message);
        console.log(`📨 Chat request: model=${selectedModel}, hasImage=${Boolean(image)}, isImageIntent=${isImageIntent(message)}, wantsImage=${wantsImage}, message="${message?.slice(0, 50)}..."`);
        
        if (wantsImage) {
            console.log('🎨 Image generation path triggered');
            // If user uploaded an image, use Gemini vision (callGemini handles inlineData)
            if (image) {
                try {
                    const geminiReply = await callGemini(message, context, image);
                    return res.json({ reply: geminiReply, modelUsed: 'gemini-vision' });
                } catch (e) {
                    console.warn('Gemini vision failed, akan mencoba Nano Banana text->image:', e.message);
                }
            }

            if (!process.env.HUGGINGFACE_API_KEY) {
                console.warn('❌ HUGGINGFACE_API_KEY tidak ditemukan');
                return res.json({
                    reply: 'Maaf, pembuatan gambar hanya didukung lewat Hugging Face sekarang. Silakan atur HUGGINGFACE_API_KEY di .env.',
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

        let replyText;
        
        console.log(`📡 Menggunakan model: ${selectedModel.toUpperCase()}`);
        if (selectedModel === 'gemini') {
            try {
                replyText = await callGemini(message, context, image);
            } catch (geminiError) {
                if (isGeminiQuotaError(geminiError)) {
                    console.warn('Gemini quota exceeded, fallback ke Groq:', geminiError.message);
                    replyText = await callGroq(message, context, image);
                    selectedModel = 'groq';
                } else {
                    throw geminiError;
                }
            }
        } else {
            replyText = await callGroq(message, context, image);
        }
        
        res.json({ 
            reply: replyText,
            modelUsed: selectedModel 
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