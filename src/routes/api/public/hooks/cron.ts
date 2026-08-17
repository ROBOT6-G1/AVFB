// Master Cron endpoint for running all background tasks:
// - Auto-reply to pending Facebook Messenger messages
// - Auto-reply to Facebook comments
// - Publish due scheduled posts
import { createFileRoute } from "@tanstack/react-router";
import { runBackgroundWorkerTick, getWorkerStatus } from "@/lib/background-worker.server";

async function handleCron() {
  try {
    const result = await runBackgroundWorkerTick();
    const status = getWorkerStatus();
    return new Response(
      JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        status,
        result,
      }),
      {
        headers: {
          "content-type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/hooks/cron")({
  server: {
    handlers: {
      GET: async () => handleCron(),
      POST: async () => handleCron(),
    },
  },
});
