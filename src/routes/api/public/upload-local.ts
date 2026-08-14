import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";

export const Route = createFileRoute("/api/public/upload-local")({
  server: {
    handlers: {
      POST: async (ctx) => {
        try {
          const body = (await ctx.request.json()) as {
            filename: string;
            content_type?: string;
            data_base64: string;
          };
          if (!body || !body.filename || !body.data_base64) {
            return new Response(JSON.stringify({ error: "Missing filename or data_base64" }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }

          const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
          if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          }

          const safeName = body.filename.replace(/[^\w.\-]/g, "_");
          const uniqueName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
          const filePath = path.join(UPLOAD_DIR, uniqueName);

          const bytes = Uint8Array.from(atob(body.data_base64), (c) => c.charCodeAt(0));
          fs.writeFileSync(filePath, bytes);

          const publicUrl = `/uploads/${uniqueName}`;
          return new Response(JSON.stringify({ path: publicUrl, signed_url: publicUrl }), {
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          console.error("Local upload error:", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            {
              status: 500,
              headers: { "content-type": "application/json" },
            },
          );
        }
      },
    },
  },
});
