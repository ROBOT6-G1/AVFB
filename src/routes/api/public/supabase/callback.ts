import { createFileRoute } from "@tanstack/react-router";
import {
  exchangeSupabaseAuthCode,
  fetchSupabaseOrganizations,
  fetchSupabaseProjects,
  saveSupabaseOAuthConnection,
} from "@/lib/supabase-oauth.server";

export const Route = createFileRoute("/api/public/supabase/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (error) {
          return htmlPage(
            `<h2>Connexion refusée</h2><p>${escapeHtml(errorDescription || error)}</p><p style="margin-top:20px"><a href="/dashboard" style="display:inline-block;padding:10px 20px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none">Retour au tableau de bord</a></p>`,
            400,
          );
        }

        if (!code) {
          return htmlPage(
            `<h2>Code manquant</h2><p>Le paramètre code d'autorisation est absent.</p><p><a href="/dashboard">Retour</a></p>`,
            400,
          );
        }

        const origin = `${url.protocol}//${url.host}`;
        const redirectUri = `${origin}/api/public/supabase/callback`;

        try {
          // 1. Exchange code for access tokens
          const tokenData = await exchangeSupabaseAuthCode(code, redirectUri);
          const accessToken = tokenData.access_token;

          // 2. Fetch user's organizations and projects
          const [orgs, projects] = await Promise.all([
            fetchSupabaseOrganizations(accessToken),
            fetchSupabaseProjects(accessToken),
          ]);

          // Parse state
          const [mode, rawUserId] = (state || "connect:anonymous").split(":");
          let userId = rawUserId && rawUserId !== "anonymous" ? rawUserId : "";

          if (!userId) {
            // Determine identifier from org or first project
            const orgName = orgs[0]?.name || "Supabase Organization";
            const projectRef = projects[0]?.id || "supabase_user";
            userId = `sb_${projectRef.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
          }

          // 3. Save connection into DB
          const result = await saveSupabaseOAuthConnection(userId, {
            accessToken,
            refreshToken: tokenData.refresh_token,
            expiresIn: tokenData.expires_in,
            organizations: orgs,
            projects,
          });

          // Generate session token for login if needed
          const email =
            orgs[0]?.name ? `${orgs[0].name.toLowerCase().replace(/\s+/g, ".")}@supabase.app` : "user@supabase.app";
          const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
          const payload = Buffer.from(JSON.stringify({ sub: userId, email })).toString("base64");
          const sessionToken = `${header}.${payload}.mock_signature`;
          const sessionUser = { uid: userId, email, token: sessionToken };

          const projectCount = projects.length;
          const activeProjName = result.activeProject?.name || "Projet Supabase";

          return htmlPage(`
            <div style="text-align:center;">
              <div style="display:inline-flex;width:64px;height:64px;border-radius:16px;background:rgba(16,185,129,0.15);color:#10b981;align-items:center;justify-content:center;margin-bottom:16px;">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 6 9 17l-5-5"/>
                </svg>
              </div>
              <h2 style="font-size:22px;margin:0 0 8px 0;color:#f9fafb;">Compte Supabase connecté !</h2>
              <p style="color:#9ca3af;font-size:14px;line-height:1.5;margin:0 0 16px 0;">
                ${projectCount} projet(s) Supabase détecté(s).<br/>
                <strong style="color:#10b981;">${escapeHtml(activeProjName)}</strong> est configuré avec succès.
              </p>

              <div style="margin-top:24px;display:flex;flex-direction:column;gap:12px;align-items:center;">
                <button id="btn-close" onclick="closeOrBack()" style="display:inline-block;width:100%;max-width:320px;padding:12px 24px;background:#10b981;color:#fff;font-weight:600;border:none;border-radius:10px;cursor:pointer;font-size:15px;box-shadow:0 4px 12px rgba(16,185,129,0.3);">
                  Fermer &amp; Retourner à l'Application
                </button>
                <p id="sub-hint" style="color:#6b7280;font-size:12px;margin:0;">
                  Si cette fenêtre ne se ferme pas automatiquement, fermez cet onglet manuellement.
                </p>
              </div>
            </div>
            <script>
              const sessionUser = ${JSON.stringify(sessionUser)};
              try {
                localStorage.setItem("agence_virtuelle_user_session", JSON.stringify(sessionUser));
                sessionStorage.setItem("agence_virtuelle_user_session", JSON.stringify(sessionUser));
                window.dispatchEvent(new Event("storage"));
                window.dispatchEvent(new Event("agence_virtuelle_auth_change"));
              } catch(e) {}

              function notifyParent() {
                try {
                  if (window.opener && !window.opener.closed) {
                    window.opener.postMessage({
                      type: "SUPABASE_OAUTH_SUCCESS",
                      sessionUser: sessionUser,
                      projectsCount: ${projectCount},
                      activeProject: ${JSON.stringify(result.activeProject || null)}
                    }, "*");
                  }
                } catch (e) {}

                try {
                  if (window.parent && window.parent !== window) {
                    window.parent.postMessage({
                      type: "SUPABASE_OAUTH_SUCCESS",
                      sessionUser: sessionUser,
                    }, "*");
                  }
                } catch (e) {}
              }

              notifyParent();

              function closeOrBack() {
                notifyParent();
                try {
                  window.close();
                } catch (e) {}
                setTimeout(() => {
                  window.history.back();
                }, 400);
              }

              if (window.opener && !window.opener.closed) {
                setTimeout(() => {
                  try {
                    window.close();
                  } catch (e) {}
                }, 1500);
              }
            </script>
          `);
        } catch (e) {
          console.error("[supabase oauth callback error]", e);
          return htmlPage(
            `<h2>Erreur de connexion Supabase</h2><p style="color:#f87171;">${escapeHtml(
              e instanceof Error ? e.message : String(e),
            )}</p><p style="margin-top:20px"><a href="/dashboard" style="display:inline-block;padding:10px 20px;background:#374151;color:#fff;border-radius:8px;text-decoration:none">Retour au tableau de bord</a></p>`,
            500,
          );
        }
      },
    },
  },
});

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function htmlPage(inner: string, status = 200) {
  return new Response(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Supabase OAuth</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0b0f17;
      color: #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    main {
      max-width: 480px;
      width: 100%;
      background: #111827;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }
  </style>
</head>
<body>
  <main>${inner}</main>
</body>
</html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
