import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/* ---------------- Prompts ---------------- */

const promptCategory = z.enum(["global", "message", "comment", "md", "tutorial"]);

export const listPrompts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("prompts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertPromptSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().max(100).optional().default("Prompt IA"),
  content: z.string().min(1).max(20000),
  category: promptCategory,
  is_active: z.boolean(),
  page_id: z.string().nullable().optional(),
  page_ids: z.array(z.string()).optional(),
  assistance_type: z.enum(["online_work", "training", "sales", "all"]).nullable().optional(),
});

export const upsertPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertPromptSchema.parse(d))
  .handler(async ({ data, context }) => {
    const pageIds = data.page_ids ?? (data.page_id ? [data.page_id] : []);
    const payload = {
      ...data,
      name: data.name?.trim() || "Prompt IA",
      page_ids: pageIds,
      page_id: pageIds.length === 1 ? pageIds[0] : null,
      assistance_type: data.assistance_type ?? null,
      user_id: context.userId,
    };
    const { error } = await context.supabase.from("prompts").upsert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("prompts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Gemini Keys ---------------- */

export const listGeminiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("gemini_keys")
      .select("id,label,is_active,last_used_at,error_count,disabled_until,api_key,created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // Mask keys
    return (data ?? []).map((k) => ({
      ...k,
      api_key_masked: k.api_key ? `${k.api_key.slice(0, 6)}…${k.api_key.slice(-4)}` : "",
      api_key: undefined,
    }));
  });

const upsertKeySchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(60),
  api_key: z.string().min(10).max(400),
  is_active: z.boolean(),
});

export const upsertGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertKeySchema.parse(d))
  .handler(async ({ data, context }) => {
    const cleanKey = data.api_key.trim();
    const { fetchAvailableGeminiModels } = await import("@/lib/ai-engine.server");
    const testRes = await fetchAvailableGeminiModels(cleanKey);
    if (!testRes.ok) {
      throw new Error(`La clé API Gemini est refusée par Google: ${testRes.error}`);
    }

    const payload = {
      ...data,
      api_key: cleanKey,
      user_id: context.userId,
      error_count: 0,
      disabled_until: null,
    };
    const { error } = await context.supabase.from("gemini_keys").upsert(payload);
    if (error) throw new Error(error.message);
    return { ok: true, models: testRes.models };
  });

export const testGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: keyData, error } = await context.supabase
      .from("gemini_keys")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (error || !keyData) throw new Error("Clé introuvable");

    const { fetchAvailableGeminiModels } = await import("@/lib/ai-engine.server");
    const cleanKey = (keyData.api_key || "").trim();
    const res = await fetchAvailableGeminiModels(cleanKey);
    if (!res.ok) {
      await context.supabase
        .from("gemini_keys")
        .update({ error_count: (keyData.error_count ?? 0) + 1 })
        .eq("id", data.id);
      throw new Error(res.error || "Clé Gemini invalide ou inaccessible");
    }

    await context.supabase
      .from("gemini_keys")
      .update({ error_count: 0, disabled_until: null, is_active: true })
      .eq("id", data.id);

    return { ok: true, models: res.models };
  });

export const deleteGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("gemini_keys").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("gemini_keys")
      .update({ is_active: data.is_active, error_count: 0, disabled_until: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetAllGeminiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("gemini_keys")
      .update({ is_active: true, error_count: 0, disabled_until: null })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Settings ---------------- */

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: allSettings, error } = await context.supabase
      .from("settings")
      .select("*")
      .eq("user_id", context.userId);

    if (error) throw new Error(error.message);

    if (!allSettings || allSettings.length === 0) {
      return null;
    }

    // Proactive DB Auto-repair: Merge duplicate settings rows and clean up extras
    if (allSettings.length > 1) {
      const baseSettings = { ...allSettings[0] };
      for (let i = 1; i < allSettings.length; i++) {
        const other = allSettings[i];
        for (const key of Object.keys(other)) {
          if (other[key] !== null && other[key] !== undefined && other[key] !== "") {
            if (baseSettings[key] == null || baseSettings[key] === "") {
              baseSettings[key] = other[key];
            }
          }
        }
      }

      // Re-upsert the fully merged record
      await context.supabase.from("settings").upsert(baseSettings, { onConflict: "user_id" });

      // Clean up the duplicate rows
      for (let i = 1; i < allSettings.length; i++) {
        const other = allSettings[i];
        if (other.id !== baseSettings.id) {
          await context.supabase.from("settings").delete().eq("id", other.id);
        }
      }

      return baseSettings;
    }

    return allSettings[0];
  });

const updateSettingsSchema = z.object({
  assistance_type: z.enum(["online_work", "training", "sales"]).optional().default("online_work"),
  auto_reply_messages: z.boolean().optional().default(true),
  auto_reply_comments: z.boolean().optional().default(true),
  comment_scan_interval_minutes: z.number().int().min(1).max(60).optional().default(5),
  use_lovable_ai_fallback: z.boolean().optional().default(true),
  default_model: z.string().min(1).max(80).optional().default("gemini-2.5-flash"),
  private_message_link: z.string().max(500).nullable().optional(),
  facebook_app_id: z.string().max(100).nullable().optional(),
  facebook_app_secret: z.string().max(200).nullable().optional(),
  facebook_verify_token: z.string().max(200).nullable().optional(),
});

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSettingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const clean = (value?: string | null) => {
      const trimmed = value?.trim() ?? "";
      return trimmed || null;
    };
    const { error } = await context.supabase.from("settings").upsert(
      {
        ...data,
        user_id: context.userId,
        private_message_link: clean(data.private_message_link),
        facebook_app_id: clean(data.facebook_app_id),
        facebook_app_secret: clean(data.facebook_app_secret),
        facebook_verify_token: clean(data.facebook_verify_token),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Facebook pages ---------------- */

export const listFacebookPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("facebook_pages")
      .select("id,page_id,page_name,is_connected,webhook_subscribed,token_expires_at,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const disconnectFacebookPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("facebook_pages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Stats / logs ---------------- */

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [msgs, comments, keys, pages] = await Promise.all([
      context.supabase.from("messages_log").select("id", { count: "exact", head: true }),
      context.supabase
        .from("comments_log")
        .select("id", { count: "exact", head: true })
        .eq("replied", true),
      context.supabase
        .from("gemini_keys")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      context.supabase
        .from("facebook_pages")
        .select("id", { count: "exact", head: true })
        .eq("is_connected", true),
    ]);
    return {
      messages: msgs.count ?? 0,
      comments_replied: comments.count ?? 0,
      active_keys: keys.count ?? 0,
      connected_pages: pages.count ?? 0,
    };
  });

export const listMessagesLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("messages_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listCommentsLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("comments_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ---------------- Batch reply ---------------- */

export const replyAllPendingMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { replyAllPendingForUser } = await import("@/lib/ai-engine.server");
    return await replyAllPendingForUser(context.userId);
  });
