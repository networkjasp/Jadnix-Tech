// GET /api/image/:id — uploaded portfolio screenshots.
import { kv, ID_RE, error } from "../../../lib/security.js";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function onRequestGet({ env, params }) {
  const id = String(params.id || "");
  if (!ID_RE.test(id)) return error(404, "Not found.");
  let entry;
  try { entry = await kv(env).getWithMetadata(`image:${id}`, { type: "arrayBuffer" }); }
  catch { return error(404, "Not found."); }
  if (!entry || !entry.value || !ALLOWED.has(entry.metadata?.type)) return error(404, "Not found.");
  return new Response(entry.value, {
    headers: {
      "Content-Type": entry.metadata.type,
      "Cache-Control": "public, max-age=31536000, immutable",   // ids are unique per upload
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
