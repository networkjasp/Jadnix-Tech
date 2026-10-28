// GET /api/image/:id — serves uploaded portfolio images.
import { imageStore, ID_RE, error } from "../lib/security.mjs";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export default async (req, context) => {
  const id = context.params?.id || new URL(req.url).pathname.split("/").pop();
  if (!ID_RE.test(id)) return error(404, "Not found.");
  const entry = await imageStore().getWithMetadata(id, { type: "arrayBuffer" });
  if (!entry || !ALLOWED.has(entry.metadata?.type)) return error(404, "Not found.");
  return new Response(entry.data, {
    headers: {
      "Content-Type": entry.metadata.type,
      "Cache-Control": "public, max-age=31536000, immutable",   // ids are unique per upload
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
};

export const config = { path: "/api/image/:id" };
