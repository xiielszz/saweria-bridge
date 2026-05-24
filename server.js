// ================================================================
//  SOCIABUZZ BRIDGE SERVER — Official Webhook
//  Sociabuzz PUSH donasi langsung ke server ini
//  Tidak diblokir, resmi, dan stabil!
//
//  Deploy: Railway.app
//  Tech  : Node.js + Express
// ================================================================

const express = require("express");
const crypto  = require("crypto");

const app  = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  KONFIGURASI
// ──────────────────────────────────────────────

// Webhook Token dari Sociabuzz (kamu isi sendiri di Railway Variables)
// Cara dapat: sociabuzz.com → TRIBE → Edit & Settings → Integrations → Webhook
const SOCIABUZZ_TOKEN = process.env.SOCIABUZZ_TOKEN || "isi_token_sociabuzz_kamu";

// Kunci rahasia untuk Roblox (sama dengan di SaweriaConfig.lua)
const API_KEY = process.env.API_KEY || "roblox-saweria-secret-2025";

// ──────────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────────

const pendingDonations = [];
const donationLog      = [];
let donationCounter    = 1;
let totalReceived      = 0;

// ──────────────────────────────────────────────
//  MIDDLEWARE
// ──────────────────────────────────────────────

// Perlu raw body untuk verifikasi token Sociabuzz
app.use("/sociabuzz", express.raw({ type: "*/*" }));
app.use("/webhook",   express.raw({ type: "*/*" }));

// JSON untuk endpoint lain
app.use((req, res, next) => {
    if (req.path === "/sociabuzz" || req.path === "/webhook") return next();
    express.json()(req, res, next);
});

// CORS untuk Roblox
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin",  "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// API Key check untuk Roblox
function checkKey(req, res, next) {
    const key = req.headers["x-api-key"] || req.query.key;
    if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
    next();
}

// ──────────────────────────────────────────────
//  HELPER: SIMPAN DONASI
// ──────────────────────────────────────────────

function saveDonation(name, amount, message, source) {
    if (!name || amount <= 0) return null;

    const donation = {
        id:      donationCounter++,
        name:    name.trim(),
        amount:  Math.floor(amount),
        message: (message || "").trim(),
        ts:      new Date().toISOString(),
    };

    pendingDonations.push(donation);
    donationLog.unshift(donation);
    if (donationLog.length > 50) donationLog.pop();
    totalReceived++;

    console.log(`[${source}] ${donation.name} -> Rp ${donation.amount.toLocaleString("id-ID")} | "${donation.message}"`);
    return donation;
}

// ──────────────────────────────────────────────
//  ENDPOINT: POST /sociabuzz
//  Sociabuzz kirim POST ke sini setiap ada donasi
//
//  Cara setup di Sociabuzz:
//  1. Buka sociabuzz.com → login
//  2. Klik TRIBE → Edit & Settings
//  3. Klik Integrations → Webhook
//  4. Aktifkan Webhook
//  5. Webhook URL: https://URL-RAILWAY.up.railway.app/sociabuzz
//  6. Webhook Token: isi bebas (sama dengan SOCIABUZZ_TOKEN di Railway)
//  7. Klik Test Notification
// ──────────────────────────────────────────────

