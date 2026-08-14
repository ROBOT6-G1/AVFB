import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  listTrainings,
  upsertTraining,
  deleteTraining,
  addTrainingFile,
  deleteTrainingFile,
  getTrainingFileUrl,
} from "@/lib/trainings.functions";
import {
  Plus,
  Trash2,
  Edit,
  Upload,
  FileVideo,
  FileText,
  Link2,
  ExternalLink,
  GraduationCap,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/formations")({
  component: FormationsPage,
});

const emptyForm = {
  id: undefined as string | undefined,
  name: "",
  description: "",
  pricing_type: "free" as "free" | "paid",
  price: 0,
  payment_flow: "admin_numbers" as "admin_numbers" | "client_contact",
  video_link: "",
  is_active: true,
};

function FormationsPage() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ["trainings"],
    queryFn: () => listTrainings(),
  });
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [selectedForFiles, setSelectedForFiles] = useState<any | null>(null);

  const openNew = () => {
    setForm(emptyForm);
    setOpen(true);
  };
  const openEdit = (t: any) => {
    setForm({
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      pricing_type: t.pricing_type,
      price: Number(t.price ?? 0),
      payment_flow: t.payment_flow ?? "admin_numbers",
      video_link: t.video_link ?? "",
      is_active: t.is_active,
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      await upsertTraining({
        data: {
          id: form.id,
          name: form.name,
          description: form.description || null,
          pricing_type: form.pricing_type,
          price: form.pricing_type === "paid" ? Number(form.price) : null,
          payment_flow: form.pricing_type === "paid" ? form.payment_flow : null,
          video_link: form.video_link || null,
          is_active: form.is_active,
        },
      });
      toast.success("Formation enregistrée");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["trainings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Supprimer cette formation ?")) return;
    await deleteTraining({ data: { id } });
    qc.invalidateQueries({ queryKey: ["trainings"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
            <GraduationCap className="h-8 w-8" /> Formations
          </h1>
          <p className="text-muted-foreground mt-1">Gérez vos formations gratuites et payantes.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle formation
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((t: any) => (
          <Card key={t.id} className="glass p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-lg">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t.pricing_type === "free"
                    ? "Gratuit"
                    : `Payante — ${Number(t.price).toLocaleString()} Ar (${t.payment_flow === "admin_numbers" ? "numéros admin" : "contact client"})`}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => openEdit(t)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(t.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
            {t.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
                {t.description}
              </p>
            )}
            <div className="text-xs text-muted-foreground">
              {t.training_files?.length ?? 0} fichier(s)
            </div>
            <Button variant="secondary" size="sm" onClick={() => setSelectedForFiles(t)}>
              <Upload className="h-4 w-4 mr-2" />
              Fichiers
            </Button>
          </Card>
        ))}
        {items.length === 0 && (
          <Card className="glass p-8 text-center text-muted-foreground col-span-full">
            Aucune formation. Cliquez sur « Nouvelle formation » pour commencer.
          </Card>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Modifier la formation" : "Nouvelle formation"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom de la formation</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Type de formation</Label>
              <Select
                value={form.pricing_type}
                onValueChange={(v: any) => setForm({ ...form, pricing_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Gratuit</SelectItem>
                  <SelectItem value="paid">Payante</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.pricing_type === "paid" && (
              <>
                <div>
                  <Label>Droit de formation (Ar)</Label>
                  <Input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Méthode de paiement</Label>
                  <Select
                    value={form.payment_flow}
                    onValueChange={(v: any) => setForm({ ...form, payment_flow: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin_numbers">
                        Envoyer les numéros de paiement au client
                      </SelectItem>
                      <SelectItem value="client_contact">
                        Demander seulement contact du client
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    « Numéros » : l'IA envoie vos numéros MVola/Airtel/Orange et attend confirmation
                    avant d'envoyer les fichiers. « Contact » : l'IA demande juste nom Facebook +
                    WhatsApp/téléphone du client.
                  </p>
                </div>
              </>
            )}
            <div>
              <Label>Description</Label>
              <Textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <Label>Lien vidéo (optionnel)</Label>
              <Input
                type="url"
                placeholder="https://..."
                value={form.video_link}
                onChange={(e) => setForm({ ...form, video_link: e.target.value })}
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

      <FilesDialog training={selectedForFiles} onClose={() => setSelectedForFiles(null)} />
    </div>
  );
}

function FilesDialog({ training, onClose }: { training: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const upload = async (file: File) => {
    if (!training) return;
    if (file.size > 500 * 1024 * 1024) {
      toast.error("Fichier trop volumineux (max 500 Mo)");
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Non connecté");
      const ext = file.name.split(".").pop() || "bin";
      const path = `${uid}/${training.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("training-files").upload(path, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
      if (error) throw error;
      const isVideo = file.type.startsWith("video/");
      const isPdf = file.type === "application/pdf";
      await addTrainingFile({
        data: {
          training_id: training.id,
          file_path: path,
          file_type: isVideo ? "video" : isPdf ? "pdf" : "document",
          file_name: file.name,
          size_bytes: file.size,
        },
      });
      toast.success("Fichier ajouté");
      qc.invalidateQueries({ queryKey: ["trainings"] });
      setProgress(100);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur upload");
    } finally {
      setUploading(false);
    }
  };

  const addLink = async () => {
    if (!training || !linkUrl) return;
    try {
      await addTrainingFile({
        data: {
          training_id: training.id,
          file_type: "link",
          file_name: linkName || linkUrl,
          external_url: linkUrl,
        },
      });
      toast.success("Lien ajouté");
      setLinkName("");
      setLinkUrl("");
      qc.invalidateQueries({ queryKey: ["trainings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const removeFile = async (id: string) => {
    if (!confirm("Supprimer ?")) return;
    await deleteTrainingFile({ data: { id } });
    qc.invalidateQueries({ queryKey: ["trainings"] });
  };

  const openFile = async (path: string) => {
    const { url } = await getTrainingFileUrl({ data: { path } });
    window.open(url, "_blank");
  };

  return (
    <Dialog open={!!training} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fichiers — {training?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {(training?.training_files ?? []).map((f: any) => (
              <div
                key={f.id}
                className="flex items-center gap-2 border border-border rounded-lg p-2"
              >
                {f.file_type === "video" ? (
                  <FileVideo className="h-4 w-4 text-primary shrink-0" />
                ) : f.file_type === "link" ? (
                  <Link2 className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                )}
                <span className="text-sm flex-1 truncate">{f.file_name}</span>
                {f.file_type === "link" ? (
                  <a
                    href={f.external_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : (
                  <Button size="icon" variant="ghost" onClick={() => openFile(f.file_path)}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => removeFile(f.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {(!training?.training_files || training.training_files.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-2">Aucun fichier.</p>
            )}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div>
              <Label>Uploader un fichier (vidéo max 500 Mo, PDF, Word)</Label>
              <Input
                ref={fileRef}
                type="file"
                accept="video/*,.pdf,.doc,.docx,application/*"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              {uploading && <p className="text-xs text-muted-foreground mt-1">Upload en cours…</p>}
            </div>
            <div>
              <Label>Ou ajouter un lien vidéo externe</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Nom"
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                />
                <Input
                  placeholder="https://..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
                <Button onClick={addLink}>+</Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
