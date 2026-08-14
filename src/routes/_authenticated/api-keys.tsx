import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  listGeminiKeys,
  upsertGeminiKey,
  deleteGeminiKey,
  toggleGeminiKey,
  resetAllGeminiKeys,
  testGeminiKey,
} from "@/lib/dashboard.functions";
import { Plus, Trash2, KeyRound, RotateCcw, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const keysQuery = queryOptions({ queryKey: ["gemini-keys"], queryFn: () => listGeminiKeys() });

export const Route = createFileRoute("/_authenticated/api-keys")({
  loader: ({ context }) => context.queryClient.ensureQueryData(keysQuery),
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { data } = useSuspenseQuery(keysQuery);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", api_key: "", is_active: true });

  const save = async () => {
    if (data.length >= 20) {
      toast.error("Maximum 20 clés atteintes");
      return;
    }
    try {
      const res = await upsertGeminiKey({ data: form });
      toast.success("Clé enregistrée et validée avec succès par Google !");
      setOpen(false);
      setForm({ label: "", api_key: "", is_active: true });
      qc.invalidateQueries({ queryKey: ["gemini-keys"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'enregistrement de la clé");
    }
  };

  const testKey = async (id: string) => {
    setTestingId(id);
    try {
      const res = await testGeminiKey({ data: { id } });
      const modelCount = res.models?.length ?? 0;
      toast.success(`Clé fonctionnelle ! ${modelCount} modèlen(s) détecté(s) chez Google.`);
      qc.invalidateQueries({ queryKey: ["gemini-keys"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clé inaccessible");
    } finally {
      setTestingId(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette clé ?")) return;
    await deleteGeminiKey({ data: { id } });
    qc.invalidateQueries({ queryKey: ["gemini-keys"] });
    toast.success("Supprimée");
  };
  const toggle = async (id: string, is_active: boolean) => {
    await toggleGeminiKey({ data: { id, is_active } });
    qc.invalidateQueries({ queryKey: ["gemini-keys"] });
  };
  const resetAll = async () => {
    try {
      await resetAllGeminiKeys();
      toast.success("Toutes les clés ont été réactivées et réinitialisées.");
      qc.invalidateQueries({ queryKey: ["gemini-keys"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Clés API Gemini</h1>
          <p className="text-muted-foreground mt-1">
            Prise en charge universelle des clés Google Gemini (formats <span className="font-mono text-foreground font-semibold">AIza...</span> et nouveaux formats <span className="font-mono text-foreground font-semibold">AQ...</span>) —{" "}
            <span className="text-foreground font-medium">
              {data.filter((k) => k.is_active).length}/{data.length}
            </span>{" "}
            actives.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.length > 0 && (
            <Button variant="outline" onClick={resetAll} title="Réinitialiser le statut de toutes les clés">
              <RotateCcw className="h-4 w-4 mr-2" />
              Réinitialiser
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={data.length >= 20}>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter une clé
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvelle clé Gemini</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Étiquette (Nom)</Label>
                  <Input
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="Ex : Compte principal"
                  />
                </div>
                <div>
                  <Label>Clé API Google Gemini</Label>
                  <Input
                    type="password"
                    value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    placeholder="AIza... ou AQ..."
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Les clés commençant par <strong>AIza...</strong> ou <strong>AQ...</strong> sont toutes deux prises en charge. Obtenez une clé sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline text-primary">aistudio.google.com/apikey</a>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                  />
                  <Label>Active immédiatement</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Annuler
                </Button>
                <Button onClick={save}>Enregistrer & Valider</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {data.length === 0 ? (
        <Card className="glass p-12 text-center">
          <KeyRound className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">
            Aucune clé Gemini. Ajoutez-en pour activer les réponses IA.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {data.map((k) => {
            const disabled = k.disabled_until && new Date(k.disabled_until) > new Date();
            const isTesting = testingId === k.id;
            return (
              <Card key={k.id} className="glass p-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                <KeyRound className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{k.label}</span>
                    <code className="text-xs text-muted-foreground">{k.api_key_masked}</code>
                    {disabled && (
                      <Badge variant="destructive">En pause ({k.error_count} err)</Badge>
                    )}
                    {k.last_used_at && !disabled && <Badge variant="secondary">Active</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isTesting}
                    onClick={() => testKey(k.id)}
                    title="Tester la clé auprès de Google Gemini API"
                  >
                    {isTesting ? "Test en cours..." : "Tester la clé"}
                  </Button>
                  <Switch checked={k.is_active} onCheckedChange={(v) => toggle(k.id, v)} />
                  {disabled && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggle(k.id, true)}
                      title="Réactiver"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => remove(k.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
