import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listCommentsLog } from "@/lib/dashboard.functions";
import { triggerCommentScan } from "@/lib/facebook.functions";
import { MessagesSquare, RefreshCw, Play } from "lucide-react";
import { toast } from "sonner";

const commentsQuery = queryOptions({
  queryKey: ["comments-log"],
  queryFn: () => listCommentsLog(),
});

export const Route = createFileRoute("/_authenticated/comments")({
  loader: ({ context }) => context.queryClient.ensureQueryData(commentsQuery),
  component: CommentsPage,
});

function CommentsPage() {
  const { data } = useSuspenseQuery(commentsQuery);
  const [loading, setLoading] = useState(false);

  const qc = useQueryClient();
  const scan = async () => {
    setLoading(true);
    try {
      const res = await triggerCommentScan({ data: {} });
      if (res.errors && res.errors > 0 && res.replied === 0) {
        toast.error(res.note ?? `${res.replied} réponse(s) envoyée(s) — ${res.errors} erreur(s)`);
      } else {
        toast.success(res.note ?? `${res.replied} réponse(s) envoyée(s)`);
      }
      qc.invalidateQueries({ queryKey: ["comments-log"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Commentaires</h1>
          <p className="text-muted-foreground mt-1">
            Scan automatique toutes les 5 min — l'IA répond aux commentaires sans réponse.
          </p>
        </div>
        <Button onClick={scan} disabled={loading}>
          {loading ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Scanner maintenant
        </Button>
      </div>

      <Card className="glass p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Règle :</strong> l'IA lit la publication complète avant
        de répondre, ne poste jamais de lien dans un commentaire, et invite l'utilisateur à passer
        en message privé pour recevoir un lien.
      </Card>

      {data.length === 0 ? (
        <Card className="glass p-12 text-center">
          <MessagesSquare className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">
            Aucun commentaire encore. Connectez d'abord votre page.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.map((c) => (
            <Card key={c.id} className="glass p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{c.author_name ?? "Anonyme"}</span>
                    {c.replied ? (
                      <Badge className="bg-success text-success-foreground">Répondu</Badge>
                    ) : (
                      <Badge variant="outline">En attente</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString("fr-FR")}
                    </span>
                  </div>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{c.content}</p>
                  {c.ai_response && (
                    <div className="mt-3 border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground whitespace-pre-wrap">
                      {c.ai_response}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
