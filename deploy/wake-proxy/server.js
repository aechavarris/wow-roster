"use strict";
// Wake-proxy: the always-on "front door" that holds the public URL (via Tailscale Funnel on this
// host) while the real server (the Steam Machine) sleeps. On each request it checks whether the
// backend answers; if it does, it reverse-proxies the request; if it does not, it sends a
// Wake-on-LAN magic packet to the backend's MAC and returns a small auto-refreshing "waking" page.
// Built-in modules only, so the container needs no npm install.
const http = require("node:http");
const net = require("node:net");
const dgram = require("node:dgram");

const cfg = {
  listenPort: Number(process.env.LISTEN_PORT || 8080),
  backendHost: process.env.BACKEND_HOST || "",
  backendPort: Number(process.env.BACKEND_PORT || 80),
  targetMac: process.env.TARGET_MAC || "",
  wolBroadcast: process.env.WOL_BROADCAST || "255.255.255.255",
  wolPorts: (process.env.WOL_PORTS || "9,7").split(",").map((p) => Number(p.trim())).filter(Boolean),
  probeTimeoutMs: Number(process.env.PROBE_TIMEOUT_MS || 800),
  wakeDebounceMs: Number(process.env.WAKE_DEBOUNCE_MS || 5000),
  retryAfterS: Number(process.env.RETRY_AFTER_S || 8),
};

/** Build the 102-byte Wake-on-LAN magic packet for a MAC like "aa:bb:cc:dd:ee:ff". Pure, so it is unit-tested. */
function buildMagicPacket(mac) {
  const bytes = mac.trim().split(/[:-]/).map((h) => parseInt(h, 16));
  if (bytes.length !== 6 || bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  const packet = Buffer.alloc(102, 0xff); // first 6 bytes are already 0xff
  for (let i = 1; i <= 16; i++) Buffer.from(bytes).copy(packet, i * 6);
  return packet;
}

let lastWakeAt = 0;
/** Broadcast the magic packet on the LAN (debounced), so a flood of requests does not spam the NIC. */
function sendWol() {
  const now = Date.now();
  if (now - lastWakeAt < cfg.wakeDebounceMs) return;
  lastWakeAt = now;
  let packet;
  try {
    packet = buildMagicPacket(cfg.targetMac);
  } catch (err) {
    console.error(`[wake-proxy] ${err.message}`);
    return;
  }
  const sock = dgram.createSocket("udp4");
  sock.once("error", (err) => { console.error(`[wake-proxy] WoL socket: ${err.message}`); sock.close(); });
  sock.bind(() => {
    sock.setBroadcast(true);
    let left = cfg.wolPorts.length;
    for (const port of cfg.wolPorts) {
      sock.send(packet, 0, packet.length, port, cfg.wolBroadcast, (err) => {
        if (err) console.error(`[wake-proxy] WoL send :${port}: ${err.message}`);
        if (--left === 0) sock.close();
      });
    }
    console.log(`[wake-proxy] sent WoL to ${cfg.targetMac} via ${cfg.wolBroadcast}:${cfg.wolPorts.join(",")}`);
  });
}

/** True if the backend accepts a TCP connection within the probe timeout. */
function probeBackend() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: cfg.backendHost, port: cfg.backendPort });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); resolve(ok); };
    sock.setTimeout(cfg.probeTimeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

function wakingPage(res) {
  const body = `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="refresh" content="${cfg.retryAfterS}">` +
    `<title>Arrancando…</title><style>body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eee;` +
    `display:grid;place-items:center;height:100vh;margin:0;text-align:center}.c{max-width:28rem;padding:1.5rem}` +
    `.s{width:2.5rem;height:2.5rem;border:3px solid #333;border-top-color:#e6a817;border-radius:50%;` +
    `margin:0 auto 1rem;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}</style></head>` +
    `<body><div class="c"><div class="s"></div><h1>Arrancando el servidor…</h1>` +
    `<p>La página se recargará sola en unos segundos.</p></div></body></html>`;
  res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(cfg.retryAfterS) });
  res.end(body);
}

/** Pipe one client request to the backend and the backend response back to the client. */
function proxy(clientReq, clientRes) {
  const headers = { ...clientReq.headers };
  const options = {
    host: cfg.backendHost,
    port: cfg.backendPort,
    method: clientReq.method,
    path: clientReq.url,
    headers,
  };
  const upstream = http.request(options, (upRes) => {
    clientRes.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(clientRes);
  });
  upstream.on("error", (err) => {
    console.error(`[wake-proxy] upstream error: ${err.message}`);
    if (!clientRes.headersSent) { sendWol(); wakingPage(clientRes); }
    else clientRes.destroy();
  });
  clientReq.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  // A tiny health endpoint for this host's own monitoring; never forwarded.
  if (req.url === "/healthz") { res.writeHead(200).end("ok"); return; }
  if (await probeBackend()) {
    proxy(req, res);
  } else {
    sendWol();
    wakingPage(res);
  }
});

if (require.main === module) {
  if (!cfg.backendHost || !cfg.targetMac) {
    console.error("[wake-proxy] set BACKEND_HOST and TARGET_MAC");
    process.exit(1);
  }
  server.listen(cfg.listenPort, () => {
    console.log(`[wake-proxy] listening on :${cfg.listenPort} → ${cfg.backendHost}:${cfg.backendPort}, wakes ${cfg.targetMac}`);
  });
}

module.exports = { buildMagicPacket };
