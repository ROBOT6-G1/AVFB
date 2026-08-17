import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listPaymentMethods = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("payment_methods")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertSchema = z.object({
  id: z.string().nullable().optional(),
  label: z.string().min(1).max(100),
  number: z.string().min(1).max(100),
  instructions: z.string().max(1000).nullable().optional(),
  is_active: z.boolean().default(true),
});

export const upsertPaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const cleanId = data.id && data.id.trim().length > 0 ? data.id.trim() : undefined;
    const payload: Record<string, any> = {
      label: data.label.trim(),
      number: data.number.trim(),
      instructions: data.instructions ? data.instructions.trim() : null,
      is_active: data.is_active,
      user_id: context.userId,
    };
    if (cleanId) payload.id = cleanId;

    const { error } = await context.supabase.from("payment_methods").upsert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("payment_methods")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
