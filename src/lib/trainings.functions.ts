import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listTrainings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trainings")
      .select("*, training_files(*)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  pricing_type: z.enum(["free", "paid"]),
  price: z.number().nullable().optional(),
  payment_flow: z.enum(["admin_numbers", "client_contact"]).nullable().optional(),
  video_link: z.string().max(500).nullable().optional(),
  is_active: z.boolean().default(true),
});

export const upsertTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, user_id: context.userId };
    if (data.pricing_type === "free") {
      payload.price = null;
      payload.payment_flow = null;
    }
    let res;
    if (data.id) {
      res = await context.supabase
        .from("trainings")
        .update(payload)
        .eq("id", data.id)
        .select()
        .single();
    } else {
      res = await context.supabase
        .from("trainings")
        .insert(payload)
        .select()
        .single();
    }
    if (res.error) throw new Error(res.error.message);
    return res.data;
  });

export const deleteTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trainings").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const addFileSchema = z.object({
  training_id: z.string().uuid(),
  file_path: z.string().max(500).nullable().optional(),
  file_type: z.enum(["video", "pdf", "document", "link"]),
  file_name: z.string().min(1).max(300),
  size_bytes: z.number().nullable().optional(),
  external_url: z.string().max(500).nullable().optional(),
});

export const addTrainingFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => addFileSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("training_files")
      .insert({ ...data, user_id: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTrainingFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("training_files")
      .select("file_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.file_path) {
      await context.supabase.storage.from("training-files").remove([row.file_path]);
    }
    const { error } = await context.supabase.from("training_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTrainingFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("training-files")
      .createSignedUrl(data.path, 3600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
