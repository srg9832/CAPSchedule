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
    const {data:callerProfile} = await admin.from('profiles').select('is_app_admin').eq('id',caller.id).single();
    const isAppAdmin = Boolean(callerProfile?.is_app_admin);

    if(req.method === 'GET') {
      const unitId = new URL(req.url).searchParams.get('unit_id');
      if(!unitId && !isAppAdmin) return json({error:'A unit is required.'},400);
      if(unitId && !isAppAdmin) {
        const {data:p} = await admin.from('user_unit_permissions').select('is_unit_admin').eq('user_id',caller.id).eq('unit_id',unitId).maybeSingle();
        if(!p?.is_unit_admin) return json({error:'Unit Administrator permission required.'},403);
      }
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
      const profiles = ids.length ? (await admin.from('profiles').select('id,display_name,is_app_admin').in('id',ids)).data || [] : [];
      return json({users:authUsers.map(u=>{
        const profile=profiles.find(p=>p.id===u.id);
        return {id:u.id,email:u.email,display_name:profile?.display_name,is_app_admin:Boolean(profile?.is_app_admin),permissions:permissions.filter(p=>p.user_id===u.id)};
      })});
    }

    if(req.method === 'POST') {
      const body = await req.json();
      if(body.action !== 'upsert') return json({error:'Unsupported action.'},400);
      const email=String(body.email||'').trim().toLowerCase();
      const unitId=body.unit_id ? String(body.unit_id) : null;
      if(!email) return json({error:'Email is required.'},400);
      if(!unitId && !isAppAdmin) return json({error:'Unit is required.'},400);

      let callerIsUnitAdmin=false;
      if(unitId && !isAppAdmin){
        const {data:p}=await admin.from('user_unit_permissions').select('is_unit_admin').eq('user_id',caller.id).eq('unit_id',unitId).maybeSingle();
        callerIsUnitAdmin=Boolean(p?.is_unit_admin);
        if(!callerIsUnitAdmin) return json({error:'Unit Administrator permission required.'},403);
      }

      const {data:list,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:1000});if(listError)throw listError;
      let target=list.users.find(u=>u.email?.toLowerCase()===email);
      if(!target){
        const {data,error}=await admin.auth.admin.inviteUserByEmail(email,{data:{display_name:body.display_name||email.split('@')[0]}});if(error)throw error;target=data.user;
      }
      if(!target) throw new Error('Unable to create or locate the user.');

      const displayName=String(body.display_name||'').trim()||email.split('@')[0];
      const profilePatch:any={id:target.id,display_name:displayName};
      if(isAppAdmin) profilePatch.is_app_admin=Boolean(body.is_app_admin);
      const {error:profileError}=await admin.from('profiles').upsert(profilePatch,{onConflict:'id'});if(profileError)throw profileError;

      if(unitId){
        const permission={
          user_id:target.id,unit_id:unitId,
          can_edit_cadet:Boolean(body.can_edit_cadet),can_edit_senior:Boolean(body.can_edit_senior),
          is_unit_admin:isAppAdmin?Boolean(body.is_unit_admin):false
        };
        const {error:permError}=await admin.from('user_unit_permissions').upsert(permission,{onConflict:'user_id,unit_id'});if(permError)throw permError;
      }
      return json({ok:true,user_id:target.id,invited:!list.users.some(u=>u.id===target!.id)});
    }
    return json({error:'Method not allowed.'},405);
  } catch (err) {
    console.error(err);
    return json({error:err instanceof Error?err.message:String(err)},500);
  }
});
