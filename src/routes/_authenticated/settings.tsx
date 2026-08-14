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
import { getSettings, updateSettings, replyAllPendingMessages } from "@/lib/dashboard.functions";
import { Save, Send, Loader2, Facebook, KeyRound, Sparkles } from "lucide-react";
import { toast } from "sonner";

const settingsQuery = queryOptions({ queryKey: ["settings"], queryFn: () => getSettings() });

export const Route = createFileRoute("/_authenticated/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: SettingsPage,
});

function SettingsPage() {
  const { data } = useSuspenseQuery(settingsQuery);
  const qc = useQueryClient();
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

  const [replying, setReplying] = useState(false);

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
