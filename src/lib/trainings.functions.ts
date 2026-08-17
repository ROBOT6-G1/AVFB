import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { uploadMediaFile } from "@/lib/storage-helper.server";

export const listTrainings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trainings")
      .select("*, training_files(*)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string().min(1, "Veuillez renseigner le nom de la formation").max(200),
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
    const cleanId = data.id && data.id.trim().length > 0 ? data.id.trim() : undefined;
    const payload: Record<string, any> = {
      name: data.name.trim(),
      description: data.description ? data.description.trim() : null,
      pricing_type: data.pricing_type,
      price: data.pricing_type === "free" ? null : Number(data.price ?? 0),
      payment_flow: data.pricing_type === "free" ? null : data.payment_flow,
      video_link: data.video_link ? data.video_link.trim() : null,
      is_active: data.is_active,
      user_id: context.userId,
    };
    let res;
    if (cleanId) {
      res = await context.supabase
        .from("trainings")
        .update(payload)
        .eq("id", cleanId)
        .eq("user_id", context.userId)
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
    const { error } = await context.supabase
      .from("trainings")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const addFileSchema = z.object({
  training_id: z.string().uuid(),
  file_path: z.string().nullable().optional(),
  file_type: z.enum(["video", "pdf", "document", "link", "image"]),
  file_name: z.string().min(1).max(300),
  size_bytes: z.number().nullable().optional(),
  external_url: z.string().nullable().optional(),
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

const uploadTrainingFileSchema = z.object({
  training_id: z.string().uuid(),
  data_base64: z.string().optional(),
  content_type: z.string().optional(),
  file_type: z.enum(["video", "pdf", "document", "link", "image"]),
  file_name: z.string().min(1).max(300),
  size_bytes: z.number().nullable().optional(),
  external_url: z.string().nullable().optional(),
});

export const uploadTrainingFileServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => uploadTrainingFileSchema.parse(d))
  .handler(async ({ data, context }) => {
    let finalPath: string | null = null;

    if (data.data_base64) {
      const safeName = data.file_name.replace(/[^\w.-]/g, "_");
      const contentType = data.content_type || "application/octet-stream";
      const buffer = Buffer.from(data.data_base64, "base64");

      // Upload directly to Supabase Storage
      finalPath = await uploadMediaFile({
        userId: context.userId,
        bucket: "training-files",
        fileName: safeName,
        contentType,
        buffer,
        folder: data.training_id,
      });
    }

    const { error } = await context.supabase.from("training_files").insert({
      training_id: data.training_id,
      file_path: finalPath,
      file_type: data.file_type,
      file_name: data.file_name,
      size_bytes: data.size_bytes,
      external_url: data.external_url || null,
      user_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, file_path: finalPath };
  });

export const deleteTrainingFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("training_files")
      .select("file_path")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (row?.file_path && !row.file_path.startsWith("data:") && !row.file_path.startsWith("http")) {
      try {
        await context.supabase.storage.from("training-files").remove([row.file_path]);
      } catch {
        // ignore
      }
    }
    const { error } = await context.supabase
      .from("training_files")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTrainingFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    if (
      data.path.startsWith("data:") ||
      data.path.startsWith("http://") ||
      data.path.startsWith("https://")
    ) {
      return { url: data.path };
    }
    try {
      const { data: signed, error } = await context.supabase.storage
        .from("training-files")
        .createSignedUrl(data.path, 3600);
      if (error || !signed?.signedUrl) return { url: data.path };
      return { url: signed.signedUrl };
    } catch {
      return { url: data.path };
    }
  });
