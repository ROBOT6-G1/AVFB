import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import fs from "fs";
import path from "path";

export const Route = createFileRoute("/api/public/img")({
  server: {
    handlers: {
      GET: async (ctx) => {
        try {
          const url = new URL(ctx.request.url);
          const id = url.searchParams.get("id");
          const pathParam = url.searchParams.get("path");

          let rawPath = pathParam;

          if (id) {
            const { data: imgRow } = await supabaseAdmin
              .from("product_images")
              .select("image_path")
              .eq("id", id)
              .maybeSingle();

            if (imgRow?.image_path) {
              rawPath = imgRow.image_path;
            }
          }

          if (!rawPath) {
            return new Response("Image not found", { status: 404 });
          }

          // 1. Data URL
          if (rawPath.startsWith("data:image/") || rawPath.startsWith("data:application/")) {
            const match = rawPath.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              const mime = match[1] || "image/jpeg";
              const buffer = Buffer.from(match[2], "base64");
              return new Response(buffer, {
                status: 200,
                headers: {
                  "Content-Type": mime,
                  "Content-Length": String(buffer.length),
                  "Cache-Control": "public, max-age=604800, immutable",
                },
              });
            }
          }

          // 2. Remote HTTP / HTTPS URL
          if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
            try {
              const res = await fetch(rawPath);
              if (res.ok) {
                const mime = res.headers.get("content-type") || "image/jpeg";
                const arrayBuffer = await res.arrayBuffer();
                return new Response(Buffer.from(arrayBuffer), {
                  status: 200,
                  headers: {
                    "Content-Type": mime,
                    "Cache-Control": "public, max-age=604800, immutable",
                  },
                });
              }
            } catch (e) {
              console.warn("[/api/public/img] proxy fetch failed:", e);
            }
          }

          // 3. Supabase Storage download (e.g. "userId/productId/filename.jpg" in product-images)
          try {
            const { data: storageBlob, error: stErr } = await supabaseAdmin.storage
              .from("product-images")
              .download(rawPath);
            if (!stErr && storageBlob) {
              const mime = storageBlob.type || "image/jpeg";
              const arrayBuffer = await storageBlob.arrayBuffer();
              return new Response(Buffer.from(arrayBuffer), {
                status: 200,
                headers: {
                  "Content-Type": mime,
                  "Cache-Control": "public, max-age=604800, immutable",
                },
              });
            }
          } catch (stEx) {
            // continue to local filesystem
          }

          // 4. Local filesystem
          const cleanPath = rawPath.replace(/^\/+/, "");
          const possiblePaths = [
            path.join(process.cwd(), "public", cleanPath.replace(/^public\//, "")),
            path.join(process.cwd(), cleanPath),
            path.join(process.cwd(), "public", "uploads", path.basename(rawPath)),
          ];

          for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
              const buffer = fs.readFileSync(p);
              const ext = path.extname(p).toLowerCase();
              const mime =
                ext === ".png"
                  ? "image/png"
                  : ext === ".webp"
                    ? "image/webp"
                    : ext === ".gif"
                      ? "image/gif"
                      : "image/jpeg";
              return new Response(buffer, {
                status: 200,
                headers: {
                  "Content-Type": mime,
                  "Content-Length": String(buffer.length),
                  "Cache-Control": "public, max-age=604800, immutable",
                },
              });
            }
          }

          return new Response("File not found on server", { status: 404 });
        } catch (err: unknown) {
          console.error("[/api/public/img] error:", err);
          return new Response("Internal server error", { status: 500 });
        }
      },
    },
  },
});
