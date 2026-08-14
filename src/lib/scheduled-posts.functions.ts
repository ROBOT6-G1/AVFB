import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ensureBucket(supabase: any, bucketName: string) {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === bucketName);
    if (!exists) {
      await supabase.storage.createBucket(bucketName, { public: false });
    }
  } catch (e) {
    // Ignore if buckets cannot be listed/created due to RLS/permissions
  }
}

/* ---------------- List ---------------- */

export const listScheduledPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("scheduled_posts")
      .select("*, facebook_pages(page_name)")
      .order("scheduled_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ---------------- Create / update ---------------- */

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  page_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  ai_prompt: z.string().max(2000).nullable().optional(),
  image_path: z.string().max(500).nullable().optional(),
  image_paths: z.array(z.string().max(500)).max(50).optional(),
  video_path: z.string().max(500).nullable().optional(),
  scheduled_at: z.string().datetime(),
  frequency: z.enum(["once", "daily"]),
  enhance_image: z.boolean(),
});

export const upsertScheduledPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Reset status to pending on any manual save so scheduling resumes.
    const paths = data.image_paths ?? (data.image_path ? [data.image_path] : []);
    const payload = {
      ...data,
      image_paths: paths,
      image_path: paths[0] ?? null,
      user_id: context.userId,
      status: "pending" as const,
      last_error: null,
    };

    let targetId = data.id;
    if (targetId) {
      const { error } = await context.supabase
        .from("scheduled_posts")
        .update(payload)
        .eq("id", targetId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await context.supabase
        .from("scheduled_posts")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      targetId = row?.id;
    }
    return { ok: true, id: targetId };
  });

/* ---------------- Delete ---------------- */

export const deleteScheduledPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Try to delete the associated images / video too (best-effort).
    const { data: row } = await context.supabase
      .from("scheduled_posts")
      .select("image_path,image_paths,video_path")
      .eq("id", data.id)
      .maybeSingle();
    const imgs = [
      ...(((row as any)?.image_paths as string[] | null) ?? []),
      ...(row?.image_path ? [row.image_path] : []),
    ].filter((v, i, a) => v && a.indexOf(v) === i);
    if (imgs.length) {
      await context.supabase.storage.from("post-images").remove(imgs);
    }
    if ((row as any)?.video_path) {
      await context.supabase.storage.from("post-videos").remove([(row as any).video_path]);
    }
    const { error } = await context.supabase.from("scheduled_posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Video signed upload (direct-to-storage, up to 1 GB) ---------------- */

export const createVideoUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ filename: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureBucket(context.supabase, "post-videos");
    const safeName = data.filename.replace(/[^\w.\-]/g, "_");
    const path = `${context.userId}/${crypto.randomUUID()}-${safeName}`;
    const { data: signed, error } = await context.supabase.storage
      .from("post-videos")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token, signed_url: signed.signedUrl };
  });

export const getPostVideoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("post-videos")
      .createSignedUrl(data.path, 60 * 60 * 24 * 7);
    if (error) throw new Error(error.message);
    return { signed_url: signed.signedUrl };
  });

/* ---------------- Image upload (base64 → storage) ---------------- */

const uploadSchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(80),
  data_base64: z.string().min(1),
});

export const uploadPostImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => uploadSchema.parse(d))
  .handler(async ({ data, context }) => {
    await ensureBucket(context.supabase, "post-images");
    const safeName = data.filename.replace(/[^\w.\-]/g, "_");
    const path = `${context.userId}/${crypto.randomUUID()}-${safeName}`;
    const bytes = Uint8Array.from(atob(data.data_base64), (c) => c.charCodeAt(0));
    const { error: upErr } = await context.supabase.storage
      .from("post-images")
      .upload(path, bytes, { contentType: data.content_type, upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { data: signed, error: sErr } = await context.supabase.storage
      .from("post-images")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    if (sErr) throw new Error(sErr.message);
    return { path, signed_url: signed.signedUrl };
  });

/* ---------------- Image upload (signed URL direct upload) ---------------- */

export const createImageUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ filename: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureBucket(context.supabase, "post-images");
    const safeName = data.filename.replace(/[^\w.\-]/g, "_");
    const path = `${context.userId}/${crypto.randomUUID()}-${safeName}`;
    const { data: signed, error } = await context.supabase.storage
      .from("post-images")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token, signed_url: signed.signedUrl };
  });

export const getPostImageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("post-images")
      .createSignedUrl(data.path, 60 * 60 * 24 * 7);
    if (error) throw new Error(error.message);
    return { signed_url: signed.signedUrl };
  });

/* ---------------- Manual trigger ("publier maintenant") ---------------- */

export const publishScheduledPostNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Ownership check first
    const { data: row, error } = await context.supabase
      .from("scheduled_posts")
      .select("id,user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.user_id !== context.userId) throw new Error("Publication tsy hita.");
    const { runScheduledPost } = await import("@/lib/post-publisher.server");
    return await runScheduledPost(data.id);
  });