app.post("/sociabuzz", (req, res) => {
    try {
        // Verifikasi token dari header Sociabuzz
        const token = req.headers["x-callback-token"]
            || req.headers["authorization"]
            || req.headers["x-webhook-token"]
            || req.headers["x-sociabuzz-token"]
            || "";

        // Cek token (jika token sudah diset)
        if (SOCIABUZZ_TOKEN !== "isi_token_sociabuzz_kamu" && token !== SOCIABUZZ_TOKEN) {
            console.warn("[Sociabuzz] Token tidak valid:", token.slice(0,20));
            // Tetap balas 200 agar tidak retry berulang
            return res.sendStatus(200);
        }

        // Parse body
        let body;
        try {
            const raw = Buffer.isBuffer(req.body) ? req.body.toString() : req.body;
            body = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch(e) {
            console.error("[Sociabuzz] Gagal parse body:", e.message);
            return res.sendStatus(200);
        }

        console.log("[Sociabuzz] Payload:", JSON.stringify(body).slice(0, 300));

        // Format payload Sociabuzz Webhook:
        // {
        //   "amount_raw": 50000,
        //   "amount": 50000,
        //   "supporter_name": "Budi",
        //   "message": "GG!",
        //   "created_at": "...",
        //   "type": "tribe_donation"
        // }
        const name    = body.supporter_name
            || body.donator_name
            || body.name
            || body.username
            || "Anonim";

        const amount  = parseInt(
            body.amount_raw || body.amount || body.nominal || 0, 10
        );

        const message = body.message || body.notes || "";

        saveDonation(name, amount, message, "Sociabuzz");

    } catch (err) {
        console.error("[Sociabuzz] Error:", err.message);
    }

    // Selalu balas 200 agar Sociabuzz tidak retry
    res.sendStatus(200);
});

// Alias /webhook juga diterima
app.post("/webhook", (req, res) => {
    req.url = "/sociabuzz";
    app.handle(req, res);
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
const TEST_MSGS    = ["Semangat terus!", "GG WP!", "Sultan hadir!", "Gas pol!", "Salken!"];

app.get("/test", checkKey, (req, res) => {
    const name   = req.query.name   || TEST_NAMES[Math.floor(Math.random() * TEST_NAMES.length)];
    const amount = parseInt(req.query.amount || TEST_AMOUNTS[Math.floor(Math.random() * TEST_AMOUNTS.length)], 10);
    const msg    = req.query.msg    || TEST_MSGS[Math.floor(Math.random() * TEST_MSGS.length)];
    const d = saveDonation(name, amount, msg, "Test");
    res.json({ success: true, donation: d });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /health
// ──────────────────────────────────────────────

app.get("/health", (req, res) => {
    res.json({
        status:   "ok",
        mode:     "sociabuzz-webhook",
        pending:  pendingDonations.length,
        total:    totalReceived,
        uptime:   Math.floor(process.uptime()) + "s",
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /
// ──────────────────────────────────────────────

app.get("/", (req, res) => {
    res.send(`<html><body style="font-family:monospace;background:#0a0a14;color:#eee;padding:32px;line-height:2">
        <h2>⚡ Sociabuzz → Roblox Bridge</h2>
        <p>Mode    : <b style="color:#6bcb77">WEBHOOK AKTIF ✅</b></p>
        <p>Pending : <b>${pendingDonations.length}</b> donasi</p>
        <p>Total   : <b>${totalReceived}</b> donasi diterima</p>
        <p>Uptime  : ${Math.floor(process.uptime())}s</p>
        <hr style="border-color:#333;margin:16px 0">
        <b>Setup Sociabuzz:</b><br>
        TRIBE → Edit & Settings → Integrations → Webhook<br>
        URL: <code style="color:#ffd93d">https://URL-RAILWAY.up.railway.app/sociabuzz</code>
    </body></html>`);
});

// ──────────────────────────────────────────────
//  START
// ──────────────────────────────────────────────

app.listen(PORT, () => {
    console.log("================================================");
    console.log("  ⚡ Sociabuzz Bridge AKTIF");
    console.log(`  Port         : ${PORT}`);
    console.log(`  Webhook URL  : POST /sociabuzz`);
    console.log(`  API Key      : ${API_KEY}`);
    console.log("================================================");
    console.log("");
    console.log("  Setup Sociabuzz:");
    console.log("  sociabuzz.com → TRIBE → Edit & Settings");
    console.log("  → Integrations → Webhook → Aktifkan");
    console.log("  → URL: https://URL-RAILWAY.up.railway.app/sociabuzz");
    console.log("================================================");
});
