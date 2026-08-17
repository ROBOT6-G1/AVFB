import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  getSupabaseOAuthAuthorizeUrl,
  fetchSupabaseProjects,
  fetchSupabaseOrganizations,
} from "@/lib/supabase-oauth.server";

export const getSupabaseAuthUrl = createServerFn({ method: "POST" })
  .validator((d: { redirectUri?: string; userId?: string; mode?: "signin" | "connect" }) => d)
  .handler(async ({ data }) => {
    const mode = data.mode || "connect";
    const uid = data.userId || "anonymous";
    const clientOrigin = data.redirectUri ? new URL(data.redirectUri).origin : "";
    const state = `${mode}:${uid}:${Date.now()}:${encodeURIComponent(clientOrigin)}`;

    // Use registered canonical callback URL so Supabase API never rejects with "redirect_uri not allowed"
    const redirectUri =
      process.env.SUPABASE_OAUTH_REDIRECT_URI ||
      "https://ais-dev-i7b5jeeh6qqkeyb3nv4dw4-469517843202.europe-west2.run.app/api/public/supabase/callback";

    const url = getSupabaseOAuthAuthorizeUrl(redirectUri, state);
    return { url, redirectUri };
  });

export const getSupabaseOAuthStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: conn } = await context.supabase
      .from("supabase_oauth_connections")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: settings } = await context.supabase
      .from("settings")
      .select("supabase_project_url,supabase_project_name,supabase_anon_key,supabase_connected")
      .eq("user_id", context.userId)
      .maybeSingle();

    return {
      isConnected: Boolean(conn?.is_connected || settings?.supabase_connected),
      connection: conn || null,
      projects: (conn?.projects as any[]) || [],
      organizations: (conn?.organizations as any[]) || [],
      selectedProjectId: conn?.selected_project_id || null,
      selectedProjectName: conn?.selected_project_name || settings?.supabase_project_name || null,
      selectedProjectUrl: conn?.selected_project_url || settings?.supabase_project_url || null,
      anonKey: settings?.supabase_anon_key || null,
    };
  });

const selectProjectSchema = z.object({
  projectId: z.string().min(1),
});

export const selectSupabaseProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => selectProjectSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: conn } = await context.supabase
      .from("supabase_oauth_connections")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!conn || !conn.projects) {
      throw new Error("Aucune connexion Supabase active trouvée.");
    }

    const targetProject = (conn.projects as any[]).find((p) => p.id === data.projectId);
    if (!targetProject) {
      throw new Error("Projet introuvable dans votre compte Supabase.");
    }

    await context.supabase.from("supabase_oauth_connections").upsert({
      ...conn,
      selected_project_id: targetProject.id,
      selected_project_name: targetProject.name,
      selected_project_url: targetProject.project_url,
      updated_at: new Date().toISOString(),
    });

    await context.supabase.from("settings").upsert(
      {
        user_id: context.userId,
        supabase_project_url: targetProject.project_url,
        supabase_project_name: targetProject.name,
        supabase_anon_key: targetProject.anon_key || null,
        supabase_connected: true,
      },
      { onConflict: "user_id" },
    );

    return { ok: true, project: targetProject };
  });

export const disconnectSupabaseOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("supabase_oauth_connections")
      .delete()
      .eq("user_id", context.userId);

    await context.supabase.from("settings").upsert(
      {
        user_id: context.userId,
        supabase_project_url: null,
        supabase_project_name: null,
        supabase_anon_key: null,
        supabase_connected: false,
      },
      { onConflict: "user_id" },
    );

    return { ok: true };
  });
