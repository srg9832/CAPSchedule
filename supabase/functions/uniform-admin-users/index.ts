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

    const body = await req.json();
    const capid = String(body.capid || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const requestedDisplayName = String(body.display_name || "").trim();
    const password = String(body.password || "");
    let role = String(body.role || "inspector");
    if (role === "admin") role = "application_admin";

    const unitId = body.unit_id ? String(body.unit_id) : null;
    let homeUnitId = body.home_unit_id ? String(body.home_unit_id) : null;

    if (!capid) return json({ error: "CAPID is required." });

    const { data: globalPerm, error: globalPermError } = await service
      .from("uniform_global_permissions")
      .select("is_app_admin")
      .eq("user_id", callerData.user.id)
      .maybeSingle();
    if (globalPermError) throw globalPermError;

    const callerIsAppAdmin = Boolean(globalPerm?.is_app_admin);

    if (!callerIsAppAdmin) {
      if (!unitId) return json({ error: "Choose the unit you administer." });

      const { data: unitPerm, error: unitPermError } = await service
        .from("uniform_unit_permissions")
        .select("is_unit_admin")
        .eq("user_id", callerData.user.id)
        .eq("unit_id", unitId)
        .maybeSingle();
      if (unitPermError) throw unitPermError;

      if (!unitPerm?.is_unit_admin) {
        return json({ error: "You can only add Inspectors to units where you are a Unit Admin." }, 403);
      }

      role = "inspector";
      homeUnitId = unitId;
    }

    if (!["inspector", "unit_admin", "application_admin"].includes(role)) {
      return json({ error: "Choose Inspector, Unit Admin, or Application Admin." });
    }

    if (role !== "application_admin" && !unitId) {
      return json({ error: "Choose the unit where this user will have access." });
    }

    const { data: member, error: memberError } = await service
      .from("members")
      .select("id,capid,first_name,last_name,current_grade,active")
      .eq("capid", capid)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!member) return json({ error: `No CAP member was found with CAPID ${capid}.` });

    const memberDisplayName =
      requestedDisplayName ||
      [member.first_name, member.last_name].filter(Boolean).join(" ").trim() ||
      `CAPID ${capid}`;

    const { data: linkedProfile, error: linkedProfileError } = await service
      .from("profiles")
      .select("id,display_name,default_unit_id,member_id")
      .eq("member_id", member.id)
      .maybeSingle();
    if (linkedProfileError) throw linkedProfileError;

    let userId: string | null = linkedProfile?.id || null;
    let created = false;
    let linkedExistingAccount = Boolean(linkedProfile);

    if (userId) {
      const { data: existingGlobal } = await service
        .from("uniform_global_permissions")
        .select("is_app_admin")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingGlobal?.is_app_admin) {
        return json({
          error: `${memberDisplayName} is already an Application Admin and already has access to every Uniform Inspection unit.`,
          code: "already_application_admin",
          existing_user: true,
        });
      }

      if (unitId) {
        const { data: existingUnit } = await service
          .from("uniform_unit_permissions")
          .select("can_inspect,is_unit_admin")
          .eq("user_id", userId)
          .eq("unit_id", unitId)
          .maybeSingle();

        if (existingUnit?.is_unit_admin) {
          return json({
            error: `${memberDisplayName} is already a Unit Admin for this unit.`,
            code: "already_unit_admin",
            existing_user: true,
          });
        }

        if (existingUnit?.can_inspect && role === "inspector") {
          return json({
            error: `${memberDisplayName} is already an Inspector for this unit.`,
            code: "already_inspector",
            existing_user: true,
          });
        }
      }
    }

    if (!userId) {
      let existingAuthUser: any = null;

      if (email) {
        for (let page = 1; page <= 20 && !existingAuthUser; page++) {
          const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 });
          if (error) throw error;
          existingAuthUser = data.users.find((u) => (u.email || "").toLowerCase() === email) || null;
          if (data.users.length < 100) break;
        }
      }

      if (existingAuthUser) {
        userId = existingAuthUser.id;
        linkedExistingAccount = true;

        const { data: existingProfile, error: existingProfileError } = await service
          .from("profiles")
          .select("id,member_id,default_unit_id")
          .eq("id", userId)
          .maybeSingle();
        if (existingProfileError) throw existingProfileError;

        if (existingProfile?.member_id && existingProfile.member_id !== member.id) {
          return json({
            error: "That email belongs to a different CAP member account. Check the CAPID and email before continuing.",
            code: "email_member_conflict",
          });
        }

        if (existingProfile) {
          const { error } = await service
            .from("profiles")
            .update({
              member_id: member.id,
              display_name: memberDisplayName,
              default_unit_id: existingProfile.default_unit_id || homeUnitId || unitId,
            })
            .eq("id", userId);
          if (error) throw error;
        } else {
          const { error } = await service.from("profiles").insert({
            id: userId,
            member_id: member.id,
            display_name: memberDisplayName,
            is_app_admin: false,
            default_unit_id: homeUnitId || unitId,
          });
          if (error) throw error;
        }
      } else {
        if (!email) {
          return json({
            error: "No shared CAP Applications account is linked to this CAPID yet. Enter an email address to create one.",
            code: "email_required",
          });
        }
        if (password.length < 8) {
          return json({
            error: "A temporary password of at least 8 characters is required to create a new shared CAP account.",
            code: "password_required",
          });
        }

        const { data, error } = await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { display_name: memberDisplayName, capid },
        });
        if (error || !data.user) throw error || new Error("Could not create the shared CAP account.");

        userId = data.user.id;
        created = true;

        const { error: profileInsertError } = await service.from("profiles").insert({
          id: userId,
          member_id: member.id,
          display_name: memberDisplayName,
          is_app_admin: false,
          default_unit_id: homeUnitId || unitId,
        });
        if (profileInsertError) throw profileInsertError;
      }
    } else {
      const { error: profileUpdateError } = await service
        .from("profiles")
        .update({
          display_name: memberDisplayName,
          default_unit_id: linkedProfile?.default_unit_id || homeUnitId || unitId,
        })
        .eq("id", userId);
      if (profileUpdateError) throw profileUpdateError;
    }

    if (!userId) throw new Error("Could not resolve the shared CAP account.");

    if (role === "application_admin") {
      if (!callerIsAppAdmin) {
        return json({ error: "Only an Application Admin can grant Application Admin access." }, 403);
      }

      const { error } = await service.from("uniform_global_permissions").upsert({
        user_id: userId,
        is_app_admin: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;

      if (homeUnitId) {
        const { error: homeError } = await service
          .from("profiles")
          .update({ default_unit_id: homeUnitId })
          .eq("id", userId);
        if (homeError) throw homeError;
      }
    } else {
      if (role === "unit_admin" && !callerIsAppAdmin) {
        return json({ error: "Only an Application Admin can appoint Unit Admins." }, 403);
      }

      const { error } = await service.from("uniform_unit_permissions").upsert({
        user_id: userId,
        unit_id: unitId,
        can_inspect: true,
        is_unit_admin: role === "unit_admin",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,unit_id" });
      if (error) throw error;
    }

    return json({
      ok: true,
      user_id: userId,
      capid,
      role,
      unit_id: unitId,
      created_new_account: created,
      linked_existing_account: linkedExistingAccount,
      member_name: memberDisplayName,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
