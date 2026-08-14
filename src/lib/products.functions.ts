import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("products")
      .select("*, product_images(*)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // sign product image URLs
    const withUrls = await Promise.all(
      (data ?? []).map(async (p: any) => {
        const imgs = p.product_images ?? [];
        const signed = await Promise.all(
          imgs.map(async (img: any) => {
            const { data: s } = await context.supabase.storage
              .from("product-images")
              .createSignedUrl(img.image_path, 3600);
            return { ...img, url: s?.signedUrl ?? "" };
          }),
        );
        return { ...p, product_images: signed };
      }),
    );
    return withUrls;
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  price: z.number().min(0),
  stock: z.number().int().min(0),
  description: z.string().max(5000).nullable().optional(),
  payment_flow: z.enum(["admin_numbers", "client_contact"]),
  is_active: z.boolean().default(true),
});

export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    let res;
    if (data.id) {
      res = await context.supabase
        .from("products")
        .update({ ...data, user_id: context.userId })
        .eq("id", data.id)
        .select()
        .single();
    } else {
      res = await context.supabase
        .from("products")
        .insert({ ...data, user_id: context.userId })
        .select()
        .single();
    }
    if (res.error) throw new Error(res.error.message);
    return res.data;
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        product_id: z.string().uuid(),
        image_path: z.string().min(1).max(500),
        sort_order: z.number().int().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("product_images")
      .insert({ ...data, user_id: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("product_images")
      .select("image_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.image_path) {
      await context.supabase.storage.from("product-images").remove([row.image_path]);
    }
    const { error } = await context.supabase.from("product_images").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
