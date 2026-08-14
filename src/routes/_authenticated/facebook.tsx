import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listFacebookPages, disconnectFacebookPage } from "@/lib/dashboard.functions";
import { getFacebookLoginUrl, getWebhookConfig } from "@/lib/facebook.functions";
import { Facebook, Trash2, Copy, ExternalLink, Info } from "lucide-react";
import { toast } from "sonner";

const pagesQuery = queryOptions({ queryKey: ["fb-pages"], queryFn: () => listFacebookPages() });
const webhookQuery = queryOptions({ queryKey: ["fb-webhook"], queryFn: () => getWebhookConfig() });

export const Route = createFileRoute("/_authenticated/facebook")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(pagesQuery),
      context.queryClient.ensureQueryData(webhookQuery),
    ]),
  component: FacebookPage,
});

function FacebookPage() {
  const { data: pages } = useSuspenseQuery(pagesQuery);
  const { data: webhook } = useSuspenseQuery(webhookQuery);
  const qc = useQueryClient();

  const connect = async () => {
    try {
      const { url } = await getFacebookLoginUrl();
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };
  const disconnect = async (id: string) => {
    if (!confirm("Déconnecter cette page ?")) return;
    await disconnectFacebookPage({ data: { id } });
    qc.invalidateQueries({ queryKey: ["fb-pages"] });
    toast.success("Déconnectée");
  };
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copié");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text">Facebook</h1>
        <p className="text-muted-foreground mt-1">
          Connectez votre page pour activer les réponses automatiques.
        </p>
      </div>

      <Card className="glass p-6">
        <div className="flex items-center gap-3 mb-4">
          <Facebook className="h-6 w-6 text-primary" />
          <h2 className="font-semibold">Connecter une page</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          L'application demandera les permissions : lecture/envoi de messages, gestion des
          commentaires, lecture des publications.
        </p>
        <Button onClick={connect}>
          <Facebook className="h-4 w-4 mr-2" />
          Connecter avec Facebook
        </Button>
      </Card>

      {pages.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold">Pages connectées</h2>
          {pages.map((p) => (
            <Card key={p.id} className="glass p-4 flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Facebook className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.page_name}</div>
                <div className="text-xs text-muted-foreground">ID : {p.page_id}</div>
              </div>
              {p.webhook_subscribed ? (
                <Badge className="bg-success text-success-foreground">Webhook actif</Badge>
              ) : (
                <Badge variant="outline">Webhook non configuré</Badge>
              )}
              <Button size="icon" variant="ghost" onClick={() => disconnect(p.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Card className="glass p-6">
        <div className="flex items-center gap-3 mb-4">
          <Info className="h-5 w-5 text-accent" />
          <h2 className="font-semibold">Configuration Webhook Meta</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Dans{" "}
          <a
            href="https://developers.facebook.com/apps"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            Meta for Developers <ExternalLink className="h-3 w-3" />
          </a>
          , ajoutez le produit <strong>Webhooks</strong> puis souscrivez à la page avec :
        </p>
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">URL de callback</div>
            <div className="flex gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-xs break-all">
                {webhook.callback_url}
              </code>
              <Button size="icon" variant="ghost" onClick={() => copy(webhook.callback_url)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">
              URL OAuth redirect valide
            </div>
            <div className="flex gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-xs break-all">
                {webhook.oauth_redirect_uri}
              </code>
              <Button size="icon" variant="ghost" onClick={() => copy(webhook.oauth_redirect_uri)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Verify token</div>
            <div className="flex gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-xs break-all">
                {webhook.verify_token}
              </code>
              <Button size="icon" variant="ghost" onClick={() => copy(webhook.verify_token)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Champs à souscrire</div>
            <code className="block rounded bg-muted px-3 py-2 text-xs">
              messages, messaging_postbacks, feed, message_reactions
            </code>
          </div>
        </div>
      </Card>
    </div>
  );
}
