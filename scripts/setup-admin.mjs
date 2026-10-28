// Generates the three environment variables the admin portal needs.
// Usage:  node scripts/setup-admin.mjs <username> <password>
// Then paste the output into Netlify → Site configuration → Environment variables.
// Never commit these values to Git.
import { randomBytes } from "node:crypto";
import { hashPassword } from "../netlify/lib/password.mjs";

const [user, pass] = process.argv.slice(2);
if (!user || !pass) {
  console.error("Usage: node scripts/setup-admin.mjs <username> <password>");
  process.exit(1);
}
if (pass.length < 10) {
  console.warn("\n⚠  Warning: passwords under 10 characters are easy to guess. A long passphrase is strongly recommended.\n");
}
console.log(`ADMIN_USERNAME=${user}`);
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(pass)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
