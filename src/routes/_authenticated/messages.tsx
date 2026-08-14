import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listMessagesLog } from "@/lib/dashboard.functions";
import { MessageSquare } from "lucide-react";

const messagesQuery = queryOptions({
  queryKey: ["messages-log"],
  queryFn: () => listMessagesLog(),
});

export const Route = createFileRoute("/_authenticated/messages")({
  loader: ({ context }) => context.queryClient.ensureQueryData(messagesQuery),
  component: MessagesPage,
});

function MessagesPage() {
  const { data } = useSuspenseQuery(messagesQuery);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text">Messages privés</h1>
        <p className="text-muted-foreground mt-1">
          Historique des conversations Messenger traitées par l'IA.
        </p>
      </div>

      {data.length === 0 ? (
        <Card className="glass p-12 text-center">
          <MessageSquare className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">
            Aucun message. Connectez votre page Facebook pour commencer.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.map((m) => (
            <Card key={m.id} className="glass p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={m.direction === "incoming" ? "secondary" : "default"}>
                  {m.direction === "incoming" ? "Reçu" : "Envoyé"}
                </Badge>
                <span className="font-medium">{m.sender_name ?? m.sender_id}</span>
                {m.media_type && <Badge variant="outline">{m.media_type}</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(m.created_at).toLocaleString("fr-FR")}
                </span>
              </div>
              {m.content && <p className="text-sm mt-2 whitespace-pre-wrap">{m.content}</p>}
              {m.ai_response && (
                <div className="mt-3 border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground whitespace-pre-wrap">
                  {m.ai_response}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
