import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "index.html");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const redisUrl = process.env.REDIS_URL || "";
const adminToken = process.env.ADMIN_TOKEN || "";

const redisState = {
  enabled: redisUrl.length > 0,
  connected: false,
  lastError: null
};

let redis = null;
if (redisState.enabled) {
  redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true
  });

  redis.on("ready", () => {
    redisState.connected = true;
    redisState.lastError = null;
  });

  redis.on("end", () => {
    redisState.connected = false;
  });

  redis.on("error", (err) => {
    redisState.connected = false;
    redisState.lastError = err instanceof Error ? err.message : String(err);
  });

  try {
    await redis.connect();
  } catch (err) {
    redisState.lastError = err instanceof Error ? err.message : String(err);
  }
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function text(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(payload);
}

async function serveIndex(res) {
  try {
    const html = await fs.readFile(indexPath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    text(res, 500, "Unable to load index.html");
  }
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });

    req.on("error", reject);
  });
}

function clampDays(days) {
  if (!Number.isFinite(days)) return 7;
  return Math.min(30, Math.max(1, Math.floor(days)));
}

function isValidEventName(eventName) {
  return typeof eventName === "string" && /^[a-z0-9_:-]{1,64}$/i.test(eventName);
}

function isValidSessionId(sessionId) {
  return typeof sessionId === "string" && /^[a-z0-9-]{6,80}$/i.test(sessionId);
}

function utcDateOffset(daysBack) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

async function storeEvent({ eventName, sessionId }) {
  if (!redis || !redisState.connected) {
    return false;
  }

  const date = utcDateOffset(0);
  const eventKey = `keccak:events:${date}`;
  const sessionKey = `keccak:sessions:${date}`;

  try {
    const tx = redis.multi();
    tx.hincrby(eventKey, eventName, 1);
    tx.hincrby(eventKey, "_total", 1);
    tx.expire(eventKey, 60 * 60 * 24 * 120);

    if (isValidSessionId(sessionId)) {
      tx.sadd(sessionKey, sessionId);
      tx.expire(sessionKey, 60 * 60 * 24 * 120);
    }

    await tx.exec();
    return true;
  } catch (err) {
    redisState.lastError = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function buildHealth() {
  let pingMs = null;
  if (redis && redisState.connected) {
    const started = Date.now();
    try {
      await redis.ping();
      pingMs = Date.now() - started;
    } catch (err) {
      redisState.connected = false;
      redisState.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    status: "ok",
    service: "keccak-model",
    timestamp: new Date().toISOString(),
    redis: {
      enabled: redisState.enabled,
      connected: redisState.connected,
      pingMs,
      lastError: redisState.lastError
    }
  };
}

async function buildStats(days) {
  const result = [];
  for (let i = 0; i < days; i += 1) {
    const date = utcDateOffset(i);
    const eventKey = `keccak:events:${date}`;
    const sessionKey = `keccak:sessions:${date}`;

    const [events, sessionCount] = await Promise.all([
      redis.hgetall(eventKey),
      redis.scard(sessionKey)
    ]);

    result.push({
      date,
      events,
      uniqueSessions: Number(sessionCount)
    });
  }

  return result;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/keccak")) {
    await serveIndex(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const payload = await buildHealth();
    json(res, 200, payload);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/events") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const errorCode = err instanceof Error ? err.message : "invalid_request";
      json(res, 400, { error: errorCode });
      return;
    }

    const eventName = body.event;
    const sessionId = body.sessionId;

    if (!isValidEventName(eventName)) {
      json(res, 400, { error: "invalid_event_name" });
      return;
    }

    const stored = await storeEvent({ eventName, sessionId });
    json(res, 202, {
      ok: true,
      stored,
      redisEnabled: redisState.enabled
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    if (!adminToken) {
      json(res, 403, { error: "admin_token_not_configured" });
      return;
    }

    const suppliedToken = req.headers["x-admin-token"] || url.searchParams.get("token");
    if (suppliedToken !== adminToken) {
      json(res, 401, { error: "unauthorized" });
      return;
    }

    if (!redis || !redisState.connected) {
      json(res, 503, { error: "redis_unavailable", lastError: redisState.lastError });
      return;
    }

    try {
      const days = clampDays(Number.parseInt(url.searchParams.get("days") || "7", 10));
      const stats = await buildStats(days);
      json(res, 200, { days, stats });
    } catch (err) {
      json(res, 500, { error: "stats_query_failed", detail: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  text(res, 404, "Not found");
});

let shuttingDown = false;
async function closeServer() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  await new Promise((resolve) => {
    server.close(() => resolve());
  });

  if (redis) {
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }

  process.exit(0);
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);

server.listen(port, host, () => {
  console.log(`Keccak app listening on http://${host}:${port}`);
});
