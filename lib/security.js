// Shared server-side helpers for the Jadnix Tech API (Cloudflare Pages Functions).
// Uses only Web standards (Web Crypto, fetch) — no npm packages, no Node APIs.
// Storage: one Cloudflare KV namespace bound to the project as  JADNIX_KV.
import { DEFAULT_ADMIN } from "./credentials.js";
import { hashPassword, verifyPassword, toB64url, fromB64url, constantTimeEqual } from "./password.js";

const enc = new TextEncoder();
export const COOKIE = "jx_admin";
const SESSION_SECONDS = 8 * 60 * 60;            // 8-hour admin session

/* ── Storage ── */
export class StorageMissing extends Error {
  constructor() {
    super("Storage isn't connected yet. In Cloudflare: Workers & Pages → your project → Settings → Bindings → Add → KV namespace, variable name JADNIX_KV. Then redeploy.");
  }
}
export function kv(env) {
  if (!env || !env.JADNIX_KV) throw new StorageMissing();
  return env.JADNIX_KV;
}
export async function readJSON(env, key) {
  try { return (await kv(env).get(key, { type: "json" })) ?? null; }
  catch (e) { if (e instanceof StorageMissing) throw e; return null; }
}

/* ── Responses ── */
const baseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...baseHeaders, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}
export const error = (status, message, extra) => json({ error: message }, status, extra);

// Wraps a handler so storage/setup problems give a clear message instead of a crash.
export const safe = handler => async ctx => {
  try { return await handler(ctx); }
  catch (e) {
    if (e instanceof StorageMissing) return error(503, e.message);
    console.error(e);
    return error(500, "Something went wrong. Please try again.");
  }
};
export const clientIp = request => request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";

/* ── Small crypto helpers ── */
export function randomHex(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(text))));
  return [...d].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function safeEqualStr(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(String(a))), crypto.subtle.digest("SHA-256", enc.encode(String(b)))]);
  return constantTimeEqual(new Uint8Array(ha), new Uint8Array(hb));
}
const hmacKey = secret => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/* ── Credentials (built in — nothing to configure) ──
   1. Password changed in the portal  → KV key "auth:credentials" (hashed)
   2. Optional ADMIN_USERNAME + ADMIN_PASSWORD_HASH environment variables
   3. Built-in default in lib/credentials.js (hash only) */
