# Jadnix Tech website

Live site: https://www.jadnixtech.co.za — hosted on **Cloudflare Pages**, deployed automatically from GitHub.

- `public/` — the website (static HTML/CSS/JS). Cloudflare's **build output directory**.
- `functions/` — server code (Cloudflare Pages Functions): portfolio, images, contact form, admin login.
- `lib/` — shared server code: security, password hashing, built-in login.
- Data (portfolio, images, enquiries, login security) lives in one **Workers KV** namespace bound as `JADNIX_KV`.
- No npm packages, no build step, no third-party services required.

## Structure

```
public/
  index.html                 homepage (contact form, portfolio, pricing)
  web-design/ website-redesign/ custom-software/ crm-development/ website-maintenance/   service pages
  privacy/ terms/            Privacy policy (POPIA) and Terms & conditions
  404.html  thanks.html      not-found page and form success page (/thanks)
  styles.css  app.js         site styles + script (cookie notice, form validation, portfolio)
  admin.js  admin.css        portfolio manager + enquiries inbox (loaded only when opened)
  fonts/  og/                self-hosted fonts, social preview images
  _headers                   security + caching headers (static files)
  _routes.json               which paths run the middleware (static assets skip it)
  sitemap.xml  robots.txt  favicon.ico  site.webmanifest …
functions/
  _middleware.js             jadnixtech.co.za → https://www.jadnixtech.co.za, noindex on *.pages.dev
  api/portfolio.js           GET  public portfolio
  api/image/[id].js          GET  uploaded screenshots
  api/contact.js             POST contact form (validation, honeypot, time trap, rate limit)
  api/admin/*.js             login, logout, session, password, portfolio, enquiries
lib/
  credentials.js             built-in admin login (password HASH only)
  password.js                PBKDF2-SHA256 hashing (Web Crypto)
  security.js                sessions, rate limiting, validation, storage helpers
scripts/setup-admin.mjs      makes a new hash for credentials.js (optional)
```

## Cloudflare Pages settings

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `public` |
| Root directory | *(leave empty)* |
| Binding | KV namespace → variable name **`JADNIX_KV`** (Production **and** Preview) |

Also turn on **SSL/TLS → Edge Certificates → Always Use HTTPS** for the domain.

## Portfolio manager & enquiries

1. Click the `©` in the footer **five times**, then sign in.
2. **Change the password straight away** (yellow banner → *Change password*). The new password is stored hashed in KV
   and replaces the built-in one; other sessions are signed out.
3. **Enquiries** (top bar) shows contact-form messages, newest first, with *Reply by email* / *WhatsApp* buttons.
   Enquiries are deleted automatically after 12 months.

Forgot the changed password? Cloudflare → **Storage & databases → Workers KV** → your namespace → delete the key
`auth:credentials`. The login falls back to the built-in password in `lib/credentials.js`.

### Optional: email me when someone fills in the form

Create a free account at resend.com, make an API key, then in Cloudflare → your Pages project → **Settings →
Variables and secrets** add:
- `RESEND_API_KEY` (type **Secret**) — the key
- `NOTIFY_EMAIL` — the email address you signed up to Resend with

Redeploy. Without these, enquiries are still saved and shown in the portal.

## Security

- Password stored only as a PBKDF2-SHA256 hash (100,000 iterations, random salt), never in the browser.
- Session key generated automatically and kept in KV; signed HttpOnly, Secure, SameSite=Strict cookie (8 h).
- Rate limiting: 5 wrong passwords → that visitor locked out 30 min; 40 site-wide per hour → logins paused.
  Contact form: 5 messages per visitor per hour.
- CSRF protection, strict Content-Security-Policy, uploads checked byte-by-byte, all output rendered as text.

## Run locally (optional)

```bash
npx wrangler pages dev public --kv JADNIX_KV
# http://localhost:8788
```
