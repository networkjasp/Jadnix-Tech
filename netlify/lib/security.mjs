// Shared server-side helpers for the Jadnix admin API.
// Runs only inside Netlify Functions — nothing here is ever sent to the browser.
import { createHmac, timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { verifyPassword, hashPassword } from "./password.mjs";
import { DEFAULT_ADMIN } from "./credentials.mjs";
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

/* ── Credentials (built in — no Netlify setup needed) ──
   Order of precedence:
   1. Password changed in the portal  → stored (hashed) in Netlify Blobs
   2. Optional environment variables  → ADMIN_USERNAME + ADMIN_PASSWORD_HASH
   3. Built-in default                 → netlify/lib/credentials.mjs (hash only) */
function envVar(name) {
  let v;
  try { v = globalThis.Netlify?.env?.get(name); } catch {}
  if (v == null || v === "") v = process.env[name];
  return typeof v === "string" ? v.trim().replace(/^["']|["']$/g, "").trim() : "";
}
async function readJSON(store, key) { try { return (await store.get(key, { type: "json" })) || null; } catch { return null; } }

export async function getCredentials() {
  const saved = await readJSON(authStore(), "credentials");
  if (saved && saved.username && saved.passwordHash) return { user: saved.username, hash: saved.passwordHash, source: "portal" };
  const eu = envVar("ADMIN_USERNAME"), eh = envVar("ADMIN_PASSWORD_HASH");
  if (eu && eh) return { user: eu, hash: eh, source: "env" };
  return { user: DEFAULT_ADMIN.username, hash: DEFAULT_ADMIN.passwordHash, source: "built-in" };
}

/* ── Session signing key: created automatically on first use and kept in Netlify Blobs.
   (An optional SESSION_SECRET environment variable overrides it.) Cached for 60s. ── */
let secretCache = { value: null, at: 0 };
async function sessionSecret() {
  const env = envVar("SESSION_SECRET");
  if (env.length >= 32) return env;
  if (secretCache.value && Date.now() - secretCache.at < 60_000) return secretCache.value;
  const store = authStore();
  let s = null;
  try { s = await store.get("session-secret"); } catch {}
  if (!s || s.length < 32) {
    try { await store.set("session-secret", randomBytes(32).toString("hex"), { onlyIfNew: true }); } catch {}
    try { s = await store.get("session-secret"); } catch {}
  }
  if (!s || s.length < 32) throw new Error("Session key unavailable");
  secretCache = { value: s, at: Date.now() };
  return s;
}
async function rotateSessionSecret() {
  const s = randomBytes(32).toString("hex");
  await authStore().set("session-secret", s);
  secretCache = { value: s, at: Date.now() };
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
export async function sessionCookie(user) {
  const token = sign({ u: user, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, n: randomBytes(8).toString("hex") }, await sessionSecret());
  return `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  try {
    const s = unsign(token, await sessionSecret());
    return s ? s.u : null;
  } catch { return null; }
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
export async function requireAdmin(req) {
  if (!sameOrigin(req)) return error(403, "Forbidden.");
  if (!(await currentUser(req))) return error(401, "Please log in.");
  return null;
}

/* ── Brute-force protection (rate limiting) ──
   Per IP:  5 failed attempts → locked for 30 minutes.
   Global: 40 failed attempts in an hour (from anywhere) → all logins paused until the hour resets. */
const IP_MAX = 5, IP_LOCK_MS = 30 * 60 * 1000, IP_WINDOW_MS = 30 * 60 * 1000;
const GLOBAL_MAX = 40, GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const ipKey = ip => "ip-" + createHash("sha256").update(String(ip || "unknown")).digest("hex").slice(0, 32);

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
const tooMany = wait => `Too many attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`;
const slowDown = () => new Promise(r => setTimeout(r, 400 + Math.random() * 400));

export async function checkLogin(ip, username, password) {
  const wait = await loginBlocked(ip);
  if (wait) return { ok: false, status: 429, message: tooMany(wait) };
  const cred = await getCredentials();
  // Always run the (slow) hash so wrong usernames take as long as wrong passwords.
  const passOk = verifyPassword(password, cred.hash);
  const userOk = safeEqualStr(String(username).trim().toLowerCase(), cred.user.trim().toLowerCase());
  if (passOk && userOk) { await clearFailures(ip); return { ok: true, user: cred.user }; }
  const left = await recordFailure(ip);
  await slowDown();
  return { ok: false, status: left ? 401 : 429, message: left ? "Invalid username or password." : tooMany(30) };
}

/* ── Password policy + change ── */
export function passwordProblem(pw, username) {
  if (typeof pw !== "string" || pw.length < 12) return "Use at least 12 characters.";
  if (pw.length > 200) return "That password is too long (max 200 characters).";
  const lower = pw.toLowerCase();
  if (username && lower.includes(String(username).toLowerCase())) return "Don't include your username in the password.";
  if (/^(.)\1+$/.test(pw) || /(password|qwerty|123456|letmein|admin)/.test(lower)) return "That password is too easy to guess.";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (pw.length < 16 && classes < 3) return "Mix at least three of: lowercase, uppercase, numbers, symbols — or use 16+ characters.";
  return null;
}
export async function changePassword(ip, user, current, next) {
  const wait = await loginBlocked(ip);
  if (wait) return { ok: false, status: 429, message: tooMany(wait) };
  const cred = await getCredentials();
  if (!verifyPassword(current, cred.hash)) {
    const left = await recordFailure(ip);
    await slowDown();
    return { ok: false, status: left ? 401 : 429, message: left ? "Your current password is incorrect." : tooMany(30) };
  }
  const problem = passwordProblem(next, cred.user);
  if (problem) return { ok: false, status: 400, message: problem };
  if (verifyPassword(next, cred.hash)) return { ok: false, status: 400, message: "Choose a password you haven't used here before." };
  await authStore().setJSON("credentials", { username: cred.user, passwordHash: hashPassword(next), changedAt: new Date().toISOString() });
  await rotateSessionSecret();          // signs out every other session
  await clearFailures(ip);
  return { ok: true, user: cred.user };
}

/* ── Portfolio validation ── */
export const CATEGORIES = ["Web", "Redesign", "E-commerce", "Web App", "Software", "CRM", "Dashboard", "Other"];
export const DEFAULT_ITEMS = [{
  id: "p_default01",
  title: "Jadnix Tech website",
  category: "Web",
  year: "2026",
  description: "This site: a fast, mobile-first studio website with security headers, a spam-protected contact form and a secure portfolio manager.",
  url: "https://www.jadnixtech.co.za/",
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
