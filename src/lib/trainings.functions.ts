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
      const uniqueName = `${context.userId}/${data.training_id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const contentType = data.content_type || "application/octet-stream";
      const bytes = Uint8Array.from(atob(data.data_base64), (c) => c.charCodeAt(0));

      finalPath = `data:${contentType};base64,${data.data_base64}`;

      try {
        const { error: upErr } = await context.supabase.storage
          .from("training-files")
          .upload(uniqueName, bytes, { contentType, upsert: true });

        if (!upErr) {
          finalPath = uniqueName;
        }
      } catch (e) {
        console.warn("[uploadTrainingFileServer] fallback to data url:", e);
      }
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
    if (row?.file_path && !row.file_path.startsWith("data:") && !row.file_path.startsWith("http")) {
      try {
        await context.supabase.storage.from("training-files").remove([row.file_path]);
      } catch {
        // ignore
      }
    }
    const { error } = await context.supabase.from("training_files").delete().eq("id", data.id);
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
