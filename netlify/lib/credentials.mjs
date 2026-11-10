// Built-in admin login for the portfolio manager.
//
// • This file runs only on the server (Netlify Functions). It is never sent to browsers.
// • It stores a scrypt HASH of the password, never the password itself.
// • After you sign in, use "Change password" in the portal. The new password is saved
//   (hashed) in Netlify Blobs and replaces this built-in one, so the hash below stops working.
// • Forgot your changed password? In Netlify go to Blobs → store "jx-auth" → delete the
//   "credentials" entry. The login falls back to this built-in password.
//
// To set a different built-in password:  node scripts/setup-admin.mjs <username> "<password>"
// and paste the printed hash here.

export const DEFAULT_ADMIN = Object.freeze({
  username: "jadian",
  passwordHash: "scrypt:32768:8:1:8or0Meo3RcjFgqLoJd_7Cw:r6Z7g_-Do3bPePf8uuUZFn2e66XFWvm77jU0V4txN_oPNxK2Js3FMFSGX5KGRmqLPXX9qwjj5XnGkWLW-COZMw",
});
