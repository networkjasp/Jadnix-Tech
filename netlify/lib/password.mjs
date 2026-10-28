// Password hashing (scrypt). Kept separate so scripts/setup-admin.mjs can run without dependencies.
import { scryptSync, timingSafeEqual, randomBytes } from "node:crypto";

/* ── Password hashing: "scrypt:N:r:p:salt:hash" (base64url) ── */
export function hashPassword(password, salt = randomBytes(16)) {
  const N = 32768, r = 8, p = 1;
  const key = scryptSync(String(password).normalize("NFKC"), salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join(":");
}
export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, keyB64] = String(stored).split(":");
    if (alg !== "scrypt") return false;
    const n = Number(N), rr = Number(r), pp = Number(p);
    const expected = Buffer.from(keyB64, "base64url");
    const key = scryptSync(String(password).normalize("NFKC"), Buffer.from(saltB64, "base64url"), expected.length,
      { N: n, r: rr, p: pp, maxmem: 128 * n * rr * 2 });
    return timingSafeEqual(key, expected);
  } catch { return false; }
}
