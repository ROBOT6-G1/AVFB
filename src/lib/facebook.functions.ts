import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getRequestHost } from "@tanstack/react-start/server";

const FB_SCOPES = [
  "pages_messaging",
  "pages_manage_engagement",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_show_list",
  "pages_read_user_content",
  "pages_manage_metadata",
  "public_profile",
].join(",");

function baseUrl() {
  const host = getRequestHost();
  if (!host) {
    return "https://ais-dev-i7b5jeeh6qqkeyb3nv4dw4-469517843202.europe-west2.run.app";
  }
  const proto = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
  return `${proto}://${host}`;
}

export const getFacebookLoginUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: s, error } = await context.supabase
      .from("settings")
      .select("facebook_app_id,facebook_app_secret")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) {
      throw new Error(`Tsy afaka mamaky ny paramètres: ${error.message}`);
    }
    if (!s) {
      throw new Error(
        "Tsy misy laharana ao amin'ny Paramètres. Andao ao amin'ny pejy Paramètres → Identifiants Facebook Developer, ampidiro ny App ID sy App Secret, ary tsindrio Enregistrer.",
      );
    }
    const appId = s.facebook_app_id?.trim();
    const appSecret = s.facebook_app_secret?.trim();
    if (!appId || !appSecret) {
      const missing = [!appId ? "App ID" : null, !appSecret ? "App Secret" : null]
        .filter(Boolean)
        .join(" sy ");
      throw new Error(
        `${missing} an'ny Facebook Developer mbola tsy voatahiry. Ao amin'ny Paramètres → Identifiants Facebook Developer, ampidiro ireo tononkevitra ireo dia tsindrio "Enregistrer les identifiants Facebook".`,
      );
    }
    const redirect = `${baseUrl()}/api/public/fb/callback`;
    const state = `${context.userId}.${crypto.randomUUID()}.${appId}`;
    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", FB_SCOPES);
    url.searchParams.set("auth_type", "rerequest");
    url.searchParams.set("response_type", "code");
    return { url: url.toString(), redirect_uri: redirect };
  });

export const getWebhookConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: s } = await context.supabase
      .from("settings")
      .select("facebook_verify_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    let token = s?.facebook_verify_token?.trim() ?? "";
    if (!token) {
      // Auto-génère un verify token robuste et le persiste
      token = `vt_${crypto.randomUUID().replace(/-/g, "")}`;
      await context.supabase
        .from("settings")
        .upsert(
          { user_id: context.userId, facebook_verify_token: token },
          { onConflict: "user_id" },
        );
    }
    return {
      callback_url: `${baseUrl()}/api/public/fb/webhook`,
      oauth_redirect_uri: `${baseUrl()}/api/public/fb/callback`,
      verify_token: token,
    };
  });

export const triggerCommentScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    const { scanAndReplyCommentsForUser } = await import("@/lib/ai-engine.server");
    const res = await scanAndReplyCommentsForUser(context.userId);
    return {
      ok: true,
      scanned: res.scanned,
      replied: res.replied,
      errors: res.errors,
      details: res.details,
      note: res.details.length
        ? res.details.join("\n")
        : `${res.replied} commentaire(s) répondu(s) sur ${res.scanned} scanné(s).`,
    };
  });
