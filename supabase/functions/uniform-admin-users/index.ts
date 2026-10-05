import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization token." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerData, error: callerError } = await caller.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Invalid session." }, 401);

    const { data: perm, error: permError } = await service
      .from("uniform_global_permissions")
      .select("is_app_admin")
      .eq("user_id", callerData.user.id)
      .maybeSingle();

    if (permError || !perm?.is_app_admin) {
      return json({ error: "Uniform Inspection administrator access is required." }, 403);
    }

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const displayName = String(body.display_name || "").trim();
    const password = String(body.password || "");
    const role = body.role === "admin" ? "admin" : "inspector";
    const unitId = body.unit_id ? String(body.unit_id) : null;

    if (!email || !displayName) {
      return json({ error: "Display name and email are required." }, 400);
    }
    if (role === "inspector" && !unitId) {
      return json({ error: "Choose a unit for the inspector." }, 400);
    }

    let existingUser: any = null;
    for (let page = 1; page <= 20 && !existingUser; page++) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw error;
      existingUser = data.users.find((u) => (u.email || "").toLowerCase() === email) || null;
      if (data.users.length < 100) break;
    }

    let user = existingUser;
    let created = false;
    if (!user) {
      if (password.length < 8) {
        return json({ error: "A password of at least 8 characters is required for a new shared CAP account." }, 400);
      }
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (error || !data.user) throw error || new Error("Could not create the shared CAP account.");
      user = data.user;
      created = true;
    }

    const { data: profile } = await service.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (profile) {
      const { error } = await service.from("profiles").update({ display_name: displayName }).eq("id", user.id);
      if (error) throw error;
    } else {
      const { error } = await service.from("profiles").insert({
        id: user.id,
        display_name: displayName,
        is_app_admin: false,
      });
      if (error) throw error;
    }

    if (role === "admin") {
      const { error } = await service.from("uniform_global_permissions").upsert({
        user_id: user.id,
        is_app_admin: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
    } else {
      const { error } = await service.from("uniform_unit_permissions").upsert({
        user_id: user.id,
        unit_id: unitId,
        can_inspect: true,
        is_unit_admin: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,unit_id" });
      if (error) throw error;
    }

    return json({ ok: true, user_id: user.id, shared_account_already_existed: !created });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
