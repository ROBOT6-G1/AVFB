import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listScheduledPosts,
  upsertScheduledPost,
  deleteScheduledPost,
  uploadPostImage,
  getPostImageUrl,
  publishScheduledPostNow,
} from "@/lib/scheduled-posts.functions";
import { listFacebookPages } from "@/lib/dashboard.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  Send,
  Trash2,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  Plus,
  Save,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";

const postsQuery = queryOptions({
  queryKey: ["scheduled-posts"],
  queryFn: () => listScheduledPosts(),
});
const pagesQuery = queryOptions({ queryKey: ["fb-pages"], queryFn: () => listFacebookPages() });

export const Route = createFileRoute("/_authenticated/auto-post")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(postsQuery),
      context.queryClient.ensureQueryData(pagesQuery),
    ]),
  component: AutoPostPage,
});

type FormState = {
  id?: string;
  page_id: string | null;
  title: string;
  ai_prompt: string;
  images: { path: string; preview: string }[];
  video_path: string | null;
  video_preview: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  frequency: "once" | "daily";
  enhance_image: boolean;
};

function todayLocalParts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function combineToIso(date: string, time: string): string {
  // Interpret as local time
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0).toISOString();
}

function fromIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

async function compressImageToUnder50KB(
  file: File,
): Promise<{ data_base64: string; content_type: string; filename: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const maxDim = 600;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context failed"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.7;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length * 0.75 > 50 * 1024 && quality > 0.15) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        const base64 = dataUrl.split(",")[1] || "";
        resolve({
          data_base64: base64,
          content_type: "image/jpeg",
          filename: file.name.replace(/\.[^/.]+$/, "") + ".jpg",
        });
      };
      img.onerror = reject;
      img.src = event.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AutoPostPage() {
  const { data: posts } = useSuspenseQuery(postsQuery);
  const { data: pages } = useSuspenseQuery(pagesQuery);
  const qc = useQueryClient();

  const initial: FormState = {
    id: undefined,
    page_id: pages[0]?.id ?? null,
    title: "",
    ai_prompt: "",
    images: [],
    video_path: null,
    video_preview: null,
    date: todayLocalParts().date,
    time: todayLocalParts().time,
    frequency: "once",
    enhance_image: true,
  };
  const [form, setForm] = useState<FormState>(initial);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const editing = Boolean(form.id);

  const resetForm = () => setForm({ ...initial, ...todayLocalParts() });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) {
          toast.error(`${file.name} : sary lehibe loatra`);
          continue;
        }
        const compressed = await compressImageToUnder50KB(file);
        let path = `data:${compressed.content_type};base64,${compressed.data_base64}`;
        let preview = path;

        try {
          const res = await uploadPostImage({ data: compressed });
          if (res?.path) {
            path = res.path;
            preview = res.signed_url || preview;
          }
        } catch (storageErr) {
          console.warn("Storage upload fallback to base64:", storageErr);
        }

        setForm((f) => ({
          ...f,
          images: [...f.images, { path, preview }],
          video_path: null,
          video_preview: null,
        }));
      }
      toast.success("Sary voatahiry soa aman-tsara");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur upload");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const startEdit = async (row: Record<string, unknown>) => {
    const parts = fromIso(row.scheduled_at as string);
    const paths: string[] = Array.isArray(row.image_paths) && row.image_paths.length
      ? (row.image_paths as string[])
      : typeof row.image_path === "string"
        ? [row.image_path]
        : [];
    const images: { path: string; preview: string }[] = [];
    for (const p of paths) {
      try {
        const r = await getPostImageUrl({ data: { path: p } });
        images.push({ path: p, preview: r.signed_url });
      } catch {
        // ignore
      }
    }
    const vidUrl = (row.video_path as string) ?? null;
    setForm({
      id: row.id as string | undefined,
      page_id: (row.page_id as string | null) ?? pages[0]?.id ?? null,
      title: row.title as string,
      ai_prompt: (row.ai_prompt as string) ?? "",
      images,
      video_path: vidUrl,
      video_preview: vidUrl,
      date: parts.date,
      time: parts.time,
      frequency: (row.frequency as string) ?? "once",
      enhance_image: (row.enhance_image as boolean) ?? true,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!form.title.trim()) {
      toast.error("Ampidiro ny lohatenin'ny publication");
      return;
    }
    setSaving(true);
    try {
      // For "daily", user only picks the time — schedule for today at that time,
      // rolling forward to tomorrow if the moment is already past.
      let iso: string;
      if (form.frequency === "daily") {
        const parts = todayLocalParts();
        let candidate = combineToIso(parts.date, form.time);
        if (new Date(candidate).getTime() <= Date.now()) {
          const next = new Date(candidate);
          next.setDate(next.getDate() + 1);
          candidate = next.toISOString();
        }
        iso = candidate;
      } else {
        iso = combineToIso(form.date, form.time);
      }
      await upsertScheduledPost({
        data: {
          id: form.id,
          page_id: form.page_id,
          title: form.title.trim(),
          ai_prompt: form.ai_prompt.trim() || null,
          image_paths: form.images.map((i) => i.path),
          video_path: form.video_path,
          scheduled_at: iso,
          frequency: form.frequency,
          enhance_image: form.enhance_image,
        },
      });
      toast.success(editing ? "Publication novaina" : "Publication voatahiry");
      qc.invalidateQueries({ queryKey: ["scheduled-posts"] });
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Fafao ity publication ity ?")) return;
    try {
      await deleteScheduledPost({ data: { id } });
      toast.success("Voafafa");
      qc.invalidateQueries({ queryKey: ["scheduled-posts"] });
      if (form.id === id) resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  const publishNow = async (id: string) => {
    setRunningId(id);
    try {
      const res = await publishScheduledPostNow({ data: { id } });
      if (res.ok) toast.success("Publication alefa amin'i Facebook !");
      else toast.error(res.error ?? "Erreur publication");
      qc.invalidateQueries({ queryKey: ["scheduled-posts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text">Auto-poste</h1>
        <p className="text-muted-foreground mt-1">
          Planifiez vos publications Facebook. L'IA rédige une description professionnelle et publie
          automatiquement à l'heure choisie.
        </p>
      </div>

      {pages.length === 0 && (
        <Card className="glass p-4 border border-yellow-500/40 bg-yellow-500/5">
          <p className="text-sm">
            Aucune page Facebook connectée. Rendez-vous dans <strong>Facebook</strong> pour en
            connecter une avant de planifier une publication.
          </p>
        </Card>
      )}

      {/* Form */}
      <Card className="glass p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">
            {editing ? "Modifier une publication planifiée" : "Nouvelle publication planifiée"}
          </h2>
          {editing && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={resetForm}>
              <X className="h-4 w-4 mr-1" />
              Annuler
            </Button>
          )}
        </div>

        <div>
          <Label>Titre de la publication</Label>
          <Input
            placeholder="Ex : Promotion spéciale du week-end"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            L'IA génère une description professionnelle à partir de ce titre.
          </p>
        </div>

        <div>
          <Label>Description à donner à l'IA (facultatif)</Label>
          <textarea
            className="mt-1 w-full min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Ex : mets l'accent sur la livraison gratuite, ton chaleureux, cible les jeunes parents, mentionne la promo -20%…"
            value={form.ai_prompt}
            onChange={(e) => setForm({ ...form, ai_prompt: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Ces instructions guident l'IA pour rédiger la meilleure description possible.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Page Facebook</Label>
            <Select
              value={form.page_id ?? ""}
              onValueChange={(v) => setForm({ ...form, page_id: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir une page" />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.page_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Fréquence</Label>
            <Select
              value={form.frequency}
              onValueChange={(v: "once" | "daily") => setForm({ ...form, frequency: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Une seule fois</SelectItem>
                <SelectItem value="daily">Tous les jours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className={form.frequency === "daily" ? "" : "grid gap-4 md:grid-cols-2"}>
          {form.frequency !== "daily" && (
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
          )}
          <div>
            <Label>Heure (HH:MM)</Label>
            <Input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
            {form.frequency === "daily" && (
              <p className="text-xs text-muted-foreground mt-1">
                La publication sera relancée chaque jour à cette heure.
              </p>
            )}
          </div>
        </div>

        <div>
          <Label>Images (plusieurs possibles)</Label>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent">
                <ImageIcon className="h-4 w-4" />
                Ajouter des images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {form.images.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {form.images.map((img) => (
                  <div key={img.path} className="relative">
                    <img
                      src={img.preview}
                      alt="preview"
                      className="h-24 w-24 rounded-md object-cover border"
                    />
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute -right-2 -top-2 h-6 w-6"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          images: f.images.filter((i) => i.path !== img.path),
                        }))
                      }
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Plusieurs images = publication album. L'IA n'invente pas de nouvelle image : elle
            améliore la première.
          </p>
        </div>

        <div>
          <Label>Lien Vidéo (optionnel)</Label>
          <Input
            placeholder="Ex : https://www.youtube.com/watch?v=... na lien video mp4"
            value={form.video_path || ""}
            onChange={(e) =>
              setForm({
                ...form,
                video_path: e.target.value.trim() || null,
                video_preview: e.target.value.trim() || null,
                images: e.target.value.trim() ? [] : form.images,
              })
            }
          />
          <p className="text-xs text-muted-foreground mt-1">
            Ampidiro ny rohy (lien) amin'ny vidéo raha misy. Rehefa misy vidéo dia ny vidéo no alefa fa tsy sary.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <Label className="text-sm">Améliorer l'image avec l'IA</Label>
            <p className="text-xs text-muted-foreground">
              Netteté, luminosité, rendu professionnel — sans changer le contenu.
            </p>
          </div>
          <Switch
            checked={form.enhance_image}
            onCheckedChange={(v) => setForm({ ...form, enhance_image: v })}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving || uploading}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : editing ? (
              <Save className="h-4 w-4 mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {editing ? "Enregistrer les modifications" : "Créer une publication"}
          </Button>
          {editing && form.id && (
            <Button
              variant="secondary"
              onClick={() => publishNow(form.id!)}
              disabled={runningId === form.id}
            >
              {runningId === form.id ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Publier maintenant
            </Button>
          )}
        </div>
      </Card>

      {/* List */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Publications planifiées</h2>
        {posts.length === 0 && (
          <Card className="glass p-6 text-sm text-muted-foreground">
            Aucune publication planifiée pour le moment.
          </Card>
        )}
        {posts.map((p: Record<string, unknown>) => (
          <Card key={p.id} className="glass p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold truncate">{p.title}</h3>
                  <Badge variant={statusVariant(p.status)}>{statusLabel(p.status)}</Badge>
                  <Badge variant="outline">
                    {p.frequency === "daily" ? "Tous les jours" : "Une fois"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Prévu : {new Date(p.scheduled_at).toLocaleString()}
                  {p.facebook_pages?.page_name && <> · Page : {p.facebook_pages.page_name}</>}
                  {p.last_published_at && (
                    <> · Dernière publication : {new Date(p.last_published_at).toLocaleString()}</>
                  )}
                </p>
                {p.last_error && (
                  <p className="text-xs text-destructive mt-1">Erreur : {p.last_error}</p>
                )}
                {p.ai_description && (
                  <details className="mt-2">
                    <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                      Voir la description IA
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/30 p-3 rounded-md">
                      {p.ai_description}
                    </pre>
                  </details>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => publishNow(p.id)}
                  disabled={runningId === p.id}
                >
                  {runningId === p.id ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-1" />
                  )}
                  Publier
                </Button>
                <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                  <Pencil className="h-4 w-4 mr-1" />
                  Modifier
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function statusLabel(s: string) {
  switch (s) {
    case "pending":
      return "En attente";
    case "processing":
      return "En cours";
    case "published":
      return "Publié";
    case "failed":
      return "Échec";
    case "cancelled":
      return "Annulé";
    default:
      return s;
  }
}

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "published":
      return "default";
    case "failed":
      return "destructive";
    case "processing":
      return "secondary";
    default:
      return "outline";
  }
}
