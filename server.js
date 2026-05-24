// ================================================================
//  SAWERIA BRIDGE SERVER — Webhook Edition (CARA RESMI)
//  Saweria PUSH donasi ke server ini setiap ada donasi masuk
//  Tidak perlu polling, tidak perlu cookie, tidak diblokir!
//
//  Deploy: Railway.app
//  Tech  : Node.js + Express
// ================================================================

const express  = require("express");
const crypto   = require("crypto");

const app  = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  KONFIGURASI
// ──────────────────────────────────────────────

// Stream Key Saweria kamu (untuk verifikasi signature webhook)
const STREAM_KEY = process.env.STREAM_KEY || "5ce6991001bcac3ed38990f430ff8247";

// Kunci rahasia untuk Roblox (bebas, sama dengan di SaweriaConfig.lua)
const API_KEY    = process.env.API_KEY    || "roblox-saweria-secret-2025";

// ──────────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────────

const pendingDonations = [];   // Antrian untuk Roblox polling
const donationLog      = [];   // Log 50 donasi terakhir
let donationCounter    = 1;
let totalReceived      = 0;

// ──────────────────────────────────────────────
//  VERIFIKASI SIGNATURE SAWERIA
//  Memastikan request benar-benar dari Saweria
// ──────────────────────────────────────────────

function verifySignature(rawBody, signatureHeader) {
    try {
        const expected = crypto
            .createHmac("sha256", STREAM_KEY)
            .update(rawBody)
            .digest("hex");
        return expected === signatureHeader;
    } catch (e) {
        return false;
    }
}

// ──────────────────────────────────────────────
//  MIDDLEWARE
// ──────────────────────────────────────────────

// CORS untuk Roblox
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin",  "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Saweria-Callback-Signature");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// Raw body parser KHUSUS untuk endpoint webhook
// (perlu raw body untuk verifikasi signature Saweria)
app.use("/webhook", express.raw({ type: "*/*" }));

// JSON parser untuk endpoint lain
app.use((req, res, next) => {
    if (req.path !== "/webhook") express.json()(req, res, next);
    else next();
});

// Cek API Key (untuk endpoint Roblox)
function checkKey(req, res, next) {
    const key = req.headers["x-api-key"] || req.query.key;
    if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
    next();
}

// ──────────────────────────────────────────────
//  ENDPOINT: POST /webhook
//  Saweria mengirim POST ke sini setiap ada donasi
//  Daftarkan URL ini di dashboard Saweria:
//  https://URL-RAILWAY-KAMU.up.railway.app/webhook
// ──────────────────────────────────────────────

