// ================================================================
//  SAWERIA BRIDGE SERVER — SSE Edition (Server-Sent Events)
//  Endpoint resmi Saweria: api.saweria.co/stream
//
//  Deploy: Railway.app
//  Tech  : Node.js + Express + eventsource
// ================================================================

const express     = require("express");
const EventSource = require("eventsource");
const http        = require("http");

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  KONFIGURASI
// ──────────────────────────────────────────────

const STREAM_KEY = process.env.STREAM_KEY || "5ce6991001bcac3ed38990f430ff8247";
const API_KEY    = process.env.API_KEY    || "roblox-saweria-secret-2025";

// URL SSE resmi Saweria
const SAWERIA_SSE_URL = `https://api.saweria.co/stream?channel=donation.${STREAM_KEY}`;

// ──────────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────────

const pendingDonations = [];   // Antrian untuk Roblox
const donationLog      = [];   // Log 50 donasi terakhir
let donationCounter    = 1;
let sseStatus          = "disconnected";
let sseRetries         = 0;
let esInstance         = null;

// ──────────────────────────────────────────────
//  KONEKSI SSE KE SAWERIA
// ──────────────────────────────────────────────

function connectSaweriaSSE() {
    console.log(`[SSE] Menghubungkan ke Saweria... (percobaan ${sseRetries + 1})`);
    console.log(`[SSE] URL: ${SAWERIA_SSE_URL}`);
    sseStatus = "connecting";

    // Tutup koneksi lama jika ada
    if (esInstance) {
        try { esInstance.close(); } catch(e) {}
    }

    esInstance = new EventSource(SAWERIA_SSE_URL, {
        headers: {
            "Origin":     "https://saweria.co",
            "Referer":    "https://saweria.co/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }
    });

    esInstance.onopen = () => {
        sseStatus  = "connected";
        sseRetries = 0;
        console.log("[SSE] ✅ Terhubung ke Saweria!");
    };

    // Saweria mengirim event bernama "donation"
    esInstance.addEventListener("donation", (event) => {
        try {
            console.log("[SSE] Event donation:", event.data);
            const parsed = JSON.parse(event.data);

            // Saweria format: { data: [{amount, donator, message, ...}] }
            // atau langsung array
            let donations = [];
            if (parsed.data && Array.isArray(parsed.data)) {
                donations = parsed.data;
            } else if (Array.isArray(parsed)) {
                donations = parsed;
            } else if (parsed.amount !== undefined) {
                donations = [parsed];
            }

            donations.forEach((d) => {
                const donation = {
                    id:      donationCounter++,
                    name:    d.donator || d.donator_name || d.name || "Anonim",
                    amount:  parseInt(d.amount || 0, 10),
                    message: d.message || "",
                    ts:      new Date().toISOString(),
                };

                if (donation.amount > 0) {
                    pendingDonations.push(donation);
                    donationLog.unshift(donation);
                    if (donationLog.length > 50) donationLog.pop();
                    console.log(`[Donasi] ${donation.name} -> Rp ${donation.amount.toLocaleString("id-ID")} | "${donation.message}"`);
                }
            });

        } catch (err) {
            console.error("[SSE] Gagal parse donation event:", err.message, event.data);
        }
    });

    // Tangkap semua event (termasuk default "message")
    esInstance.onmessage = (event) => {
        try {
            if (!event.data || event.data === ":") return;
            console.log("[SSE] Raw message:", event.data?.slice(0, 100));

            const parsed = JSON.parse(event.data);

            // Cek apakah ada data donasi
            const d = parsed.data || parsed;
            const name = d.donator || d.donator_name || d.name;
            const amount = parseInt(d.amount || 0, 10);

            if (name && amount > 0) {
                const donation = {
                    id:      donationCounter++,
                    name,
                    amount,
                    message: d.message || "",
                    ts:      new Date().toISOString(),
                };
                pendingDonations.push(donation);
                donationLog.unshift(donation);
                if (donationLog.length > 50) donationLog.pop();
                console.log(`[Donasi via msg] ${donation.name} -> Rp ${donation.amount}`);
            }
        } catch (e) {
            // Bukan JSON, abaikan (biasanya ping/heartbeat)
        }
    };

    esInstance.onerror = (err) => {
        sseStatus = "error";
        sseRetries++;
        const delay = Math.min(5000 * sseRetries, 30000);
        console.error(`[SSE] Error / terputus. Reconnect dalam ${delay / 1000}s...`);
        try { esInstance.close(); } catch(e) {}
        setTimeout(connectSaweriaSSE, delay);
    };
}

// ──────────────────────────────────────────────
//  MIDDLEWARE
// ──────────────────────────────────────────────

app.use(express.json());

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin",  "*");
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

function checkKey(req, res, next) {
    const key = req.headers["x-api-key"] || req.query.key;
    if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
    next();
}

// ──────────────────────────────────────────────
//  ENDPOINT: GET /donations
//  Dipanggil SaweriaServer.lua setiap 15 detik
//  Ambil semua pending, lalu kosongkan antrian
// ──────────────────────────────────────────────

app.get("/donations", checkKey, (req, res) => {
    const toSend = [...pendingDonations];
    pendingDonations.length = 0;

    res.json({
        donations: toSend,
        count:     toSend.length,
        sse_status: sseStatus,
        ts:        new Date().toISOString(),
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /log
// ──────────────────────────────────────────────

app.get("/log", checkKey, (req, res) => {
    res.json({
        donations:  donationLog.slice(0, 20),
        pending:    pendingDonations.length,
        sse_status: sseStatus,
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
    console.log(`[Test] ${donation.name} -> Rp ${donation.amount}`);
    res.json({ success: true, donation });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /health
// ──────────────────────────────────────────────

app.get("/health", (req, res) => {
    res.json({
        status:      "ok",
        sse_status:  sseStatus,
        sse_retries: sseRetries,
        pending:     pendingDonations.length,
        logged:      donationLog.length,
        uptime:      Math.floor(process.uptime()) + "s",
        stream_key:  STREAM_KEY.slice(0, 8) + "...",
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /
// ──────────────────────────────────────────────

app.get("/", (req, res) => {
    const c = sseStatus === "connected" ? "#6bcb77" : sseStatus === "connecting" ? "#ffd93d" : "#ff6b6b";
    res.send(`<html><body style="font-family:monospace;background:#0a0a14;color:#eee;padding:32px;line-height:2">
        <h2>⚡ Saweria Bridge Server</h2>
        <p>SSE Status : <b style="color:${c}">${sseStatus.toUpperCase()}</b></p>
        <p>Pending    : <b>${pendingDonations.length}</b> donasi</p>
        <p>Logged     : <b>${donationLog.length}</b> donasi</p>
        <p>Uptime     : ${Math.floor(process.uptime())}s</p>
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

server.listen(PORT, () => {
    console.log("================================================");
    console.log("  ⚡ Saweria Bridge Server AKTIF (SSE Mode)");
    console.log(`  Port       : ${PORT}`);
    console.log(`  StreamKey  : ${STREAM_KEY.slice(0, 8)}...`);
    console.log(`  API Key    : ${API_KEY}`);
    console.log(`  SSE URL    : ${SAWERIA_SSE_URL}`);
    console.log("================================================");

    connectSaweriaSSE();
});