const envStr = (env, name) => (typeof env?.[name] === "string" ? env[name].trim().replace(/^["']|["']$/g, "").trim() : "");

export async function getCredentials(env) {
  const saved = await readJSON(env, "auth:credentials");
  if (saved && saved.username && saved.passwordHash) return { user: saved.username, hash: saved.passwordHash, source: "portal" };
  const eu = envStr(env, "ADMIN_USERNAME"), eh = envStr(env, "ADMIN_PASSWORD_HASH");
  if (eu && eh) return { user: eu, hash: eh, source: "env" };
  return { user: DEFAULT_ADMIN.username, hash: DEFAULT_ADMIN.passwordHash, source: "built-in" };
}

/* ── Session signing key: created automatically on first use and stored in KV ── */
let secretCache = { value: null, at: 0 };
async function sessionSecret(env) {
  const fromEnv = envStr(env, "SESSION_SECRET");
  if (fromEnv.length >= 32) return fromEnv;
  if (secretCache.value && Date.now() - secretCache.at < 60_000) return secretCache.value;
  let s = await kv(env).get("auth:session-secret");
  if (!s || s.length < 32) {
    s = randomHex(32);
    await kv(env).put("auth:session-secret", s);
  }
  secretCache = { value: s, at: Date.now() };
  return s;
}
async function rotateSessionSecret(env) {
  const s = randomHex(32);
  await kv(env).put("auth:session-secret", s);
  secretCache = { value: s, at: Date.now() };
}

/* ── Signed session cookie (HMAC-SHA256) ── */
async function sign(payload, secret) {
  const body = toB64url(enc.encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${toB64url(mac)}`;
}
async function unsign(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(mac), enc.encode(body));   // constant-time
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return data && data.exp > Date.now() / 1000 ? data : null;
  } catch { return null; }
}
function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export async function sessionCookie(env, user) {
  const token = await sign({ u: user, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, n: randomHex(8) }, await sessionSecret(env));
  return `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function currentUser(env, request) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const s = await unsign(token, await sessionSecret(env));
  return s ? s.u : null;
}

/* ── CSRF: state-changing admin requests must come from this site, via our script ── */
export function sameOrigin(request, { requireHeader = true } = {}) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("Origin");
  const host = request.headers.get("Host");
  if (!origin || !host) return false;
  try { if (new URL(origin).host !== host) return false; } catch { return false; }
  return requireHeader ? request.headers.get("X-Jadnix-Admin") === "1" : true;
}
export async function requireAdmin({ env, request }) {
  if (!sameOrigin(request)) return error(403, "Forbidden.");
  if (!(await currentUser(env, request))) return error(401, "Please log in.");
  return null;
}

/* ── Rate limiting (stored in KV, auto-expiring) ──
   Login: 5 failed attempts per IP → locked 30 minutes; 40 failed site-wide per hour → all logins paused. */
const IP_MAX = 5, IP_LOCK_MS = 30 * 60 * 1000, IP_WINDOW_MS = 30 * 60 * 1000;
const GLOBAL_MAX = 40, GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const ipKey = async (prefix, ip) => `${prefix}:${(await sha256Hex(ip)).slice(0, 32)}`;

export async function loginBlocked(env, ip) {
  const now = Date.now();
  const rec = await readJSON(env, await ipKey("auth:ip", ip));
  if (rec && rec.lockedUntil > now) return Math.ceil((rec.lockedUntil - now) / 60000);
  const g = await readJSON(env, "auth:global");
  if (g && now - g.start < GLOBAL_WINDOW_MS && g.fails >= GLOBAL_MAX) return Math.ceil((g.start + GLOBAL_WINDOW_MS - now) / 60000);
  return 0;
}
async function recordFailure(env, ip) {
  const now = Date.now(), key = await ipKey("auth:ip", ip);
  let rec = await readJSON(env, key);
  if (!rec || now - rec.start > IP_WINDOW_MS) rec = { start: now, fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= IP_MAX) rec.lockedUntil = now + IP_LOCK_MS;
  await kv(env).put(key, JSON.stringify(rec), { expirationTtl: 3600 });
  let g = await readJSON(env, "auth:global");
  if (!g || now - g.start > GLOBAL_WINDOW_MS) g = { start: now, fails: 0 };
  g.fails += 1;
  await kv(env).put("auth:global", JSON.stringify(g), { expirationTtl: 7200 });
  return Math.max(0, IP_MAX - rec.fails);
}
async function clearFailures(env, ip) { try { await kv(env).delete(await ipKey("auth:ip", ip)); } catch {} }
const tooMany = wait => `Too many attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`;
const slowDown = () => new Promise(r => setTimeout(r, 300 + Math.random() * 300));

export async function checkLogin(env, ip, username, password) {
  const wait = await loginBlocked(env, ip);
  if (wait) return { ok: false, status: 429, message: tooMany(wait) };
  const cred = await getCredentials(env);
  // Always run the hash so wrong usernames take as long as wrong passwords.
  const [passOk, userOk] = await Promise.all([
    verifyPassword(password, cred.hash),
    safeEqualStr(String(username).trim().toLowerCase(), cred.user.trim().toLowerCase()),
  ]);
  if (passOk && userOk) { await clearFailures(env, ip); return { ok: true, user: cred.user }; }
  const left = await recordFailure(env, ip);
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
export async function changePassword(env, ip, current, next) {
  const wait = await loginBlocked(env, ip);
  if (wait) return { ok: false, status: 429, message: tooMany(wait) };
  const cred = await getCredentials(env);
  if (!(await verifyPassword(current, cred.hash))) {
    const left = await recordFailure(env, ip);
    await slowDown();
    return { ok: false, status: left ? 401 : 429, message: left ? "Your current password is incorrect." : tooMany(30) };
  }
  const problem = passwordProblem(next, cred.user);
  if (problem) return { ok: false, status: 400, message: problem };
  if (await verifyPassword(next, cred.hash)) return { ok: false, status: 400, message: "Choose a password you haven't used here before." };
  await kv(env).put("auth:credentials", JSON.stringify({ username: cred.user, passwordHash: await hashPassword(next), changedAt: new Date().toISOString() }));
  await rotateSessionSecret(env);                // signs out every other session
  await clearFailures(env, ip);
  return { ok: true, user: cred.user };
}

/* ── Portfolio ── */
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

export const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
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
export const newId = prefix => `${prefix}_${Date.now().toString(36)}${randomHex(6)}`;
export const ID_RE = /^[a-z]{1,4}_[a-z0-9]{8,40}$/;

export async function loadItems(env) {
  const data = await readJSON(env, "portfolio:items");
  return Array.isArray(data) ? data : DEFAULT_ITEMS.map(i => ({ ...i }));
}
export const saveItems = (env, items) => kv(env).put("portfolio:items", JSON.stringify(items));
export const publicItem = i => ({
  id: i.id, title: i.title, category: i.category, year: i.year, description: i.description,
  url: i.url, image: i.imageId ? `/api/image/${i.imageId}` : "", visible: i.visible,
});

/* ── Contact enquiries ── */
export const SERVICES = ["New website", "Website redesign", "Custom software", "Software modifications", "CRM setup or custom CRM", "Care & support plan", "Not sure yet", ""];
export function validateEnquiry(f) {
  const errors = {};
  const name = clean(f.name, 100), email = clean(f.email, 200), phone = clean(f.phone, 30);
  const message = clean(f.message, 3000), service = SERVICES.includes(f.service) ? f.service : "";
  if (name.length < 2) errors.name = "Please enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Please enter a valid email address.";
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) errors.phone = "Please enter a valid phone number.";
  if (message.length < 10) errors.message = "Please tell me a little about your project.";
  if (f.consent !== "yes") errors.consent = "Please tick the consent box.";
  return Object.keys(errors).length ? { errors } : { enquiry: { name, email, phone, service, message } };
}
// 5 enquiries per IP per hour, 60 site-wide per hour.
export async function contactAllowed(env, ip) {
  const now = Date.now(), key = await ipKey("contact:ip", ip);
  const rec = (await readJSON(env, key)) || { start: now, n: 0 };
  if (now - rec.start > 3600_000) { rec.start = now; rec.n = 0; }
  const g = (await readJSON(env, "contact:global")) || { start: now, n: 0 };
  if (now - g.start > 3600_000) { g.start = now; g.n = 0; }
  if (rec.n >= 5 || g.n >= 60) return false;
  rec.n += 1; g.n += 1;
  await kv(env).put(key, JSON.stringify(rec), { expirationTtl: 7200 });
  await kv(env).put("contact:global", JSON.stringify(g), { expirationTtl: 7200 });
  return true;
}
