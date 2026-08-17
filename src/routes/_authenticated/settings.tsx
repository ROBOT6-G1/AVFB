import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSettings,
  updateSettings,
  replyAllPendingMessages,
} from "@/lib/dashboard.functions";
import {
  getSupabaseOAuthStatus,
  selectSupabaseProject,
  disconnectSupabaseOAuth,
  getSupabaseAuthUrl,
} from "@/lib/supabase-oauth.functions";
import { Save, Send, Loader2, Facebook, KeyRound, Sparkles, Database, CheckCircle2, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const settingsQuery = queryOptions({ queryKey: ["settings"], queryFn: () => getSettings() });
const supabaseStatusQuery = queryOptions({
  queryKey: ["supabase-oauth-status"],
  queryFn: () => getSupabaseOAuthStatus(),
});

export const Route = createFileRoute("/_authenticated/settings")({
  loader: ({ context }) => {
    return Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(supabaseStatusQuery),
    ]);
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { data } = useSuspenseQuery(settingsQuery);
  const { data: sbStatus } = useSuspenseQuery(supabaseStatusQuery);
  const qc = useQueryClient();
  const [sbConnecting, setSbConnecting] = useState(false);
  const [sbSelecting, setSbSelecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replying, setReplying] = useState(false);
  const [form, setForm] = useState({
    assistance_type: (data as any)?.assistance_type ?? "online_work",
    auto_reply_messages: data?.auto_reply_messages ?? true,
    auto_reply_comments: data?.auto_reply_comments ?? true,
    comment_scan_interval_minutes: data?.comment_scan_interval_minutes ?? 5,
    use_lovable_ai_fallback: data?.use_lovable_ai_fallback ?? true,
    default_model: data?.default_model || "gemini-2.5-flash",
    private_message_link: data?.private_message_link ?? "",
    facebook_app_id: data?.facebook_app_id ?? "",
    facebook_app_secret: data?.facebook_app_secret ?? "",
    facebook_verify_token: data?.facebook_verify_token ?? "",
  });

  useEffect(() => {
    if (data) {
      setForm({
        assistance_type: (data as any).assistance_type ?? "online_work",
        auto_reply_messages: data.auto_reply_messages ?? true,
        auto_reply_comments: data.auto_reply_comments ?? true,
        comment_scan_interval_minutes: data.comment_scan_interval_minutes ?? 5,
        use_lovable_ai_fallback: data.use_lovable_ai_fallback ?? true,
        default_model: data.default_model || "gemini-2.5-flash",
        private_message_link: data.private_message_link ?? "",
        facebook_app_id: data.facebook_app_id ?? "",
        facebook_app_secret: data.facebook_app_secret ?? "",
        facebook_verify_token: data.facebook_verify_token ?? "",
      });
    }
  }, [data]);

  const connectSupabase = async () => {
    setSbConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/api/public/supabase/callback`;
      const { url } = await getSupabaseAuthUrl({
        data: {
          redirectUri,
          userId: data?.user_id || "current_user",
          mode: "connect",
        },
      });

      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        url,
        "supabase_oauth",
        `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`,
      );

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        window.location.href = url;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur OAuth Supabase");
    } finally {
      setSbConnecting(false);
    }
  };

  const handleSelectProject = async (projectId: string) => {
    setSbSelecting(true);
    try {
      await selectSupabaseProject({ data: { projectId } });
      toast.success("Projet Supabase activé pour votre compte !");
      qc.invalidateQueries({ queryKey: ["supabase-oauth-status"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de sélection");
    } finally {
      setSbSelecting(false);
    }
  };

  const handleDisconnectSupabase = async () => {
    if (!confirm("Voulez-vous déconnecter votre compte Supabase ?")) return;
    try {
      await disconnectSupabaseOAuth();
      toast.success("Compte Supabase déconnecté.");
      qc.invalidateQueries({ queryKey: ["supabase-oauth-status"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SUPABASE_OAUTH_SUCCESS") {
        toast.success("Compte Supabase connecté avec succès !");
        qc.invalidateQueries({ queryKey: ["supabase-oauth-status"] });
        qc.invalidateQueries({ queryKey: ["settings"] });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [qc]);

  const save = async () => {
    try {
      await updateSettings({
        data: {
          ...form,
          private_message_link: form.private_message_link || null,
          facebook_app_id: form.facebook_app_id || null,
          facebook_app_secret: form.facebook_app_secret || null,
          facebook_verify_token: form.facebook_verify_token || null,
        } as any,
      });
      toast.success("Paramètres enregistrés");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const replyAll = async () => {
    setReplying(true);
    try {
      const res = await replyAllPendingMessages();
      const detailStr = res.details?.length ? `\n${res.details.join("\n")}` : "";
      if (res.errors > 0 && res.replied === 0) {
        toast.error(
          `${res.replied} réponse(s) envoyée(s) sur ${res.processed} conversation(s) — ${res.errors} erreur(s)${detailStr}`,
        );
      } else {
        toast.success(
          `${res.replied} réponse(s) envoyée(s) sur ${res.processed} conversation(s) en attente${
            res.errors ? ` (${res.errors} erreur(s))` : ""
          }${detailStr}`,
        );
      }
      qc.invalidateQueries({ queryKey: ["messages-log"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setReplying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text">Paramètres</h1>
        <p className="text-muted-foreground mt-1">Comportement de l'IA et de l'automatisation.</p>
      </div>

      <Card className="glass p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Type d'assistance</h2>
            <p className="text-xs text-muted-foreground">
              Change complètement le comportement de l'IA et le menu latéral.
            </p>
          </div>
        </div>
        <Select
          value={form.assistance_type}
          onValueChange={(v) => setForm({ ...form, assistance_type: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="online_work">1. Travail en ligne</SelectItem>
            <SelectItem value="training">2. Formation</SelectItem>
            <SelectItem value="sales">3. Vente</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Enregistre pour appliquer ; le menu latéral s'adapte automatiquement.
        </p>
      </Card>

      <Card className="glass p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">Répondre automatiquement aux messages privés</Label>
            <p className="text-xs text-muted-foreground">
              L'IA répond aux DM Messenger en temps réel.
            </p>
          </div>
          <Switch
            checked={form.auto_reply_messages}
            onCheckedChange={(v) => setForm({ ...form, auto_reply_messages: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">Répondre automatiquement aux commentaires</Label>
            <p className="text-xs text-muted-foreground">
              Scan périodique + réponse automatique des commentaires sans réponse.
            </p>
          </div>
          <Switch
            checked={form.auto_reply_comments}
            onCheckedChange={(v) => setForm({ ...form, auto_reply_comments: v })}
          />
        </div>

        <div>
          <Label>Intervalle de scan des commentaires (minutes)</Label>
          <Input
            type="number"
            min={1}
            max={60}
            value={form.comment_scan_interval_minutes}
            onChange={(e) =>
              setForm({ ...form, comment_scan_interval_minutes: Number(e.target.value) })
            }
          />
        </div>

        <div>
          <Label>Modèle IA par défaut</Label>
          <Select
            value={form.default_model}
            onValueChange={(v) => setForm({ ...form, default_model: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (recommandé)</SelectItem>
              <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
              <SelectItem value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">Fallback Lovable AI</Label>
            <p className="text-xs text-muted-foreground">
              Si toutes les clés Gemini sont épuisées, utiliser Lovable AI.
            </p>
          </div>
          <Switch
            checked={form.use_lovable_ai_fallback}
            onCheckedChange={(v) => setForm({ ...form, use_lovable_ai_fallback: v })}
          />
        </div>

        <div>
          <Label>Lien à envoyer en message privé (optionnel)</Label>
          <Input
            type="url"
            placeholder="https://votresite.com/produit"
            value={form.private_message_link}
            onChange={(e) => setForm({ ...form, private_message_link: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Ce lien peut être inséré dans les messages privés mais jamais dans un commentaire.
          </p>
        </div>

        <Button onClick={save}>
          <Save className="h-4 w-4 mr-2" />
          Enregistrer
        </Button>
      </Card>

      {/* Supabase OAuth Integration */}
      <Card className="glass p-6 space-y-4 border-emerald-500/20">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Base de Données Supabase (OAuth)</h2>
                {sbStatus.isConnected && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Connecté
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Connexion directe à votre organisation Supabase pour synchroniser la base de données et le stockage.
              </p>
            </div>
          </div>

          <div>
            {sbStatus.isConnected ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={connectSupabase}
                  disabled={sbConnecting}
                  className="text-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${sbConnecting ? "animate-spin" : ""}`} />
                  Resynchroniser
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnectSupabase}
                  className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  Déconnecter
                </Button>
              </div>
            ) : (
              <Button
                onClick={connectSupabase}
                disabled={sbConnecting}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-lg shadow-emerald-950/40"
              >
                {sbConnecting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21.362 9.354H12V.343a.343.343 0 0 0-.583-.244L.367 11.15a.343.343 0 0 0 .243.585h9.39v9.011a.343.343 0 0 0 .584.244l11.05-11.051a.343.343 0 0 0-.272-.585z" />
                  </svg>
                )}
                Connecter avec Supabase
              </Button>
            )}
          </div>
        </div>

        {/* Redirect URI helper for Supabase Dashboard */}
        <div className="rounded-lg bg-black/40 border border-emerald-500/20 p-3 text-xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-emerald-400">
              🔗 Redirect URLs à coller dans votre Supabase Dashboard (OAuth Apps) :
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 bg-black/60 p-2 rounded">
              <code className="text-emerald-300 font-mono text-[11px] truncate">
                https://aiserveurpagefb.vercel.app/api/public/supabase/callback
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[10px] shrink-0 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={() => {
                  navigator.clipboard.writeText("https://aiserveurpagefb.vercel.app/api/public/supabase/callback");
                  toast.success("Lien Vercel copié !");
                }}
              >
                Copier Vercel
              </Button>
            </div>

            {typeof window !== "undefined" && !window.location.origin.includes("vercel.app") && (
              <div className="flex items-center justify-between gap-2 bg-black/60 p-2 rounded">
                <code className="text-emerald-300 font-mono text-[11px] truncate">
                  {`${window.location.origin}/api/public/supabase/callback`}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] shrink-0 border-emerald-500/30 hover:bg-emerald-500/10"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/api/public/supabase/callback`);
                    toast.success("Lien actuel copié !");
                  }}
                >
                  Copier actuel
                </Button>
              </div>
            )}
          </div>
        </div>

        {sbStatus.isConnected && (
          <div className="space-y-4 pt-2 border-t border-border/50">
            {sbStatus.projects.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground uppercase font-semibold">
                  Projet actif lié à votre compte
                </Label>
                <div className="mt-1.5 flex gap-2">
                  <Select
                    value={sbStatus.selectedProjectId || ""}
                    onValueChange={(val) => handleSelectProject(val)}
                    disabled={sbSelecting}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Sélectionner un projet Supabase" />
                    </SelectTrigger>
                    <SelectContent>
                      {sbStatus.projects.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.id}) {p.region ? `— ${p.region}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 text-xs bg-muted/40 p-3 rounded-lg border border-border/40">
              <div>
                <span className="text-muted-foreground block">URL du Projet :</span>
                <span className="font-mono text-foreground font-medium break-all">
                  {sbStatus.selectedProjectUrl || "Non configuré"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Organisation(s) liée(s) :</span>
                <span className="text-foreground font-medium">
                  {sbStatus.organizations.length > 0
                    ? sbStatus.organizations.map((o: any) => o.name).join(", ")
                    : "Organisation Supabase"}
                </span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="glass p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Facebook className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Identifiants Facebook Developer</h2>
            <p className="text-xs text-muted-foreground">
              Vous pouvez remplacer l'App ID à tout moment. Ces valeurs sont utilisées pour la
              connexion des pages et le webhook.
            </p>
          </div>
        </div>

        <div>
          <Label>Facebook App ID</Label>
          <Input
            placeholder="1234567890123456"
            value={form.facebook_app_id}
            onChange={(e) => setForm({ ...form, facebook_app_id: e.target.value })}
          />
        </div>

        <div>
          <Label>Facebook App Secret</Label>
          <Input
            type="password"
            placeholder="••••••••••••"
            value={form.facebook_app_secret}
            onChange={(e) => setForm({ ...form, facebook_app_secret: e.target.value })}
          />
        </div>

        <div>
          <Label>Verify Token (Webhook)</Label>
          <Input
            placeholder="mon-verify-token"
            value={form.facebook_verify_token}
            onChange={(e) => setForm({ ...form, facebook_verify_token: e.target.value })}
          />
        </div>

        <Button onClick={save} variant="secondary">
          <KeyRound className="h-4 w-4 mr-2" />
          Enregistrer les identifiants Facebook
        </Button>
      </Card>

      <Card className="glass p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Répondre à tous les messages privés</h2>
          <p className="text-xs text-muted-foreground mt-1">
            L'IA parcourt toutes les conversations Messenger en attente et envoie une réponse
            adaptée.
          </p>
        </div>
        <Button onClick={replyAll} disabled={replying} variant="secondary">
          {replying ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          {replying ? "Traitement en cours…" : "Répondre à tous les messages privés"}
        </Button>
      </Card>
    </div>
  );
}
