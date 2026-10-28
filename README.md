# Jadnix Tech website

The Jadnix Tech studio site, with a hidden, server-secured **portfolio manager**.

- Static site in `public/` (HTML/CSS/JS, no build step)
- Admin API in `netlify/functions/` (Netlify Functions)
- Portfolio data and uploaded images stored in **Netlify Blobs** (no database to set up)

## Project structure

```
public/                 ← what visitors download (publish directory)
  index.html            site
  styles.css / app.js   site styles + script
  admin.js / admin.css  portfolio manager (loaded only when opened)
  thanks.html           contact-form success page
  _headers              security headers (CSP, etc.)
  logo.png / favicon.png / og-image.jpg   brand images
netlify/
  functions/            serverless API
    admin-auth.mjs        /api/admin/login · logout · session
    admin-portfolio.mjs   /api/admin/portfolio (add / edit / hide / reorder / delete)
    portfolio.mjs         /api/portfolio (public, visible items only)
    image.mjs             /api/image/:id (uploaded screenshots)
  lib/                  shared server code (auth, validation, rate limiting)
scripts/setup-admin.mjs generates the admin environment variables
netlify.toml            Netlify build settings
```

## Deploy (GitHub → Netlify)

1. **Push to GitHub** (new repository → upload this folder, or `git init && git add . && git commit -m "Jadnix site" && git push`).
2. In Netlify: **Add new site → Import an existing project → GitHub** → pick the repo.
   The settings are read from `netlify.toml` automatically (publish `public`, functions `netlify/functions`).
3. **Set the admin environment variables** (Site configuration → Environment variables). Generate them on your computer:

   ```bash
   node scripts/setup-admin.mjs <username> "<password>"
   ```

   Add the three lines it prints as variables — `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` — with scope **Functions**.
   Then **Deploys → Trigger deploy** so the functions pick them up.
4. **Turn on forms:** Site configuration → Forms → *Enable form detection*, then redeploy. Set the notification email under Forms → Form notifications.

> Never commit the generated values or a `.env` file. They live only in Netlify. `.gitignore` already excludes `.env`.

## Using the portfolio manager

1. Scroll to the footer and **click the `©` five times** (within about two seconds).
2. Sign in.
3. Add a project (title, category, year, URL, description, screenshot), or use **↑ ↓ / Edit / Hide / Delete** on existing ones.
   Changes appear on the live site immediately — no redeploy needed. Images are resized in your browser before upload.

Sessions last 8 hours, or until you click **Log out**.

### Change the username or password

Run `node scripts/setup-admin.mjs <new-username> "<new-password>"`, replace the three variables in Netlify and redeploy.
Replacing `SESSION_SECRET` also signs out every existing session.

## Security model (why the hidden © is not the lock)

The `©` trigger only hides the door; anyone can read front-end code. The real protection is server-side:

- The password is never in the code or the browser — only a **scrypt hash** in a Netlify environment variable.
- Login sets a signed **HttpOnly, Secure, SameSite=Strict** cookie (JavaScript can't read it).
- Every admin request is checked on the server; requests from other sites are rejected (Origin check + custom header).
- **Brute-force protection:** 5 wrong attempts locks that IP for 30 minutes; 40 wrong attempts site-wide in an hour pauses all logins for the rest of that hour.
- Uploads are checked byte-by-byte to be real JPG/PNG/WEBP files (max 3 MB); URLs must be `http(s)`.
- All content is rendered with `textContent`, never `innerHTML`, under a strict Content-Security-Policy.

**Use a long password.** A short numeric PIN can still be guessed slowly despite the lockouts. A passphrase of 12+ characters (e.g. three random words and a number) makes guessing impractical.

## Local development (optional)

```bash
npm install
npm install -g netlify-cli
cp .env.example .env      # fill in values from scripts/setup-admin.mjs
netlify dev               # http://localhost:8888 — functions + local blobs
```

Opening `public/index.html` directly from disk shows the site, but the portfolio and the admin portal need the functions, so use `netlify dev`.
