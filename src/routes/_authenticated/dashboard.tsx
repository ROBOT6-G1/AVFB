import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getDashboardStats, getSettings } from "@/lib/dashboard.functions";
import { setGlobalIaStopped } from "@/lib/ia-control.functions";
import {
  MessageSquare,
  MessagesSquare,
  KeyRound,
  Facebook,
  Bot,
  Power,
  PowerOff,
} from "lucide-react";
import { toast } from "sonner";

const statsQuery = queryOptions({
  queryKey: ["dashboard-stats"],
  queryFn: () => getDashboardStats(),
});
const settingsQuery = queryOptions({ queryKey: ["settings"], queryFn: () => getSettings() });

export const Route = createFileRoute("/_authenticated/dashboard")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(statsQuery),
      context.queryClient.ensureQueryData(settingsQuery),
    ]),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useSuspenseQuery(statsQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const qc = useQueryClient();
  const stopped = (settings as any)?.global_ia_stopped ?? false;

  const toggle = async (v: boolean) => {
    try {
      await setGlobalIaStopped({ data: { stopped: v } });
      toast.success(v ? "IA arrêtée pour tous les clients" : "IA réactivée");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const cards = [
    { label: "Messages traités", value: data.messages, icon: MessageSquare, color: "text-primary" },
    {
      label: "Commentaires répondus",
      value: data.comments_replied,
      icon: MessagesSquare,
      color: "text-accent",
    },
    {
      label: "Clés Gemini actives",
      value: data.active_keys,
      icon: KeyRound,
      color: "text-warning",
    },
    {
      label: "Pages connectées",
      value: data.connected_pages,
      icon: Facebook,
      color: "text-primary",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold gradient-text">Vue d'ensemble</h1>
        <p className="text-muted-foreground mt-1">
          Bienvenue dans votre tableau de bord Assistante Virtuelle.
        </p>
      </div>

      <Card
        className={`glass p-6 border-2 ${stopped ? "border-destructive/50 bg-destructive/5" : "border-primary/30"}`}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className={`h-11 w-11 rounded-lg flex items-center justify-center ${stopped ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"}`}
            >
              {stopped ? <PowerOff className="h-5 w-5" /> : <Power className="h-5 w-5" />}
            </div>
            <div>
              <div className="font-semibold text-lg">Stop IA global</div>
              <p className="text-xs text-muted-foreground">
                {stopped
                  ? "L'IA ne répond à personne actuellement."
                  : "L'IA répond automatiquement aux messages et commentaires."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{stopped ? "Arrêtée" : "Active"}</span>
            <Switch checked={stopped} onCheckedChange={toggle} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="glass p-5">
            <div
              className={`inline-flex h-10 w-10 items-center justify-center rounded-lg bg-muted ${c.color}`}
            >
              <c.icon className="h-5 w-5" />
            </div>
            <div className="mt-4 text-3xl font-bold">{c.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{c.label}</div>
          </Card>
        ))}
      </div>

      <Card className="glass p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">Démarrage rapide</h2>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>
                Choisissez le <strong className="text-foreground">type d'assistance</strong> dans
                Paramètres.
              </li>
              <li>
                Ajoutez vos <strong className="text-foreground">prompts</strong> pour guider l'IA.
              </li>
              <li>
                Ajoutez vos <strong className="text-foreground">clés Gemini</strong>.
              </li>
              <li>
                Connectez votre <strong className="text-foreground">page Facebook</strong>.
              </li>
            </ol>
          </div>
        </div>
      </Card>
    </div>
  );
}
