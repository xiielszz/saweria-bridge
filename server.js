// ================================================================
//  SAWERIA BRIDGE SERVER — WebSocket Edition
//  Menggunakan streamKey resmi Saweria (tanpa cookie/login)
//
//  Deploy: Glitch.com / Railway.app / Render.com (gratis)
//  Tech  : Node.js + Express + ws (WebSocket client)
// ================================================================

const express   = require("express");
const WebSocket = require("ws");
const http      = require("http");

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  KONFIGURASI
// ──────────────────────────────────────────────

const STREAM_KEY = process.env.STREAM_KEY || "5ce6991001bcac3ed38990f430ff8247";
const API_KEY    = process.env.API_KEY    || "roblox-saweria-secret-2025";

const SAWERIA_WS = `wss://events.saweria.co/stream?streamKey=${STREAM_KEY}`;

// ──────────────────────────────────────────────
//  ANTRIAN DONASI (in-memory)
// ──────────────────────────────────────────────

const pendingDonations = [];
const donationLog      = [];
let donationCounter    = 1;
let wsStatus           = "disconnected";
let wsRetries          = 0;

// ──────────────────────────────────────────────
//  WEBSOCKET CLIENT — Konek ke Saweria
// ──────────────────────────────────────────────

function connectSaweriaWS() {
    console.log(`[WS] Menghubungkan ke Saweria... (percobaan ${wsRetries + 1})`);
    wsStatus = "connecting";

    const ws = new WebSocket(SAWERIA_WS, {
        headers: {
            "Origin":     "https://saweria.co",
            "User-Agent": "Mozilla/5.0",
        }
    });

    ws.on("open", () => {
        wsStatus  = "connected";
        wsRetries = 0;
        console.log("[WS] Terhubung ke Saweria WebSocket!");
    });

    ws.on("message", (rawData) => {
        try {
            const text  = rawData.toString();
            const event = JSON.parse(text);

            let name    = null;
            let amount  = null;
            let message = "";

            // Format 1: { type: "donation", data: { ... } }
            if (event.type === "donation" && event.data) {
                name    = event.data.donator_name || event.data.name || "Anonim";
                amount  = parseInt(event.data.amount || 0, 10);
                message = event.data.message || "";
            }
            // Format 2: { donator_name, amount, message }
            else if (event.donator_name || event.name) {
                name    = event.donator_name || event.name || "Anonim";
                amount  = parseInt(event.amount || 0, 10);
                message = event.message || "";
            }
            // Format 3: array of donations
            else if (Array.isArray(event)) {
                event.forEach(e => {
                    const d = {
                        id:      donationCounter++,
                        name:    e.donator_name || e.name || "Anonim",
                        amount:  parseInt(e.amount || 0, 10),
                        message: e.message || "",
                        ts:      new Date().toISOString(),
                    };
                    pendingDonations.push(d);
                    donationLog.unshift(d);
                    if (donationLog.length > 50) donationLog.pop();
                    console.log(`[Donasi] ${d.name} -> Rp ${d.amount} | "${d.message}"`);
                });
                return;
            }
            else {
                console.log("[WS] Event tidak dikenal:", text.slice(0, 100));
                return;
            }

            if (!name || amount === null) return;

            const donation = {
                id:      donationCounter++,
                name,
                amount,
                message,
                ts:      new Date().toISOString(),
            };

            pendingDonations.push(donation);
            donationLog.unshift(donation);
            if (donationLog.length > 50) donationLog.pop();

            console.log(`[Donasi] ${donation.name} -> Rp ${donation.amount} | "${donation.message}"`);

        } catch (err) {
            console.error("[WS] Gagal parse:", err.message);
        }
    });

    ws.on("close", (code) => {
        wsStatus = "disconnected";
        wsRetries++;
        const delay = Math.min(5000 * wsRetries, 30000);
        console.log(`[WS] Terputus (${code}). Reconnect dalam ${delay / 1000}s...`);
        setTimeout(connectSaweriaWS, delay);
    });

    ws.on("error", (err) => {
        wsStatus = "error";
        console.error("[WS] Error:", err.message);
    });
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
//  Dipanggil SaweriaServer.lua setiap polling
//  Ambil donasi pending lalu kosongkan antrian
// ──────────────────────────────────────────────

app.get("/donations", checkKey, (req, res) => {
    const toSend = [...pendingDonations];
    pendingDonations.length = 0;

    res.json({
        donations: toSend,
        count:     toSend.length,
        ws_status: wsStatus,
        ts:        new Date().toISOString(),
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /log
//  Lihat 20 donasi terakhir
// ──────────────────────────────────────────────

app.get("/log", checkKey, (req, res) => {
    res.json({
        donations: donationLog.slice(0, 20),
        pending:   pendingDonations.length,
        ws_status: wsStatus,
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /test
//  Kirim donasi palsu untuk testing
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
        status:     "ok",
        ws_status:  wsStatus,
        ws_retries: wsRetries,
        pending:    pendingDonations.length,
        logged:     donationLog.length,
        uptime:     Math.floor(process.uptime()) + "s",
        stream_key: STREAM_KEY.slice(0, 8) + "...",
    });
});

// ──────────────────────────────────────────────
//  ENDPOINT: GET /
// ──────────────────────────────────────────────

app.get("/", (req, res) => {
    const c = wsStatus === "connected" ? "#6bcb77" : "#ff6b6b";
    res.send(`<html><body style="font-family:monospace;background:#0a0a14;color:#eee;padding:32px;line-height:2">
        <h2>Saweria Bridge Server</h2>
        <p>WebSocket: <b style="color:${c}">${wsStatus.toUpperCase()}</b></p>
        <p>Pending   : <b>${pendingDonations.length}</b> donasi</p>
        <p>Uptime    : ${Math.floor(process.uptime())}s</p>
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
    console.log("  Saweria Bridge Server AKTIF");
    console.log(`  Port      : ${PORT}`);
    console.log(`  StreamKey : ${STREAM_KEY.slice(0, 8)}...`);
    console.log(`  API Key   : ${API_KEY}`);
    console.log("================================================");
    connectSaweriaWS();
});
