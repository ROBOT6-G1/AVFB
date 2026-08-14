import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  listProducts,
  upsertProduct,
  deleteProduct,
  addProductImage,
  deleteProductImage,
} from "@/lib/products.functions";
import { Plus, Trash2, Edit, Image as ImageIcon, ShoppingBag, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/produits")({
  component: ProduitsPage,
});

const emptyForm = {
  id: undefined as string | undefined,
  name: "",
  price: 0,
  stock: 0,
  description: "",
  payment_flow: "admin_numbers" as "admin_numbers" | "client_contact",
  is_active: true,
};

function ProduitsPage() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({ queryKey: ["products"], queryFn: () => listProducts() });
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState<any | null>(null);

  const openNew = () => {
    setForm(emptyForm);
    setOpen(true);
  };
  const openEdit = (p: any) => {
    setForm({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      stock: p.stock,
      description: p.description ?? "",
      payment_flow: p.payment_flow,
      is_active: p.is_active,
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      await upsertProduct({
        data: {
          id: form.id,
          name: form.name,
          price: Number(form.price),
          stock: Number(form.stock),
          description: form.description || null,
          payment_flow: form.payment_flow,
          is_active: form.is_active,
        },
      });
      toast.success("Produit enregistré");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Supprimer ce produit ?")) return;
    await deleteProduct({ data: { id } });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
            <ShoppingBag className="h-8 w-8" /> Produits
          </h1>
          <p className="text-muted-foreground mt-1">Gérez votre catalogue et vos stocks.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          Nouveau produit
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((p: any) => (
          <Card key={p.id} className="glass p-4 space-y-3">
            <div className="aspect-square bg-muted rounded-lg overflow-hidden">
              {p.product_images?.[0]?.url ? (
                <img
                  src={p.product_images[0].url}
                  alt={p.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-10 w-10" />
                </div>
              )}
            </div>
            <div>
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm text-primary font-bold">
                {Number(p.price).toLocaleString()} Ar
              </div>
              <div className="text-xs text-muted-foreground">
                Stock : {p.stock} — {p.product_images?.length ?? 0} image(s)
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => setGallery(p)}
              >
                <ImageIcon className="h-4 w-4 mr-1" />
                Galerie
              </Button>
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
          <Card className="glass p-8 text-center text-muted-foreground col-span-full">
            Aucun produit.
          </Card>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Modifier" : "Nouveau produit"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Prix (Ar)</Label>
              <Input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Stock disponible</Label>
              <Input
                type="number"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                  <SelectItem value="admin_numbers">Envoyer numéros de paiement</SelectItem>
                  <SelectItem value="client_contact">Demander contact client</SelectItem>
                </SelectContent>
              </Select>
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

      <GalleryDialog product={gallery} onClose={() => setGallery(null)} />
    </div>
  );
}

function GalleryDialog({ product, onClose }: { product: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const maxImages = 50;
  const count = product?.product_images?.length ?? 0;

  const uploadFiles = async (files: FileList) => {
    if (!product) return;
    if (count + files.length > maxImages) {
      toast.error(`Maximum ${maxImages} images`);
      return;
    }
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Non connecté");
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${uid}/${product.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file, {
          upsert: false,
          contentType: file.type || "image/jpeg",
        });
        if (error) throw error;
        await addProductImage({
          data: { product_id: product.id, image_path: path, sort_order: count },
        });
      }
      toast.success("Images ajoutées");
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setUploading(false);
    }
  };

  const removeImg = async (id: string) => {
    await deleteProductImage({ data: { id } });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Galerie — {product?.name} ({count}/{maxImages})
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2 max-h-96 overflow-y-auto">
            {(product?.product_images ?? []).map((img: any) => (
              <div
                key={img.id}
                className="relative aspect-square bg-muted rounded overflow-hidden group"
              >
                <img src={img.url} alt="" className="w-full h-full object-cover" />
                <button
                  className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded p-1 opacity-0 group-hover:opacity-100 transition"
                  onClick={() => removeImg(img.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          <div>
            <Label>Ajouter des images</Label>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              onChange={(e) => e.target.files && uploadFiles(e.target.files)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              L'IA enverra 4 images à la fois au client, puis 4 autres à sa demande.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