app.post("/webhook", (req, res) => {
    const signature = req.headers["saweria-callback-signature"] || "";
    const rawBody   = req.body; // Buffer karena pakai express.raw

    // Verifikasi bahwa request dari Saweria (bukan orang iseng)
    if (!verifySignature(rawBody, signature)) {
        console.warn("[Webhook] Signature tidak valid! Kemungkinan request palsu.");
        // Tetap balas 200 agar Saweria tidak retry terus
        // tapi jangan simpan datanya
        return res.sendStatus(200);
    }

    let data;
    try {
        data = JSON.parse(rawBody.toString());
    } catch (e) {
        console.error("[Webhook] Gagal parse body:", e.message);
        return res.sendStatus(200);
    }

    console.log("[Webhook] Data masuk:", JSON.stringify(data).slice(0, 200));

    // Format payload Saweria webhook:
    // {
    //   version: "2021.07",
    //   type: "donation",
    //   id: "uuid",
    //   donator_name: "Budi",
    //   donator_email: "...",
    //   amount_raw: 50000,
    //   amount: 50000,
    //   cut: 2500,
    //   message: "GG!",
    //   created_at: "2024-01-01T..."
    // }

    const name    = data.donator_name || data.name || "Anonim";
    const amount  = parseInt(data.amount_raw || data.amount || 0, 10);
    const message = data.message || "";

    if (amount <= 0) {
        console.log("[Webhook] Amount 0, diabaikan.");
        return res.sendStatus(200);
    }

    const donation = {
        id:      donationCounter++,
        name,
        amount,
        message,
        ts:      data.created_at || new Date().toISOString(),
    };

    pendingDonations.push(donation);
    donationLog.unshift(donation);
    if (donationLog.length > 50) donationLog.pop();
    totalReceived++;

    console.log(`[Donasi] ✅ ${donation.name} -> Rp ${donation.amount.toLocaleString("id-ID")} | "${donation.message}"`);

    // Saweria butuh respons 200 dalam 5 detik
    res.sendStatus(200);
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /donations
//  Dipanggil SaweriaServer.lua setiap polling
// ──────────────────────────────────────────────

app.get("/donations", checkKey, (req, res) => {
    const toSend = [...pendingDonations];
    pendingDonations.length = 0;

    res.json({
        donations: toSend,
        count:     toSend.length,
        ts:        new Date().toISOString(),
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /log
// ──────────────────────────────────────────────

app.get("/log", checkKey, (req, res) => {
    res.json({
        donations: donationLog.slice(0, 20),
        pending:   pendingDonations.length,
        total:     totalReceived,
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /test
//  Simulasi donasi untuk testing Roblox
// ──────────────────────────────────────────────

const TEST_NAMES   = ["BudiGaming", "SitiOP", "SultanAqila", "JokiGacor", "RezaXL"];
const TEST_AMOUNTS = [5000, 15000, 50000, 100000, 500000, 1000000];
const TEST_MSGS    = ["Semangat terus!", "GG WP!", "Sultan hadir!", "Gas pol!", "Salken dari Bandung!"];

app.get("/test", checkKey, (req, res) => {
    const donation = {
        id:      donationCounter++,
        name:    req.query.name   || TEST_NAMES[Math.floor(Math.random() * TEST_NAMES.length)],
        amount:  parseInt(req.query.amount || TEST_AMOUNTS[Math.floor(Math.random() * TEST_AMOUNTS.length)], 10),
        message: req.query.msg    || TEST_MSGS[Math.floor(Math.random() * TEST_MSGS.length)],
        ts:      new Date().toISOString(),
    };
    pendingDonations.push(donation);
    donationLog.unshift(donation);
    totalReceived++;
    console.log(`[Test] ${donation.name} -> Rp ${donation.amount}`);
    res.json({ success: true, donation });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /health
// ──────────────────────────────────────────────

app.get("/health", (req, res) => {
    res.json({
        status:   "ok",
        mode:     "webhook",
        pending:  pendingDonations.length,
        total:    totalReceived,
        logged:   donationLog.length,
        uptime:   Math.floor(process.uptime()) + "s",
        webhook_url: "POST /webhook",
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /
// ──────────────────────────────────────────────

app.get("/", (req, res) => {
    res.send(`<html><body style="font-family:monospace;background:#0a0a14;color:#eee;padding:32px;line-height:2">
        <h2>⚡ Saweria Bridge — Webhook Mode</h2>
        <p>Mode      : <b style="color:#6bcb77">WEBHOOK (Aktif)</b></p>
        <p>Pending   : <b>${pendingDonations.length}</b> donasi</p>
        <p>Total     : <b>${totalReceived}</b> donasi diterima</p>
        <p>Uptime    : ${Math.floor(process.uptime())}s</p>
        <hr style="border-color:#333;margin:16px 0">
        <h3>Setup Webhook di Saweria:</h3>
        <p>Dashboard Saweria → Webhook → URL:</p>
        <code style="background:#111;padding:8px 12px;border-radius:6px;color:#ffd93d">
          POST https://URL-RAILWAY-KAMU.up.railway.app/webhook
        </code>
        <hr style="border-color:#333;margin:16px 0">
        <p><code>GET /donations?key=API_KEY</code> — untuk Roblox polling</p>
        <p><code>GET /test?key=API_KEY</code>      — donasi test</p>
        <p><code>GET /log?key=API_KEY</code>        — log donasi</p>
        <p><code>GET /health</code>                 — status server</p>
    </body></html>`);
});

// ──────────────────────────────────────────────
//  START
// ──────────────────────────────────────────────

app.listen(PORT, () => {
    console.log("================================================");
    console.log("  ⚡ Saweria Bridge (WEBHOOK MODE) AKTIF");
    console.log(`  Port        : ${PORT}`);
    console.log(`  Webhook URL : POST /webhook`);
    console.log(`  API Key     : ${API_KEY}`);
    console.log("================================================");
    console.log("");
    console.log("  Langkah selanjutnya:");
    console.log("  1. Copy URL Railway kamu");
    console.log("  2. Buka saweria.co → Dashboard → Webhook");
    console.log("  3. Paste URL: https://URL-RAILWAY.up.railway.app/webhook");
    console.log("  4. Klik Test Webhook untuk verifikasi");
    console.log("================================================");
});
