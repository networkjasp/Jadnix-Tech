// Password hashing with PBKDF2-HMAC-SHA256 (Web Crypto) — works on Cloudflare and in Node 20+.
// Stored format:  pbkdf2-sha256:<iterations>:<salt base64url>:<hash base64url>
// 100,000 iterations is the highest count Cloudflare's Web Crypto reliably supports; combined
// with rate limiting and the 12+ character password policy this resists offline guessing.
export const ITERATIONS = 100000;
const enc = new TextEncoder();

export function toB64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(str) {
  const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derive(password, salt, iterations, bytes = 32) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(password).normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, bytes * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const hash = await derive(password, salt, ITERATIONS);
  return ["pbkdf2-sha256", ITERATIONS, toB64url(salt), toB64url(hash)].join(":");
}

export async function verifyPassword(password, stored) {
  try {
    const [alg, iter, saltB64, hashB64] = String(stored).split(":");
    const iterations = Number(iter);
    if (alg !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 10000 || iterations > 100000) return false;
    const expected = fromB64url(hashB64);
    const actual = await derive(password, fromB64url(saltB64), iterations, expected.length);
    return constantTimeEqual(actual, expected);
  } catch { return false; }
}
