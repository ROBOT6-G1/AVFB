import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const SUPABASE_OAUTH_CLIENT_ID =
  process.env.SUPABASE_OAUTH_CLIENT_ID || "3ba5bc56-738c-451f-bf87-a757909ce7f3";

export const SUPABASE_OAUTH_CLIENT_SECRET =
  process.env.SUPABASE_OAUTH_CLIENT_SECRET || "sba_8257cd0a7c4802b7f8de9b3616063d512efd507c";

export function getSupabaseOAuthAuthorizeUrl(redirectUri: string, state: string = ""): string {
  const url = new URL("https://api.supabase.com/v1/oauth/authorize");
  url.searchParams.set("client_id", SUPABASE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "all");
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

export interface SupabaseTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export async function exchangeSupabaseAuthCode(
  code: string,
  redirectUri: string,
): Promise<SupabaseTokenResponse> {
  const tokenUrl = "https://api.supabase.com/v1/oauth/token";

  // Try standard x-www-form-urlencoded POST
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", SUPABASE_OAUTH_CLIENT_ID);
  body.set("client_secret", SUPABASE_OAUTH_CLIENT_SECRET);
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const json = (await res.json()) as SupabaseTokenResponse;
  if (!res.ok || json.error) {
    throw new Error(
      json.error_description || json.error || `Erreur Supabase OAuth token exchange (${res.status})`,
    );
  }

  return json;
}

export interface SupabaseProject {
  id: string;
  ref?: string;
  name: string;
  organization_id?: string;
  region?: string;
  created_at?: string;
  status?: string;
  anon_key?: string;
  service_role_key?: string;
  project_url?: string;
}

export interface SupabaseOrganization {
  id: string;
  name: string;
}

export async function fetchSupabaseOrganizations(
  accessToken: string,
): Promise<SupabaseOrganization[]> {
  try {
    const res = await fetch("https://api.supabase.com/v1/organizations", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return [];
    return (await res.json()) as SupabaseOrganization[];
  } catch (e) {
    console.error("[supabase-oauth] organizations error:", e);
    return [];
  }
}

export async function fetchSupabaseProjects(accessToken: string): Promise<SupabaseProject[]> {
  try {
    const res = await fetch("https://api.supabase.com/v1/projects", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return [];
    const projects = (await res.json()) as SupabaseProject[];

    // Fetch API keys for each project
    const enriched: SupabaseProject[] = await Promise.all(
      projects.map(async (p) => {
        const projectRef = p.id;
        const projectUrl = `https://${projectRef}.supabase.co`;
        let anon_key = "";
        let service_role_key = "";

        try {
          const keysRes = await fetch(
            `https://api.supabase.com/v1/projects/${projectRef}/api-keys`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            },
          );
          if (keysRes.ok) {
            const keys = (await keysRes.json()) as Array<{ name: string; api_key: string }>;
            for (const k of keys) {
              if (k.name === "anon" || k.name === "public") anon_key = k.api_key;
              if (k.name === "service_role" || k.name === "secret") service_role_key = k.api_key;
            }
          }
        } catch (err) {
          console.warn("[supabase-oauth] key fetch warning for project", projectRef, err);
        }

        return {
          ...p,
          project_url: projectUrl,
          anon_key,
          service_role_key,
        };
      }),
    );

    return enriched;
  } catch (e) {
    console.error("[supabase-oauth] projects error:", e);
    return [];
  }
}

export async function saveSupabaseOAuthConnection(
  userId: string,
  params: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    organizations: SupabaseOrganization[];
    projects: SupabaseProject[];
  },
) {
  const activeProject = params.projects.length > 0 ? params.projects[0] : null;

  // 1. Save connection object
  await supabaseAdmin.from("supabase_oauth_connections").upsert(
    {
      user_id: userId,
      access_token: params.accessToken,
      refresh_token: params.refreshToken || null,
      token_expires_at: params.expiresIn ? Date.now() + params.expiresIn * 1000 : null,
      organizations: params.organizations,
      projects: params.projects,
      selected_project_id: activeProject?.id || null,
      selected_project_name: activeProject?.name || null,
      selected_project_url: activeProject?.project_url || null,
      is_connected: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  // 2. Also record in user settings for quick access
  if (activeProject?.project_url) {
    await supabaseAdmin.from("settings").upsert(
      {
        user_id: userId,
        supabase_project_url: activeProject.project_url,
        supabase_project_name: activeProject.name,
        supabase_anon_key: activeProject.anon_key || null,
        supabase_connected: true,
      },
      { onConflict: "user_id" },
    );
  }

  return { activeProject, count: params.projects.length };
}
