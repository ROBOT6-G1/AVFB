import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  listPaymentMethods,
  upsertPaymentMethod,
  deletePaymentMethod,
} from "@/lib/payment-methods.functions";
import { CreditCard, Plus, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/payments")({
  component: PaymentsPage,
});

function PaymentsPage() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => listPaymentMethods(),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    id: undefined as string | undefined,
    label: "",
    number: "",
    instructions: "",
    is_active: true,
  });

  const openNew = () => {
    setForm({ id: undefined, label: "", number: "", instructions: "", is_active: true });
    setOpen(true);
  };
  const openEdit = (p: any) => {
    setForm({
      id: p.id,
      label: p.label,
      number: p.number,
      instructions: p.instructions ?? "",
      is_active: p.is_active,
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      await upsertPaymentMethod({ data: { ...form, instructions: form.instructions || null } });
      toast.success("Enregistré");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Supprimer ?")) return;
    await deletePaymentMethod({ data: { id } });
    qc.invalidateQueries({ queryKey: ["payment-methods"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
            <CreditCard className="h-8 w-8" /> Méthodes de paiement
          </h1>
          <p className="text-muted-foreground mt-1">
            Numéros MVola, Airtel Money, Orange Money… envoyés au client par l'IA.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle méthode
        </Button>
      </div>

      <div className="grid gap-3">
        {items.map((p: any) => (
          <Card key={p.id} className="glass p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">
                {p.label} <span className="text-primary">— {p.number}</span>
              </div>
              {p.instructions && (
                <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {p.instructions}
                </div>
              )}
              {!p.is_active && <div className="text-xs text-warning">Inactif</div>}
            </div>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" onClick={() => openEdit(p)}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => del(p.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </Card>
        ))}
        {items.length === 0 && (
          <Card className="glass p-8 text-center text-muted-foreground">Aucune méthode.</Card>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Modifier" : "Nouvelle méthode"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nom (ex : MVola)</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div>
              <Label>Numéro</Label>
              <Input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </div>
            <div>
              <Label>Instructions (optionnel)</Label>
              <Textarea
                rows={3}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Actif</Label>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
            <Button onClick={save} className="w-full">
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
