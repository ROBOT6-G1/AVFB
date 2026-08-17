import { createFileRoute } from "@tanstack/react-router";

async function handleReplyAll(request: Request) {
  try {
    const { replyAllPendingForAllUsers } = await import("@/lib/ai-engine.server");
    const result = await replyAllPendingForAllUsers();
    console.log("[cron reply-all messages]", result);
    return new Response(JSON.stringify({ ok: true, timestamp: new Date().toISOString(), ...result }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[cron reply-all messages] error", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/hooks/reply-all-messages")({
  server: {
    handlers: {
      GET: async ({ request }) => handleReplyAll(request),
      POST: async ({ request }) => handleReplyAll(request),
    },
  },
});
