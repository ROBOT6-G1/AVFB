import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getSettings } from "@/lib/dashboard.functions";
import { listOrders, updateOrderStatus, deleteOrder } from "@/lib/orders.functions";
import { ClipboardList, Check, X, Trash2, Package } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders")({
  component: OrdersPage,
});

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  awaiting_payment: "Attente paiement",
  payment_sent: "Paiement envoyé",
  accepted: "Accepté",
  refused: "Refusé",
  delivered: "Livré",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/20 text-warning",
  awaiting_payment: "bg-warning/20 text-warning",
  payment_sent: "bg-primary/20 text-primary",
  accepted: "bg-accent/20 text-accent",
  refused: "bg-destructive/20 text-destructive",
  delivered: "bg-accent/20 text-accent",
};

function OrdersPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });
  const type = ((settings as any)?.assistance_type === "sales" ? "sales" : "training") as
    "sales" | "training";
  const { data: orders = [] } = useQuery({
    queryKey: ["orders", type],
    queryFn: () => listOrders({ data: { type } }),
    enabled: !!settings,
  });

  const setStatus = async (id: string, status: any) => {
    try {
      await updateOrderStatus({ data: { id, status } });
      toast.success("Statut mis à jour");
      qc.invalidateQueries({ queryKey: ["orders", type] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette commande ?")) return;
    await deleteOrder({ data: { id } });
    qc.invalidateQueries({ queryKey: ["orders", type] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
          <ClipboardList className="h-8 w-8" /> Commandes{" "}
          {type === "training" ? "— Formation" : "— Vente"}
        </h1>
        <p className="text-muted-foreground mt-1">
          Vérifiez et validez les commandes créées par l'IA.
        </p>
      </div>

      <div className="space-y-3">
        {orders.map((o: any) => (
          <Card key={o.id} className="glass p-5 space-y-3">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-semibold">
                    {o.trainings?.name ?? o.products?.name ?? "Article inconnu"}
                  </span>
                  {o.quantity > 1 && (
                    <span className="text-xs text-muted-foreground">×{o.quantity}</span>
                  )}
                  <Badge className={STATUS_COLORS[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Créée le {new Date(o.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-1">
                {o.status !== "accepted" && o.status !== "delivered" && (
                  <Button size="sm" variant="default" onClick={() => setStatus(o.id, "accepted")}>
                    <Check className="h-4 w-4 mr-1" />
                    Accepter
                  </Button>
                )}
                {o.status !== "refused" && (
                  <Button size="sm" variant="secondary" onClick={() => setStatus(o.id, "refused")}>
                    <X className="h-4 w-4 mr-1" />
                    Refuser
                  </Button>
                )}
                {o.status === "accepted" && (
                  <Button size="sm" variant="default" onClick={() => setStatus(o.id, "delivered")}>
                    Marquer livré
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => remove(o.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-2 text-sm bg-muted/30 rounded p-3">
              {o.client_fb_name && (
                <div>
                  <span className="text-muted-foreground">Facebook :</span> {o.client_fb_name}
                </div>
              )}
              {o.client_whatsapp && (
                <div>
                  <span className="text-muted-foreground">WhatsApp :</span> {o.client_whatsapp}
                </div>
              )}
              {o.client_phone && (
                <div>
                  <span className="text-muted-foreground">Téléphone :</span> {o.client_phone}
                </div>
              )}
              {o.client_address && (
                <div className="col-span-full">
                  <span className="text-muted-foreground">Adresse :</span> {o.client_address}
                </div>
              )}
              {o.payment_reference && (
                <div>
                  <span className="text-muted-foreground">Réf. paiement :</span>{" "}
                  {o.payment_reference}
                </div>
              )}
              {o.notes && (
                <div className="col-span-full">
                  <span className="text-muted-foreground">Notes :</span> {o.notes}
                </div>
              )}
            </div>
          </Card>
        ))}
        {orders.length === 0 && (
          <Card className="glass p-8 text-center text-muted-foreground">
            Aucune commande pour le moment.
          </Card>
        )}
      </div>
    </div>
  );
}
