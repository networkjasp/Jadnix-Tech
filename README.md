# Jadnix Tech website

Live site: https://www.jadnixtech.co.za

Static site (`public/`) + Netlify Functions (`netlify/functions/`) + Netlify Blobs for portfolio data,
uploaded images and admin security data. **No environment variables or external services need to be set up.**

## Structure

```
public/
  index.html                 homepage (contact form, portfolio, pricing)
  web-design/ website-redesign/ custom-software/ crm-development/ website-maintenance/   service pages
  privacy/ terms/            Privacy policy (POPIA) and Terms & conditions
  404.html  thanks.html      not-found page and form success page
  styles.css  app.js         site styles + script (cookie notice, form validation, portfolio)
  admin.js  admin.css        portfolio manager (loaded only when opened)
  fonts/                     self-hosted fonts (OFL licence)
  og/                        social preview images (1200×630)
  favicon.ico favicon.png apple-touch-icon.png icon-192.png icon-512.png site.webmanifest
  sitemap.xml  robots.txt  _headers (security + caching headers)
netlify/
  functions/                 API: login, portfolio, images
  lib/credentials.mjs        built-in admin login (password HASH only)
  lib/security.mjs           sessions, rate limiting, validation
  lib/password.mjs           scrypt password hashing
scripts/setup-admin.mjs      makes a new hash for credentials.mjs (optional)
netlify.toml                 build settings + redirects to https://www.jadnixtech.co.za
```

## Deploy

Push to GitHub — Netlify builds and publishes automatically. In Netlify → Domain management,
`www.jadnixtech.co.za` should be the **primary domain**.

## Portfolio manager

1. Click the `©` in the footer **five times**.
2. Sign in with the built-in login.
3. **Change the password straight away** (yellow banner → *Change password*). The new password is stored hashed
   in Netlify Blobs and replaces the built-in one, and every other session is signed out.

Forgot the changed password? Netlify → your site → **Blobs** → store `jx-auth` → delete the `credentials` entry.
The login falls back to the built-in password in `netlify/lib/credentials.mjs`.

### Security

- Password stored only as a **scrypt** hash, never in plain text, never in the browser.
- Session signing key generated automatically on first use and kept server-side (Netlify Blobs).
- Signed **HttpOnly, Secure, SameSite=Strict** cookie, 8-hour sessions.
- **Rate limiting:** 5 wrong passwords → that IP is locked out for 30 min; 40 site-wide per hour → logins paused.
- Password policy on change: 12+ characters mixing 3 character types (or 16+ characters).
- CSRF protection (Origin check + custom header), strict Content-Security-Policy, uploads checked byte-by-byte.

## Contact form

Netlify Forms with: inline validation, honeypot field, time trap (blocks bot-speed submissions), POPIA consent
checkbox, double-submit protection, and Netlify's built-in spam filter. Set email notifications in
Netlify → Forms → Form notifications.

## Regenerating pages

Service, legal and 404 pages were generated from one template; edit the HTML files directly for small text changes.
