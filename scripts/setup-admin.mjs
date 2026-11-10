// Makes a new password hash for the built-in admin login (optional — you can also
// just sign in and use "Change password" in the portal).
// Usage:  node scripts/setup-admin.mjs <username> "<password>"
// Paste the printed values into lib/credentials.js, commit and push.
import { hashPassword } from "../lib/password.js";

const [user, pass] = process.argv.slice(2);
if (!user || !pass) {
  console.error('Usage: node scripts/setup-admin.mjs <username> "<password>"');
  process.exit(1);
}
if (pass.length < 12) console.warn("\n⚠  Passwords under 12 characters are easy to guess. Use a long passphrase.\n");
console.log(`  username: "${user}",`);
console.log(`  passwordHash: "${await hashPassword(pass)}",`);
