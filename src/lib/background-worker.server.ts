import { supabaseAdmin } from "@/integrations/supabase/client.server";

let isWorkerStarted = false;
let isWorkerRunning = false;
let lastRunTimestamp = 0;

/**
 * Runs one tick of the background worker:
 * 1. Checks and auto-replies to all pending Facebook Messenger messages across all connected pages.
 * 2. Checks and publishes all due scheduled Facebook posts.
 * 3. Scans and auto-replies to pending comments on recent Facebook posts.
 */
export async function runBackgroundWorkerTick(): Promise<{
  messages?: any;
  posts?: any;
  comments?: any;
  skipped?: boolean;
}> {
  if (isWorkerRunning) {
    return { skipped: true };
  }

  isWorkerRunning = true;
  lastRunTimestamp = Date.now();

  try {
    // 1. Process pending Messenger private messages
    let messagesResult = null;
    try {
      const { replyAllPendingForAllUsers } = await import("@/lib/ai-engine.server");
      messagesResult = await replyAllPendingForAllUsers();
      if (messagesResult && (messagesResult.processed > 0 || messagesResult.replied > 0)) {
        console.log("[background-worker] Messenger auto-replies:", messagesResult);
      }
    } catch (e) {
      console.error("[background-worker] Messenger error:", e);
    }

    // 2. Publish due scheduled posts
    let postsResult = null;
    try {
      const { runScheduledPost } = await import("@/lib/post-publisher.server");
      const nowIso = new Date().toISOString();
      const { data: duePosts } = await supabaseAdmin
        .from("scheduled_posts")
        .select("id")
        .eq("status", "pending")
        .lte("scheduled_at", nowIso)
        .order("scheduled_at", { ascending: true })
        .limit(10);

      if (duePosts && duePosts.length > 0) {
        const results = [];
        for (const post of duePosts) {
          try {
            const r = await runScheduledPost(post.id);
            results.push({ id: post.id, ...r });
          } catch (postErr) {
            results.push({
              id: post.id,
              ok: false,
              error: postErr instanceof Error ? postErr.message : String(postErr),
            });
          }
        }
        postsResult = { processed: results.length, results };
        console.log("[background-worker] Scheduled posts published:", postsResult);
      }
    } catch (e) {
      console.error("[background-worker] Posts error:", e);
    }

    // 3. Scan & reply to unhandled comments
    let commentsResult = null;
    try {
      const { scanAndReplyCommentsForAllUsers } = await import("@/lib/ai-engine.server");
      commentsResult = await scanAndReplyCommentsForAllUsers();
      if (commentsResult && (commentsResult.scanned > 0 || commentsResult.replied > 0)) {
        console.log("[background-worker] Comments auto-replies:", commentsResult);
      }
    } catch (e) {
      console.error("[background-worker] Comments error:", e);
    }

    return {
      messages: messagesResult,
      posts: postsResult,
      comments: commentsResult,
    };
  } finally {
    isWorkerRunning = false;
  }
}

/**
 * Starts the in-process background worker if not already running.
 * Executes periodically every 25 seconds.
 */
export function startBackgroundWorker(): void {
  if (isWorkerStarted) return;
  isWorkerStarted = true;

  console.log("[background-worker] Starting automatic IA background loop (every 25s)...");

  // Run first tick shortly after boot (5s)
  setTimeout(() => {
    runBackgroundWorkerTick().catch((err) =>
      console.error("[background-worker] Initial tick error:", err),
    );
  }, 5000);

  // Repeat every 25 seconds
  setInterval(() => {
    runBackgroundWorkerTick().catch((err) =>
      console.error("[background-worker] Periodic tick error:", err),
    );
  }, 25000);
}

export function getWorkerStatus() {
  return {
    isWorkerStarted,
    isWorkerRunning,
    lastRunTimestamp,
    lastRunAgoSeconds: lastRunTimestamp ? Math.round((Date.now() - lastRunTimestamp) / 1000) : null,
  };
}
