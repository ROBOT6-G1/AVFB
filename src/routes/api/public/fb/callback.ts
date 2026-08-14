import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/fb/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          return htmlPage(
            `<h2>Connexion refusée</h2><p>${escapeHtml(error)}</p><p><a href="/facebook">Retour</a></p>`,
          );
        }
        if (!code || !state) {
          return htmlPage(
            `<h2>Paramètres manquants</h2><p><a href="/facebook">Retour</a></p>`,
            400,
          );
        }

        const [stateUserId, , stateAppId = ""] = state.split(".");
        let userId = stateUserId;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let { data: s, error: settingsError } = await supabaseAdmin
          .from("settings")
          .select("user_id,facebook_app_id,facebook_app_secret")
          .eq("user_id", userId)
          .maybeSingle();

        if ((!s?.facebook_app_id || !s?.facebook_app_secret) && stateAppId) {
          const fallback = await supabaseAdmin
            .from("settings")
            .select("user_id,facebook_app_id,facebook_app_secret")
            .eq("facebook_app_id", stateAppId.trim())
            .not("facebook_app_secret", "is", null)
            .limit(1)
            .maybeSingle();
          if (fallback.data?.facebook_app_id && fallback.data?.facebook_app_secret) {
            s = fallback.data;
            userId = fallback.data.user_id;
            settingsError = null;
          }
        }

        if (settingsError) {
          console.error("[fb callback] settings lookup error", settingsError.message);
        }
        const appId = s?.facebook_app_id?.trim();
        const appSecret = s?.facebook_app_secret?.trim();
        if (!appId || !appSecret) {
          return htmlPage(
            `<h2>Configuration manquante</h2><p>Facebook App ID / App Secret tsy hita amin'ity lien public ity. Sokafy ny lien public, avereno enregistrer ao Paramètres, dia tsindrio indray Connecter avec Facebook.</p><p><a href="/settings">Ouvrir Paramètres</a></p>`,
            500,
          );
        }

        const proto = url.protocol;
        const redirectUri = `${proto}//${url.host}/api/public/fb/callback`;

        try {
          // 1. Exchange code -> short-lived user token
          const tokenRes = await fetch(
            `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`,
          );
          const tokenData: any = await tokenRes.json();
          if (!tokenData.access_token)
            throw new Error(tokenData.error?.message ?? "Token exchange failed");

          // 2. Exchange for long-lived token
          const llRes = await fetch(
            `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`,
          );
          const llData: any = await llRes.json();
          const userToken = llData.access_token ?? tokenData.access_token;
          const expiresAt = llData.expires_in
            ? new Date(Date.now() + llData.expires_in * 1000).toISOString()
            : null;

          const requiredPermissions = [
            "pages_show_list",
            "pages_read_engagement",
            "pages_manage_posts",
          ];
          const permRes = await fetch(
            `https://graph.facebook.com/v21.0/me/permissions?access_token=${userToken}`,
          );
          const permData: any = await permRes.json();
          const granted = new Set(
            (permData.data ?? [])
              .filter((permission: any) => permission.status === "granted")
              .map((permission: any) => permission.permission),
          );
          const missingPermissions = requiredPermissions.filter(
            (permission) => !granted.has(permission),
          );
          if (missingPermissions.length > 0) {
            return htmlPage(
              `<h2>Permission Facebook manquante</h2><p>Facebook n'a pas encore accordé : <strong>${escapeHtml(missingPermissions.join(", "))}</strong>.</p><p>Cliquez à nouveau sur connecter et acceptez toutes les permissions demandées.</p><p><a href="/facebook">Reconnecter</a></p>`,
              403,
            );
          }

          // 3. List pages
          const pagesRes = await fetch(
            `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,tasks&access_token=${userToken}`,
          );
          const pagesData: any = await pagesRes.json();
          const pages: Array<{ id: string; name: string; access_token: string; tasks?: string[] }> =
            pagesData.data ?? [];
          if (pages.length === 0) {
            return htmlPage(
              `<h2>Aucune page trouvée</h2><p>Assurez-vous d'avoir sélectionné une page lors de la connexion.</p><p><a href="/facebook">Retour</a></p>`,
            );
          }

          const publishablePages = pages.filter((p) => p.tasks?.includes("CREATE_CONTENT") ?? true);
          if (publishablePages.length === 0) {
            return htmlPage(
              `<h2>Permission publication manquante</h2><p>Votre compte n'a pas le droit de publier sur les pages sélectionnées. Dans Facebook, donnez le rôle avec accès création de contenu, puis reconnectez la page.</p><p><a href="/facebook">Retour</a></p>`,
              403,
            );
          }

          const SUBSCRIBE_FIELDS = "messages,messaging_postbacks,feed,message_reactions";
          for (const p of publishablePages) {
            // Subscribe the page to webhook events
            let subscribed = false;
            try {
              const subRes = await fetch(
                `https://graph.facebook.com/v21.0/${p.id}/subscribed_apps?subscribed_fields=${SUBSCRIBE_FIELDS}&access_token=${p.access_token}`,
                { method: "POST" },
              );
              const subJson: any = await subRes.json();
              subscribed = !!subJson.success;
            } catch (err) {
              console.error("[fb subscribe]", p.id, err);
            }
            await supabaseAdmin.from("facebook_pages").upsert(
              {
                user_id: userId,
                page_id: p.id,
                page_name: p.name,
                page_access_token: p.access_token,
                user_access_token: userToken,
                token_expires_at: expiresAt,
                is_connected: true,
                webhook_subscribed: subscribed,
              },
              { onConflict: "user_id,page_id" },
            );
          }

          return htmlPage(
            `<h2>✓ ${publishablePages.length} page(s) connectée(s)</h2><ul>${publishablePages.map((p) => `<li>${escapeHtml(p.name)}</li>`).join("")}</ul><p>Permissions publication vérifiées. Redirection…</p><script>setTimeout(()=>location.href='/facebook',1500)</script>`,
          );
        } catch (e) {
          return htmlPage(
            `<h2>Erreur</h2><p>${escapeHtml(e instanceof Error ? e.message : String(e))}</p><p><a href="/facebook">Retour</a></p>`,
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
    `<!doctype html><html><head><meta charset="utf-8"><title>Facebook</title><style>body{font-family:system-ui;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}main{max-width:500px;text-align:center}a{color:#4dd0e1}</style></head><body><main>${inner}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
