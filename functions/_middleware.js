// Runs in front of every page (see public/_routes.json for which paths).
// • Sends the bare domain jadnixtech.co.za to https://www.jadnixtech.co.za (one canonical address for Google).
// • Keeps the *.pages.dev preview address out of Google with a noindex header.
// HTTPS itself is forced by Cloudflare: SSL/TLS → Edge Certificates → "Always Use HTTPS" (see README),
// plus the Strict-Transport-Security header in public/_headers.
const CANONICAL = "www.jadnixtech.co.za";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "jadnixtech.co.za") {
    url.protocol = "https:"; url.hostname = CANONICAL; url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  const response = await context.next();
  if (url.hostname.endsWith(".pages.dev")) {
    const r = new Response(response.body, response);
    r.headers.set("X-Robots-Tag", "noindex, nofollow");
    return r;
  }
  return response;
}
