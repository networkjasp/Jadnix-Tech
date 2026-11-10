// Generates a password hash for the built-in admin login.
// Usage:  node scripts/setup-admin.mjs <username> "<password>"
// Paste the printed values into netlify/lib/credentials.mjs, commit, and redeploy.
// (Easier: sign in and use "Change password" in the portal — no code change needed.)
import { hashPassword } from "../netlify/lib/password.mjs";

const [user, pass] = process.argv.slice(2);
if (!user || !pass) {
  console.error('Usage: node scripts/setup-admin.mjs <username> "<password>"');
  process.exit(1);
}
if (pass.length < 12) {
  console.warn("\n⚠  Warning: passwords under 12 characters are easy to guess. A long passphrase is strongly recommended.\n");
}
console.log(`username: "${user}",`);
console.log(`passwordHash: "${hashPassword(pass)}",`);
