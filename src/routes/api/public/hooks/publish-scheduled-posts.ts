// Cron endpoint: scans due scheduled posts (status pending, scheduled_at <= now)
// and publishes them via runScheduledPost. Called by pg_cron every minute.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/publish-scheduled-posts")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runScheduledPost } = await import("@/lib/post-publisher.server");

        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("scheduled_posts")
          .select("id")
          .eq("status", "pending")
          .lte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(20);
        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        const results: Array<{ id: string; ok: boolean; error?: string }> = [];
        for (const row of data ?? []) {
          try {
            const res = await runScheduledPost(row.id);
            results.push({ id: row.id, ...res });
          } catch (e) {
            results.push({
              id: row.id,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
