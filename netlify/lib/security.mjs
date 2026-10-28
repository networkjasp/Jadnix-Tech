// Shared server-side helpers for the Jadnix admin API.
// Runs only inside Netlify Functions — nothing here is ever sent to the browser.
import { createHmac, timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { verifyPassword } from "./password.mjs";
import { getStore } from "@netlify/blobs";

export const COOKIE = "jx_admin";
const SESSION_SECONDS = 8 * 60 * 60;           // 8-hour admin session

/* ── Stores (Netlify Blobs, strongly consistent) ── */
export const portfolioStore = () => getStore({ name: "jx-portfolio", consistency: "strong" });
export const imageStore     = () => getStore({ name: "jx-images",    consistency: "strong" });
export const authStore      = () => getStore({ name: "jx-auth",      consistency: "strong" });

/* ── Responses ── */
const baseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...baseHeaders, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}
export const error = (status, message, extra) => json({ error: message }, status, extra);

/* ── Config (fails closed if anything is missing) ── */
function config() {
  const user = process.env.ADMIN_USERNAME;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.SESSION_SECRET;
  if (!user || !hash || !secret || secret.length < 32) return null;
  return { user, hash, secret };
}

function safeEqualStr(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/* ── Signed session cookie (HMAC-SHA256) ── */
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function unsign(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const good = createHmac("sha256", secret).update(body).digest("base64url");
  if (mac.length !== good.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return data && data.exp > Date.now() / 1000 ? data : null;
  } catch { return null; }
}
function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function sessionCookie(user) {
  const cfg = config();
  const token = sign({ u: user, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, n: randomBytes(8).toString("hex") }, cfg.secret);
  return `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function currentUser(req) {
  const cfg = config();
  if (!cfg) return null;
  const s = unsign(readCookie(req, COOKIE), cfg.secret);
  return s ? s.u : null;
}

/* ── CSRF: state-changing requests must come from this site, via our script ── */
export function sameOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!origin || !host) return false;
  try { if (new URL(origin).host !== host) return false; } catch { return false; }
  return req.headers.get("x-jadnix-admin") === "1";   // custom header forces a CORS preflight cross-site
}

/* Guard for every admin endpoint */
export function requireAdmin(req) {
  if (!config()) return error(503, "Admin is not configured on the server.");
  if (!sameOrigin(req)) return error(403, "Forbidden.");
  if (!currentUser(req)) return error(401, "Please log in.");
  return null;
}

/* ── Brute-force protection ──
   Per IP:  5 failed attempts → locked for 30 minutes.
   Global: 40 failed attempts in an hour (from anywhere) → all logins paused until the hour resets. */
const IP_MAX = 5, IP_LOCK_MS = 30 * 60 * 1000, IP_WINDOW_MS = 30 * 60 * 1000;
const GLOBAL_MAX = 40, GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const ipKey = ip => "ip-" + createHash("sha256").update(String(ip || "unknown")).digest("hex").slice(0, 32);

async function readJSON(store, key) { try { return (await store.get(key, { type: "json" })) || null; } catch { return null; } }

export async function loginBlocked(ip) {
  const store = authStore(), now = Date.now();
  const rec = await readJSON(store, ipKey(ip));
  if (rec && rec.lockedUntil > now) return Math.ceil((rec.lockedUntil - now) / 60000);
  const g = await readJSON(store, "global");
  if (g && now - g.start < GLOBAL_WINDOW_MS && g.fails >= GLOBAL_MAX) return Math.ceil((g.start + GLOBAL_WINDOW_MS - now) / 60000);
  return 0;
}
async function recordFailure(ip) {
  const store = authStore(), now = Date.now(), key = ipKey(ip);
  let rec = await readJSON(store, key);
  if (!rec || now - rec.start > IP_WINDOW_MS) rec = { start: now, fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= IP_MAX) rec.lockedUntil = now + IP_LOCK_MS;
  await store.setJSON(key, rec);
  let g = await readJSON(store, "global");
  if (!g || now - g.start > GLOBAL_WINDOW_MS) g = { start: now, fails: 0 };
  g.fails += 1;
  await store.setJSON("global", g);
  return Math.max(0, IP_MAX - rec.fails);
}
async function clearFailures(ip) { try { await authStore().delete(ipKey(ip)); } catch {} }

export async function checkLogin(ip, username, password) {
  const cfg = config();
  if (!cfg) return { ok: false, status: 503, message: "Admin is not configured on the server." };
  const wait = await loginBlocked(ip);
  if (wait) return { ok: false, status: 429, message: `Too many attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` };
  // Always run the (slow) hash so wrong usernames take as long as wrong passwords.
  const passOk = verifyPassword(password, cfg.hash);
  const userOk = safeEqualStr(String(username).trim().toLowerCase(), cfg.user.trim().toLowerCase());
  if (passOk && userOk) { await clearFailures(ip); return { ok: true, user: cfg.user }; }
  const left = await recordFailure(ip);
  await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
  return { ok: false, status: left ? 401 : 429, message: left ? "Invalid username or password." : "Too many attempts. Try again in 30 minutes." };
}

/* ── Portfolio validation ── */
export const CATEGORIES = ["Web", "Redesign", "E-commerce", "Web App", "Software", "CRM", "Dashboard", "Other"];
export const DEFAULT_ITEMS = [{
  id: "p_default01",
  title: "Jadnix Tech website",
  category: "Web",
  year: "2026",
  description: "This site: a fast, mobile-first studio website with security headers, a spam-protected contact form and a secure portfolio manager.",
  url: "https://jadnix-tech.netlify.app/",
  imageId: null,
  visible: true,
}];

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
export function cleanUrl(v) {
  const s = clean(v, 500);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch { return null; }
}
export function validateItem(input) {
  const title = clean(input.title, 120);
  if (!title) return { error: "Project title is required." };
  const url = cleanUrl(input.url);
  if (url === null) return { error: "Website URL must start with https:// or http://" };
  const category = CATEGORIES.includes(input.category) ? input.category : "Other";
  return {
    item: {
      title, url, category,
      year: clean(input.year, 10),
      description: clean(input.description, 600),
      visible: !(input.visible === false || input.visible === "false"),
    },
  };
}

/* ── Images: verify real image bytes, never trust the browser's file type ── */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export function sniffImage(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
export const newId = prefix => `${prefix}_${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
export const ID_RE = /^[a-z]{1,4}_[a-z0-9]{8,40}$/;

export async function loadItems() {
  const data = await readJSON(portfolioStore(), "items");
  return Array.isArray(data) ? data : DEFAULT_ITEMS.map(i => ({ ...i }));
}
export const saveItems = items => portfolioStore().setJSON("items", items);
export const publicItem = i => ({
  id: i.id, title: i.title, category: i.category, year: i.year, description: i.description,
  url: i.url, image: i.imageId ? `/api/image/${i.imageId}` : "", visible: i.visible,
});
