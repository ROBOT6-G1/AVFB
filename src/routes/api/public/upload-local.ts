import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

          const safeName = body.filename.replace(/[^\w.-]/g, "_");
          const uniqueName = `uploads/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
          const contentType = body.content_type || "image/jpeg";
          const bytes = Uint8Array.from(atob(body.data_base64), (c) => c.charCodeAt(0));

          try {
            const { error: upErr } = await supabaseAdmin.storage
              .from("post-images")
              .upload(uniqueName, bytes, { contentType, upsert: true });

            if (!upErr) {
              const { data: signed } = await supabaseAdmin.storage
                .from("post-images")
                .createSignedUrl(uniqueName, 60 * 60 * 24 * 7);

              const signedUrl = signed?.signedUrl || `data:${contentType};base64,${body.data_base64}`;
              return new Response(JSON.stringify({ path: uniqueName, signed_url: signedUrl }), {
                headers: { "content-type": "application/json" },
              });
            }
          } catch (storageErr) {
            console.warn("[upload-local] storage upload fallback:", storageErr);
          }

          // Fallback to data URL
          const dataUrl = `data:${contentType};base64,${body.data_base64}`;
          return new Response(JSON.stringify({ path: dataUrl, signed_url: dataUrl }), {
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

