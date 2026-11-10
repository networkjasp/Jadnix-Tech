// POST /api/contact — the website's contact form .
// Server-side protection: validation, honeypot, time trap, same-site check and rate limiting.
// Enquiries are stored in KV (kept 12 months, see Privacy policy) and shown in the portal's Enquiries tab.
// Optional email alert: set RESEND_API_KEY and NOTIFY_EMAIL in the project's variables (see README).
import { json, error, safe, kv, newId, validateEnquiry, contactAllowed, clientIp } from "../../lib/security.js";

const wantsJson = request => (request.headers.get("Accept") || "").includes("application/json");
const done = (request, ok, payload = {}, status = 200) =>
  wantsJson(request) ? json({ ok, ...payload }, status)
    : ok ? Response.redirect(new URL("/thanks", request.url).toString(), 303)
         : new Response(`Sorry — your message couldn't be sent: ${payload.error || "please try again"}. Go back and try again, or WhatsApp 064 496 3276.`,
             { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export const onRequestPost = safe(async ({ env, request, waitUntil }) => {
  // Only accept posts from this site's own pages.
  const origin = request.headers.get("Origin");
  if (origin) { try { if (new URL(origin).host !== request.headers.get("Host")) return error(403, "Forbidden."); } catch { return error(403, "Forbidden."); } }

  let form; try { form = await request.formData(); } catch { return done(request, false, { error: "Bad request." }, 400); }
  const f = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));

  // Honeypot: real people never see or fill this field. Pretend success so bots don't learn.
  if (f.company_website) return done(request, true);

  // Time trap: the page records when it loaded; bots submit instantly (or without the page at all).
  const elapsed = Date.now() - Number(f.started);
  if (!Number.isFinite(elapsed) || elapsed < 3000 || elapsed > 86_400_000) {
    return done(request, false, { error: "Please reload the page and try again." }, 400);
  }

  const { enquiry, errors } = validateEnquiry(f);
  if (errors) return done(request, false, { error: "Please check the form.", fields: errors }, 400);

  if (!(await contactAllowed(env, clientIp(request)))) {
    return done(request, false, { error: "Too many messages — please try again later, or WhatsApp 064 496 3276." }, 429);
  }

  const id = newId("enq");
  const createdAt = new Date().toISOString();
  await kv(env).put(`enquiry:${id}`, JSON.stringify({ id, ...enquiry, createdAt }), {
    expirationTtl: 365 * 24 * 60 * 60,
    metadata: { name: enquiry.name.slice(0, 60), createdAt },
  });

  if (env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
    waitUntil(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || "Jadnix Website <onboarding@resend.dev>",
        to: [env.NOTIFY_EMAIL],
        reply_to: enquiry.email,
        subject: `New enquiry from ${enquiry.name}${enquiry.service ? ` — ${enquiry.service}` : ""}`,
        text: `Name: ${enquiry.name}\nEmail: ${enquiry.email}\nPhone: ${enquiry.phone || "-"}\nService: ${enquiry.service || "-"}\n\n${enquiry.message}\n\nAlso saved in your portal (click © five times on the website).`,
      }),
    }).catch(() => {}));
  }
  return done(request, true);
});
