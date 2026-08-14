import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const setGlobalIaStopped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ stopped: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("settings")
      .upsert(
        { user_id: context.userId, global_ia_stopped: data.stopped },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listClientIaStates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("client_ia_state")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setClientIaStopped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        page_id: z.string().min(1),
        client_fb_id: z.string().min(1),
        client_fb_name: z.string().nullable().optional(),
        ia_stopped: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("client_ia_state")
      .upsert({ ...data, user_id: context.userId }, { onConflict: "user_id,page_id,client_fb_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
