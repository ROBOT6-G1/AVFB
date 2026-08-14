import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** List distinct conversations (grouped by page_id + sender_id) from messages_log */
export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("messages_log")
      .select("page_id,sender_id,sender_name,content,ai_response,direction,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const map = new Map<string, any>();
    for (const r of data ?? []) {
      if (!r.sender_id || !r.page_id) continue;
      const key = `${r.page_id}::${r.sender_id}`;
      if (!map.has(key)) {
        map.set(key, {
          page_id: r.page_id,
          client_fb_id: r.sender_id,
          client_fb_name: r.sender_name ?? r.sender_id,
          last_message: r.content ?? r.ai_response ?? "",
          last_at: r.created_at,
        });
      }
    }
    const list = Array.from(map.values());
    // Attach IA state
    const { data: states } = await context.supabase.from("client_ia_state").select("*");
    const stateMap = new Map(
      (states ?? []).map((s: any) => [`${s.page_id}::${s.client_fb_id}`, s.ia_stopped]),
    );
    return list.map((c) => ({
      ...c,
      ia_stopped: stateMap.get(`${c.page_id}::${c.client_fb_id}`) ?? false,
    }));
  });

export const listConversationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ page_id: z.string(), client_fb_id: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("messages_log")
      .select("*")
      .eq("page_id", data.page_id)
      .eq("sender_id", data.client_fb_id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const sendDiscussionMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        page_id: z.string(),
        client_fb_id: z.string(),
        text: z.string().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Get page token
    const { data: page } = await context.supabase
      .from("facebook_pages")
      .select("page_id,page_access_token,page_name")
      .eq("page_id", data.page_id)
      .maybeSingle();
    if (!page?.page_access_token) throw new Error("Page introuvable ou token manquant");

    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/messages?access_token=${page.page_access_token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: { id: data.client_fb_id },
          message: { text: data.text },
          messaging_type: "RESPONSE",
        }),
      },
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Facebook: ${res.status} ${t.slice(0, 200)}`);
    }
    await context.supabase.from("messages_log").insert({
      user_id: context.userId,
      page_id: data.page_id,
      sender_id: data.client_fb_id,
      direction: "outgoing",
      content: data.text,
      status: "sent",
    });
    return { ok: true };
  });
