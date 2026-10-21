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

const clean = (value: unknown) => String(value ?? "").trim();

async function findAuthByEmail(admin: any, email: string) {
  if (!email) return null;
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = (data.users || []).find((u: any) => (u.email || "").toLowerCase() === target);
    if (found) return found;
    if ((data.users || []).length < 1000) break;
  }
  return null;
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
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerData, error: callerError } = await caller.auth.getUser();
    if (callerError || !callerData.user) return json({ error: "Invalid session." }, 401);
    const callerId = callerData.user.id;

    const { data: globalPerm, error: globalPermError } = await admin
      .from("uniform_global_permissions")
      .select("is_app_admin")
      .eq("user_id", callerId)
      .maybeSingle();
    if (globalPermError) throw globalPermError;

    const callerIsAppAdmin = Boolean(globalPerm?.is_app_admin);

    const body = await req.json();
    const action = clean(body.action || "save");
    const unitId = clean(body.unit_id) || null;

    async function callerCanAdminUnit(targetUnitId: string | null) {
      if (callerIsAppAdmin) return true;
      if (!targetUnitId) return false;
      const { data, error } = await admin
        .from("uniform_unit_permissions")
        .select("is_unit_admin")
        .eq("user_id", callerId)
        .eq("unit_id", targetUnitId)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data?.is_unit_admin);
    }

    async function resolveExistingUser(capid: string, email: string, requestedUserId = "") {
      let profileByCapid: any = null;
      let authByEmail: any = null;
      let authById: any = null;

      if (requestedUserId) {
        const { data, error } = await admin.auth.admin.getUserById(requestedUserId);
        if (error) throw error;
        authById = data.user;
      }

      if (capid) {
        const { data, error } = await admin
          .from("profiles")
          .select("id,display_name,first_name,last_name,capid,default_unit_id,must_change_password")
          .eq("capid", capid)
          .maybeSingle();
        if (error) throw error;
        profileByCapid = data;
      }

      if (email) authByEmail = await findAuthByEmail(admin, email);

      const ids = [authById?.id, profileByCapid?.id, authByEmail?.id].filter(Boolean);
      if (new Set(ids).size > 1) {
        throw new Error("The CAPID and email point to different shared login accounts. An Application Admin must correct the account identity before access can be changed.");
      }

      const userId = ids[0] || null;
      if (!userId) return { user: null, profile: null };

      const user = authById?.id === userId
        ? authById
        : authByEmail?.id === userId
          ? authByEmail
          : (await admin.auth.admin.getUserById(userId)).data.user;

      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id,display_name,first_name,last_name,capid,default_unit_id,must_change_password")
        .eq("id", userId)
        .maybeSingle();
      if (profileError) throw profileError;

      return { user, profile };
    }

    async function uniformAccess(userId: string, selectedUnitId: string | null) {
      const [{ data: global }, { data: unit }] = await Promise.all([
        admin.from("uniform_global_permissions").select("is_app_admin").eq("user_id", userId).maybeSingle(),
        selectedUnitId
          ? admin.from("uniform_unit_permissions").select("can_inspect,is_unit_admin").eq("user_id", userId).eq("unit_id", selectedUnitId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const selectedRole = global?.is_app_admin
        ? "application_admin"
        : unit?.is_unit_admin
          ? "unit_admin"
          : unit?.can_inspect
            ? "inspector"
            : "none";

      const { count } = await admin
        .from("uniform_unit_permissions")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", userId)
        .or("can_inspect.eq.true,is_unit_admin.eq.true");

      return {
        is_app_admin: Boolean(global?.is_app_admin),
        selected_unit_role: selectedRole,
        has_uniform_access_any: Boolean(global?.is_app_admin || (count || 0) > 0),
      };
    }

    if (action === "lookup") {
      if (!unitId) return json({ error: "Choose a unit first." });
      if (!await callerCanAdminUnit(unitId)) return json({ error: "You are not authorized to administer this unit." }, 403);

      const capid = clean(body.capid);
      const email = clean(body.email).toLowerCase();
      if (!capid && !email) return json({ error: "Enter a CAPID or email address." });

      const { user, profile } = await resolveExistingUser(capid, email);
      if (!user) return json({ found: false });

      const access = await uniformAccess(user.id, unitId);
      return json({
        found: true,
        user_id: user.id,
        email: user.email || "",
        display_name: profile?.display_name || user.user_metadata?.display_name || user.email || "",
        first_name: profile?.first_name || "",
        last_name: profile?.last_name || "",
        capid: profile?.capid || "",
        default_unit_id: profile?.default_unit_id || null,
        must_change_password: Boolean(profile?.must_change_password),
        ...access,
      });
    }

    if (action === "update_identity") {
      if (!callerIsAppAdmin) return json({ error: "Only an Application Admin can edit shared login identity information." }, 403);

      const userId = clean(body.user_id);
      if (!userId) return json({ error: "User account is required." });

      const firstName = clean(body.first_name);
      const lastName = clean(body.last_name);
      const capid = clean(body.capid) || null;
      const email = clean(body.email).toLowerCase();
      const displayName = clean(body.display_name) || clean([firstName, lastName].filter(Boolean).join(" "));

      if (capid) {
        const { data: conflict, error } = await admin.from("profiles").select("id").eq("capid", capid).neq("id", userId).maybeSingle();
        if (error) throw error;
        if (conflict) return json({ error: `CAPID ${capid} is already assigned to another shared login account.` });
      }

      const { data: currentAuth, error: currentAuthError } = await admin.auth.admin.getUserById(userId);
      if (currentAuthError || !currentAuth.user) throw currentAuthError || new Error("User account not found.");

      const authPatch: any = {
        user_metadata: {
          ...(currentAuth.user.user_metadata || {}),
          display_name: displayName,
          first_name: firstName,
          last_name: lastName,
          capid: capid || "",
        },
      };
      if (email && email !== (currentAuth.user.email || "").toLowerCase()) authPatch.email = email;

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, authPatch);
      if (authUpdateError) throw authUpdateError;

      const { error: profileError } = await admin.from("profiles").update({
        display_name: displayName,
        first_name: firstName || null,
        last_name: lastName || null,
        capid,
      }).eq("id", userId);
      if (profileError) throw profileError;

      return json({ ok: true });
    }

    if (action !== "save") return json({ error: "Unsupported action." }, 400);

    if (!unitId && clean(body.role) !== "application_admin") {
      return json({ error: "Choose the unit where this user will have access." });
    }
    if (!await callerCanAdminUnit(unitId)) {
      return json({ error: "You can only add Inspectors to units where you are a Unit Admin." }, 403);
    }

    const capid = clean(body.capid);
    const firstName = clean(body.first_name);
    const lastName = clean(body.last_name);
    const email = clean(body.email).toLowerCase();
    const password = String(body.password || "");
    const requestedUserId = clean(body.user_id);
    const editingExisting = callerIsAppAdmin && Boolean(body.edit_identity) && Boolean(requestedUserId);
    let role = clean(body.role || "inspector");
    if (role === "admin") role = "application_admin";

    if (!callerIsAppAdmin) role = "inspector";
    if (!["inspector", "unit_admin", "application_admin"].includes(role)) {
      return json({ error: "Choose Inspector, Unit Admin, or Application Admin." });
    }
    if (!callerIsAppAdmin && role !== "inspector") {
      return json({ error: "Unit Admins may only grant Inspector access." }, 403);
    }

    let homeUnitId = clean(body.home_unit_id) || unitId;
    if (!callerIsAppAdmin) homeUnitId = unitId;

    let { user, profile } = await resolveExistingUser(capid, email, requestedUserId);
    const existed = Boolean(user);
    let created = false;

    if (user) {
      const access = await uniformAccess(user.id, unitId);
      if (!editingExisting) {
        if (access.selected_unit_role === "application_admin") {
          return json({ error: "This account is already an Application Admin and already has access to every Uniform Inspection unit.", code: "already_application_admin" });
        }
        if (access.selected_unit_role === "unit_admin" && role !== "application_admin") {
          return json({ error: "This account is already a Unit Admin for this unit.", code: "already_unit_admin" });
        }
        if (access.selected_unit_role === "inspector" && role === "inspector") {
          return json({ error: "This account is already an Inspector for this unit.", code: "already_inspector" });
        }
      }
    } else {
      if (!email) return json({ error: "Email is required to create a new shared CAP Applications login." });
      if (password.length < 8) return json({ error: "A temporary password of at least 8 characters is required for a new shared account." });

      const displayName = clean(body.display_name) || clean([firstName, lastName].filter(Boolean).join(" ")) || email;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          first_name: firstName,
          last_name: lastName,
          capid,
        },
      });
      if (error || !data.user) throw error || new Error("Could not create the shared CAP account.");
      user = data.user;
      created = true;

      const { error: profileUpdateError } = await admin.from("profiles").update({
        display_name: displayName,
        first_name: firstName || null,
        last_name: lastName || null,
        capid: capid || null,
        default_unit_id: homeUnitId || null,
        must_change_password: true,
      }).eq("id", user.id);
      if (profileUpdateError) throw profileUpdateError;

      profile = {
        id: user.id,
        display_name: displayName,
        first_name: firstName || null,
        last_name: lastName || null,
        capid: capid || null,
        default_unit_id: homeUnitId || null,
        must_change_password: true,
      };
    }

    if (!user) throw new Error("Could not resolve the shared CAP account.");

    if (callerIsAppAdmin && existed) {
      const displayName = clean(body.display_name) || clean([firstName, lastName].filter(Boolean).join(" ")) || profile?.display_name || user.email || "CAP User";

      if (capid) {
        const { data: capidConflict, error: capidConflictError } = await admin
          .from("profiles")
          .select("id")
          .eq("capid", capid)
          .neq("id", user.id)
          .maybeSingle();
        if (capidConflictError) throw capidConflictError;
        if (capidConflict) return json({ error: `CAPID ${capid} is already assigned to another shared login account.` });
      }

      const authPatch: any = {
        user_metadata: {
          ...(user.user_metadata || {}),
          display_name: displayName,
          first_name: firstName,
          last_name: lastName,
          capid,
        },
      };
      if (email && email !== (user.email || "").toLowerCase()) authPatch.email = email;

      const { data: updatedAuth, error: authUpdateError } = await admin.auth.admin.updateUserById(user.id, authPatch);
      if (authUpdateError) throw authUpdateError;
      if (updatedAuth?.user) user = updatedAuth.user;

      const profilePatch: any = {
        display_name: displayName,
        first_name: firstName || null,
        last_name: lastName || null,
        capid: capid || null,
      };
      if (!profile?.default_unit_id && homeUnitId) profilePatch.default_unit_id = homeUnitId;

      const { error: profileUpdateError } = await admin.from("profiles").update(profilePatch).eq("id", user.id);
      if (profileUpdateError) throw profileUpdateError;
      profile = { ...(profile || {}), ...profilePatch };
    } else if (existed && !profile?.default_unit_id && homeUnitId) {
      const { error } = await admin.from("profiles").update({ default_unit_id: homeUnitId }).eq("id", user.id);
      if (error) throw error;
    }

    if (role === "application_admin") {
      if (!callerIsAppAdmin) return json({ error: "Only an Application Admin can grant Application Admin access." }, 403);
      const { error } = await admin.from("uniform_global_permissions").upsert({
        user_id: user.id,
        is_app_admin: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
    } else {
      if (role === "unit_admin" && !callerIsAppAdmin) {
        return json({ error: "Only an Application Admin can appoint Unit Admins." }, 403);
      }
      const { error } = await admin.from("uniform_unit_permissions").upsert({
        user_id: user.id,
        unit_id: unitId,
        can_inspect: true,
        is_unit_admin: role === "unit_admin",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,unit_id" });
      if (error) throw error;
    }

    return json({
      ok: true,
      user_id: user.id,
      role,
      unit_id: unitId,
      created_new_account: created,
      reused_existing_account: existed,
      display_name: profile?.display_name || clean([firstName, lastName].filter(Boolean).join(" ")) || user.email || "CAP User",
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
