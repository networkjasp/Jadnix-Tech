// Built-in admin login for the portfolio manager.
//
// • Runs only on the server (Cloudflare Pages Functions) — never sent to browsers.
// • Stores a PBKDF2 HASH of the password, never the password itself.
// • After you sign in, use "Change password" in the portal. The new password is saved
//   (hashed) in Cloudflare KV and replaces this built-in one.
// • Forgot your changed password? Cloudflare → Storage & Databases → Workers KV →
//   your namespace → delete the key "auth:credentials". The login falls back to this one.
//
// To set a different built-in password:  node scripts/setup-admin.mjs <username> "<password>"
// and paste the printed values here.

export const DEFAULT_ADMIN = Object.freeze({
  username: "jadian",
  passwordHash: "pbkdf2-sha256:100000:xEdeOZpoTmsuN48ogR54Aw:i4lKtEhbXbJAk4Pr3oyl8TXLsHuNIGrN5pvjCGWyEGg",
});
