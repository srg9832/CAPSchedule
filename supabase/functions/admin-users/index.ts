import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers:{...cors,'Content-Type':'application/json'}});

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok',{headers:cors});
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    if(!authHeader) return json({error:'Authentication required.'},401);

    const callerClient = createClient(url, anon, {global:{headers:{Authorization:authHeader}}});
    const {data:{user:caller},error:userError} = await callerClient.auth.getUser();
    if(userError || !caller) return json({error:'Invalid session.'},401);

    const admin = createClient(url, service, {auth:{autoRefreshToken:false,persistSession:false}});
    const {data:callerProfile,error:callerProfileError} = await admin.from('profiles').select('is_app_admin').eq('id',caller.id).single();
    if(callerProfileError) throw callerProfileError;
    const isAppAdmin = Boolean(callerProfile?.is_app_admin);

    async function callerCanAdminUnit(unitId:string|null) {
      if(isAppAdmin) return true;
      if(!unitId) return false;
      const {data:p,error} = await admin.from('user_unit_permissions').select('is_unit_admin').eq('user_id',caller.id).eq('unit_id',unitId).maybeSingle();
      if(error) throw error;
      return Boolean(p?.is_unit_admin);
    }

    if(req.method === 'GET') {
      const unitId = new URL(req.url).searchParams.get('unit_id');
      if(!await callerCanAdminUnit(unitId)) return json({error:'Unit Administrator permission required.'},403);

      const {data:list,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:1000});
      if(listError) throw listError;
      let authUsers=list.users;
      let permissions:any[]=[];
      if(unitId){
        const {data,error}=await admin.from('user_unit_permissions').select('*').eq('unit_id',unitId);if(error)throw error;permissions=data||[];
        if(!isAppAdmin){const ids=new Set(permissions.map(p=>p.user_id));authUsers=authUsers.filter(u=>ids.has(u.id));}
      } else {
        const {data,error}=await admin.from('user_unit_permissions').select('*');if(error)throw error;permissions=data||[];
      }
      const ids=authUsers.map(u=>u.id);
      const profiles = ids.length ? (await admin.from('profiles').select('id,display_name,is_app_admin,default_unit_id').in('id',ids)).data || [] : [];
      return json({users:authUsers.map(u=>{
        const profile=profiles.find(p=>p.id===u.id);
        return {
          id:u.id,email:u.email,display_name:profile?.display_name,
          is_app_admin:Boolean(profile?.is_app_admin),default_unit_id:profile?.default_unit_id||null,
          permissions:permissions.filter(p=>p.user_id===u.id)
        };
      })});
    }

    if(req.method === 'POST') {
      const body = await req.json();
      if(!['save','upsert'].includes(String(body.action||''))) return json({error:'Unsupported action.'},400);
      const unitId=body.unit_id ? String(body.unit_id) : null;
      if(!await callerCanAdminUnit(unitId)) return json({error:'Unit Administrator permission required.'},403);

      const email=String(body.email||'').trim().toLowerCase();
      const displayName=String(body.display_name||'').trim();
      const password=String(body.password||'');
      const requestedUserId=body.user_id ? String(body.user_id) : null;
      if(!email) return json({error:'Email is required.'},400);
      if(!displayName) return json({error:'Username / display name is required.'},400);

      const {data:list,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:1000});if(listError)throw listError;
      let target = requestedUserId ? list.users.find(u=>u.id===requestedUserId) : list.users.find(u=>u.email?.toLowerCase()===email);
      const creating = !target;

      if(target && !isAppAdmin){
        const {data:tp,error:tpe}=await admin.from('profiles').select('is_app_admin').eq('id',target.id).maybeSingle();if(tpe)throw tpe;
        if(tp?.is_app_admin) return json({error:'Only an App Administrator can modify an App Administrator account.'},403);
        const {data:unitMembership,error:ume}=await admin.from('user_unit_permissions').select('user_id').eq('user_id',target.id).eq('unit_id',unitId).maybeSingle();if(ume)throw ume;
        if(!unitMembership) return json({error:'This user is not assigned to your unit.'},403);
      }

      if(creating){
        if(password.length<8) return json({error:'New users require a password of at least 8 characters.'},400);
        const {data,error}=await admin.auth.admin.createUser({
          email,password,email_confirm:true,user_metadata:{display_name:displayName}
        });
        if(error) throw error;
        target=data.user;
      } else {
        const attrs:any={email,user_metadata:{...(target.user_metadata||{}),display_name:displayName}};
        if(password) {
          if(password.length<8) return json({error:'Passwords must contain at least 8 characters.'},400);
          attrs.password=password;
        }
        const {data,error}=await admin.auth.admin.updateUserById(target.id,attrs);
        if(error) throw error;
        target=data.user;
      }
      if(!target) throw new Error('Unable to create or locate the user.');

      const profilePatch:any={id:target.id,display_name:displayName};
      if(isAppAdmin) profilePatch.is_app_admin=Boolean(body.is_app_admin);
      const {error:profileError}=await admin.from('profiles').upsert(profilePatch,{onConflict:'id'});if(profileError)throw profileError;

      if(unitId){
        let keepUnitAdmin=false;
        if(!isAppAdmin && !creating){
          const {data:existingPerm,error:existingPermError}=await admin.from('user_unit_permissions')
            .select('is_unit_admin').eq('user_id',target.id).eq('unit_id',unitId).maybeSingle();
          if(existingPermError) throw existingPermError;
          keepUnitAdmin=Boolean(existingPerm?.is_unit_admin);
        }
        const permission={
          user_id:target.id,unit_id:unitId,
          can_edit_cadet:Boolean(body.can_edit_cadet),can_edit_senior:Boolean(body.can_edit_senior),
          is_unit_admin:isAppAdmin?Boolean(body.is_unit_admin):keepUnitAdmin
        };
        const {error:permError}=await admin.from('user_unit_permissions').upsert(permission,{onConflict:'user_id,unit_id'});if(permError)throw permError;
      }
      return json({ok:true,user_id:target.id,created:creating});
    }
    return json({error:'Method not allowed.'},405);
  } catch (err) {
    console.error(err);
    return json({error:err instanceof Error?err.message:String(err)},500);
  }
});
