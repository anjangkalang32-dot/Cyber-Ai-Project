# TODO - Perbaikan Generate Gambar

- [ ] Tambahkan logging di `server.js` saat image intent diproses (wantsImage) dan saat `callGeminiImageFromText()` menerima `result`.
- [ ] Perbaiki ekstraksi image dari response Gemini image model agar selalu menghasilkan string `data:image/...`.
- [ ] Pastikan endpoint `/chat` mengembalikan `image` ke frontend ketika image sukses.
- [ ] Buat fallback yang jelas: bila image gagal, kirim pesan error/penjelasan ke frontend.
- [ ] Tes end-to-end dari frontend (minta prompt gambar) dan pastikan `data.image` ada.

