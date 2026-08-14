import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Users, Send, Bot, User } from "lucide-react";
import {
  listConversations,
  listConversationMessages,
  sendDiscussionMessage,
} from "@/lib/discussions.functions";
import { setClientIaStopped } from "@/lib/ia-control.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/discussions")({
  component: DiscussionsPage,
});

function DiscussionsPage() {
  const qc = useQueryClient();
  const { data: convs = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConversations(),
    refetchInterval: 15000,
  });
  const [selected, setSelected] = useState<any | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const { data: messages = [] } = useQuery({
    queryKey: ["conversation", selected?.page_id, selected?.client_fb_id],
    queryFn: () =>
      listConversationMessages({
        data: { page_id: selected.page_id, client_fb_id: selected.client_fb_id },
      }),
    enabled: !!selected,
    refetchInterval: 10000,
  });

  const send = async () => {
    if (!selected || !text.trim()) return;
    setSending(true);
    try {
      await sendDiscussionMessage({
        data: { page_id: selected.page_id, client_fb_id: selected.client_fb_id, text: text.trim() },
      });
      setText("");
      qc.invalidateQueries({ queryKey: ["conversation", selected.page_id, selected.client_fb_id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSending(false);
    }
  };

  const toggleIa = async (v: boolean) => {
    if (!selected) return;
    try {
      await setClientIaStopped({
        data: {
          page_id: selected.page_id,
          client_fb_id: selected.client_fb_id,
          client_fb_name: selected.client_fb_name,
          ia_stopped: v,
        },
      });
      toast.success(v ? "IA arrêtée pour ce client" : "IA réactivée");
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setSelected({ ...selected, ia_stopped: v });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
          <Users className="h-8 w-8" /> Discussions
        </h1>
        <p className="text-muted-foreground mt-1">Reprenez la main sur une conversation client.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 h-[70vh]">
        <Card className="glass p-3 overflow-y-auto">
          <div className="text-xs font-medium text-muted-foreground mb-2 px-2">
            {convs.length} conversation(s)
          </div>
          <div className="space-y-1">
            {convs.map((c: any) => (
              <button
                key={`${c.page_id}::${c.client_fb_id}`}
                onClick={() => setSelected(c)}
                className={`w-full text-left rounded-lg p-3 transition ${
                  selected?.client_fb_id === c.client_fb_id
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate text-sm">{c.client_fb_name}</span>
                  {c.ia_stopped && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive">
                      IA off
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">{c.last_message}</div>
              </button>
            ))}
            {convs.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-6">
                Aucune conversation.
              </div>
            )}
          </div>
        </Card>

        <Card className="glass p-0 md:col-span-2 flex flex-col">
          {selected ? (
            <>
              <div className="p-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">{selected.client_fb_name}</div>
                  <div className="text-xs text-muted-foreground">Page : {selected.page_id}</div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span>Stop IA</span>
                  <Switch checked={selected.ia_stopped ?? false} onCheckedChange={toggleIa} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m: any) => {
                  const isAi = m.direction === "outgoing";
                  return (
                    <div key={m.id} className={`flex ${isAi ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                          isAi ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        <div className="flex items-center gap-1 text-[10px] opacity-70 mb-1">
                          {isAi ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          {new Date(m.created_at).toLocaleTimeString()}
                        </div>
                        <div className="whitespace-pre-wrap">{m.content || m.ai_response}</div>
                        {m.media_url && (
                          <img src={m.media_url} alt="" className="mt-2 rounded max-w-full" />
                        )}
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    Aucun message.
                  </div>
                )}
              </div>

              <div className="p-3 border-t border-border flex gap-2">
                <Input
                  placeholder="Écrire un message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                />
                <Button onClick={send} disabled={sending || !text.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Sélectionnez une conversation.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
