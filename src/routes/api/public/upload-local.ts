import { createFileRoute } from "@tanstack/react-router";
import { uploadMediaFile } from "@/lib/storage-helper.server";

export const Route = createFileRoute("/api/public/upload-local")({
  server: {
    handlers: {
      POST: async (ctx) => {
        try {
          const body = (await ctx.request.json()) as {
            filename: string;
            content_type?: string;
            data_base64: string;
            userId?: string;
          };
          if (!body || !body.filename || !body.data_base64) {
            return new Response(JSON.stringify({ error: "Missing filename or data_base64" }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }

          const safeName = body.filename.replace(/[^\w.-]/g, "_");
          const contentType = body.content_type || "image/jpeg";
          const buffer = Buffer.from(body.data_base64, "base64");
          const userId = body.userId || "public";

          const publicUrl = await uploadMediaFile({
            userId,
            bucket: "post-images",
            fileName: safeName,
            contentType,
            buffer,
          });

          return new Response(JSON.stringify({ path: publicUrl, signed_url: publicUrl }), {
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          console.error("Upload error:", e);
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
