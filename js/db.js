import { buildDemoState } from './demo-data.js';

const cfg = window.CAP_SCHEDULE_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
const deepClone = obj => JSON.parse(JSON.stringify(obj));
const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

export class CapScheduleDB {
  constructor(){
    this.demoMode = !configured && cfg.demoModeWhenUnconfigured !== false;
    this.client = null;
    this.demo = null;
    this.userContext = null;
  }

  async init(onAuthChange){
    if(this.demoMode){
      const stored = localStorage.getItem('capSchedule.demoState');
      this.demo = stored ? JSON.parse(stored) : buildDemoState();
      this.userContext = JSON.parse(sessionStorage.getItem('capSchedule.demoUser') || 'null');
      return {demoMode:true,userContext:this.userContext};
    }
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    this.client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const {data:{session}} = await this.client.auth.getSession();
    if(session) this.userContext = await this.loadUserContext(session.user);
    this.client.auth.onAuthStateChange(async (_event,session2)=>{
      this.userContext = session2 ? await this.loadUserContext(session2.user) : null;
      onAuthChange?.(this.userContext);
    });
    return {demoMode:false,userContext:this.userContext};
  }

  persistDemo(){ if(this.demoMode) localStorage.setItem('capSchedule.demoState',JSON.stringify(this.demo)); }
  async signIn(email,password){
    if(this.demoMode){
      if(!email || !password) throw new Error('Enter an email and password.');
      this.userContext = {
        id:'demo-user',email,displayName:'Demo App Administrator',isAppAdmin:true,
        permissions:this.demo.units.map(u=>({unit_id:u.id,unit_name:u.name,can_edit_cadet:true,can_edit_senior:true,is_unit_admin:true}))
      };
      sessionStorage.setItem('capSchedule.demoUser',JSON.stringify(this.userContext));
      return this.userContext;
    }
    const {data,error} = await this.client.auth.signInWithPassword({email,password});
    if(error) throw error;
    this.userContext = await this.loadUserContext(data.user);
    return this.userContext;
  }
  async updatePassword(password){
    if(this.demoMode) return {ok:true};
    const {error}=await this.client.auth.updateUser({password});if(error)throw error;return {ok:true};
  }
  async signOut(){
    if(this.demoMode){sessionStorage.removeItem('capSchedule.demoUser');this.userContext=null;return;}
    const {error}=await this.client.auth.signOut(); if(error) throw error;
  }
  async loadUserContext(user){
    const [{data:profile,error:pe},{data:perms,error:ue}] = await Promise.all([
      this.client.from('profiles').select('display_name,is_app_admin').eq('id',user.id).maybeSingle(),
      this.client.from('user_unit_permissions').select('unit_id,can_edit_cadet,can_edit_senior,is_unit_admin,units(name)').eq('user_id',user.id)
    ]);
    if(pe) throw pe; if(ue) throw ue;
    return {id:user.id,email:user.email,displayName:profile?.display_name || user.email,isAppAdmin:Boolean(profile?.is_app_admin),permissions:(perms||[]).map(p=>({...p,unit_name:p.units?.name}))};
  }

  async getUnits(){
    if(this.demoMode) return deepClone(this.demo.units.filter(u=>u.active));
    const {data,error}=await this.client.from('units').select('*').eq('active',true).order('name'); if(error) throw error; return data||[];
  }
  async getLookupData(unitId){
    if(this.demoMode) return {
      rooms:deepClone(this.demo.rooms.filter(r=>r.unit_id===unitId && r.active).sort((a,b)=>a.sort_order-b.sort_order)),
      categories:deepClone(this.demo.categories),requirements:deepClone(this.demo.requirements),
      themes:deepClone(this.demo.themes.filter(x=>!x.unit_id||x.unit_id===unitId)),uniforms:deepClone(this.demo.uniforms.filter(x=>!x.unit_id||x.unit_id===unitId)),
      activityLibrary:deepClone(this.demo.activityLibrary.filter(x=>x.scope==='statewide'||x.unit_id===unitId))
    };
    const [rooms,categories,requirements,themes,uniforms,library] = await Promise.all([
      this.client.from('rooms').select('*').eq('unit_id',unitId).eq('active',true).order('sort_order'),
      this.client.from('activity_categories').select('*').order('sort_order'),
      this.client.from('training_requirements').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).order('sort_order'),
      this.client.from('meeting_themes').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).eq('active',true).order('name'),
      this.client.from('uniforms').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).eq('active',true).order('name'),
      this.client.from('activity_library').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).eq('active',true).order('title')
    ]);
    for(const r of [rooms,categories,requirements,themes,uniforms,library]) if(r.error) throw r.error;
    return {rooms:rooms.data||[],categories:categories.data||[],requirements:requirements.data||[],themes:themes.data||[],uniforms:uniforms.data||[],activityLibrary:library.data||[]};
  }

  async getPublicMonth(unitId,year,month,program='combined'){
    if(this.demoMode){
      return deepClone(this.demo.schedules.filter(s=>s.unit_id===unitId&&s.year===year&&s.month===month&&(program==='combined'||s.program_type===program)).flatMap(s=>{
        const v=s.versions.find(x=>x.id===s.current_published_version_id&&x.status==='published');
        return v ? v.meetings.map(m=>({...m,program_type:s.program_type,version_number:v.version_number,published_at:v.published_at,events:m.events||[]})) : [];
      }).sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date)||a.program_type.localeCompare(b.program_type)));
    }
    let q=this.client.from('published_meetings_view').select('*').eq('unit_id',unitId).eq('schedule_year',year).eq('schedule_month',month).order('meeting_date');
    if(program!=='combined') q=q.eq('program_type',program);
    const {data,error}=await q; if(error) throw error;
    const ids=(data||[]).map(x=>x.meeting_id);
    let events=[];
    if(ids.length){const res=await this.client.from('published_events_view').select('*').in('meeting_id',ids).order('start_time');if(res.error)throw res.error;events=res.data||[];}
    return (data||[]).map(m=>({...m,id:m.meeting_id,events:events.filter(e=>e.meeting_id===m.meeting_id).map(e=>({...e,id:e.event_id}))}));
  }

  canEdit(unitId,program){
    if(!this.userContext) return false;
    if(this.userContext.isAppAdmin) return true;
    const p=this.userContext.permissions.find(x=>x.unit_id===unitId);
    return Boolean(p && (program==='cadet'?p.can_edit_cadet:p.can_edit_senior));
  }
  isUnitAdmin(unitId){
    if(!this.userContext) return false;
    if(this.userContext.isAppAdmin) return true;
    return Boolean(this.userContext.permissions.find(x=>x.unit_id===unitId&&x.is_unit_admin));
  }

  async getPlanningMonth(unitId,program,year,month){
    if(!this.canEdit(unitId,program)) throw new Error('You do not have permission to edit this schedule.');
    if(this.demoMode){
      let s=this.demo.schedules.find(x=>x.unit_id===unitId&&x.program_type===program&&x.year===year&&x.month===month);
      if(!s){s={id:uid('s'),unit_id:unitId,program_type:program,year,month,current_published_version_id:null,versions:[]};this.demo.schedules.push(s);}
      let draft=s.versions.find(v=>v.status==='draft');
      if(!draft){
        const pub=s.versions.find(v=>v.id===s.current_published_version_id);
        draft=pub?deepClone(pub):{id:uid('v'),version_number:1,status:'draft',published_at:null,meetings:[]};
        draft.id=uid('v');draft.status='draft';draft.published_at=null;draft.version_number=Math.max(0,...s.versions.map(v=>v.version_number||0))+1;
        draft.meetings=(draft.meetings||[]).map(m=>({...m,id:uid('m'),events:(m.events||[]).map(e=>({...e,id:uid('e')}))}));
        s.versions.push(draft);this.persistDemo();
      }
      return {schedule:deepClone(s),version:deepClone(draft)};
    }
    const {data,error}=await this.client.rpc('get_or_create_schedule_draft',{p_unit_id:unitId,p_program_type:program,p_year:year,p_month:month}); if(error) throw error;
    return this.fetchDraftVersion(data);
  }
  async fetchDraftVersion(versionId){
    const {data:v,error:ve}=await this.client.from('schedule_versions').select('*,schedules(*)').eq('id',versionId).single(); if(ve) throw ve;
    const {data:meetings,error:me}=await this.client.from('meetings').select('*').eq('schedule_version_id',versionId).order('meeting_date'); if(me) throw me;
    const ids=(meetings||[]).map(m=>m.id); let events=[];
    if(ids.length){const r=await this.client.from('meeting_events').select('*').in('meeting_id',ids).order('start_time');if(r.error)throw r.error;events=r.data||[];}
    return {schedule:v.schedules,version:{...v,meetings:(meetings||[]).map(m=>({...m,events:events.filter(e=>e.meeting_id===m.id)}))}};
  }

  async generateNormalMeetings(versionId){
    if(this.demoMode){
      const found=this.findDemoVersion(versionId); const unit=this.demo.units.find(u=>u.id===found.schedule.unit_id); const {year,month}=found.schedule;
      const d=new Date(year,month-1,1); while(d.getMonth()===month-1){if(d.getDay()===unit.meeting_weekday){const date=`${year}-${String(month).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;if(!found.version.meetings.some(m=>m.meeting_date===date))found.version.meetings.push({id:uid('m'),meeting_date:date,theme_id:null,uniform_id:null,start_time:unit.default_start_time,end_time:unit.default_end_time,is_cancelled:false,cancel_reason:null,title:null,events:[]});}d.setDate(d.getDate()+1);} found.version.meetings.sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date));this.persistDemo();return deepClone(found.version);
    }
    const {error}=await this.client.rpc('generate_normal_meetings',{p_schedule_version_id:versionId}); if(error) throw error; return (await this.fetchDraftVersion(versionId)).version;
  }

  findDemoVersion(versionId){for(const s of this.demo.schedules){const v=s.versions.find(x=>x.id===versionId);if(v)return{schedule:s,version:v};}throw new Error('Draft version not found.');}
  findDemoMeeting(meetingId){for(const s of this.demo.schedules)for(const v of s.versions){const m=v.meetings.find(x=>x.id===meetingId);if(m)return{schedule:s,version:v,meeting:m};}throw new Error('Meeting not found.');}

  async addMeeting(versionId,date){
    if(this.demoMode){const f=this.findDemoVersion(versionId);const u=this.demo.units.find(x=>x.id===f.schedule.unit_id);const m={id:uid('m'),meeting_date:date,theme_id:null,uniform_id:null,start_time:u.default_start_time,end_time:u.default_end_time,is_cancelled:false,cancel_reason:null,title:null,events:[]};f.version.meetings.push(m);f.version.meetings.sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date));this.persistDemo();return deepClone(m);}
    const {data,error}=await this.client.from('meetings').insert({schedule_version_id:versionId,meeting_date:date}).select().single();if(error)throw error;return data;
  }
  async updateMeeting(meetingId,patch){
    if(this.demoMode){const f=this.findDemoMeeting(meetingId);Object.assign(f.meeting,patch);this.persistDemo();return deepClone(f.meeting);}
    const {data,error}=await this.client.from('meetings').update(patch).eq('id',meetingId).select().single();if(error)throw error;return data;
  }
  async saveEvent(meetingId,event){
    const clean={room_id:event.room_id||null,start_time:event.start_time,end_time:event.end_time,title:event.title,category_id:event.category_id||null,audience:event.audience||null,instructor_name:event.instructor_name||null,uniform_override_id:event.uniform_override_id||null,description:event.description||null};
    if(this.demoMode){const f=this.findDemoMeeting(meetingId);let e;if(event.id){e=f.meeting.events.find(x=>x.id===event.id);Object.assign(e,clean);}else{e={id:uid('e'),...clean};f.meeting.events.push(e);}this.persistDemo();return deepClone(e);}
    if(event.id){const {data,error}=await this.client.from('meeting_events').update(clean).eq('id',event.id).select().single();if(error)throw error;return data;}
    const {data,error}=await this.client.from('meeting_events').insert({meeting_id:meetingId,...clean}).select().single();if(error)throw error;return data;
  }
  async deleteEvent(eventId){
    if(this.demoMode){for(const s of this.demo.schedules)for(const v of s.versions)for(const m of v.meetings){const i=m.events.findIndex(e=>e.id===eventId);if(i>=0){m.events.splice(i,1);this.persistDemo();return;}}return;}
    const {error}=await this.client.from('meeting_events').delete().eq('id',eventId);if(error)throw error;
  }
  async copyMeeting(sourceMeetingId,targetDate){
    if(this.demoMode){const src=this.findDemoMeeting(sourceMeetingId);const f=src.version;const copy=deepClone(src.meeting);copy.id=uid('m');copy.meeting_date=targetDate;copy.events=copy.events.map(e=>({...e,id:uid('e')}));f.meetings.push(copy);f.meetings.sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date));this.persistDemo();return deepClone(copy);}
    const {data,error}=await this.client.rpc('copy_meeting',{p_source_meeting_id:sourceMeetingId,p_target_date:targetDate});if(error)throw error;return data;
  }
  async copyMonth(targetVersionId,sourceYear,sourceMonth){
    if(this.demoMode){
      const target=this.findDemoVersion(targetVersionId);const src=this.demo.schedules.find(s=>s.unit_id===target.schedule.unit_id&&s.program_type===target.schedule.program_type&&s.year===sourceYear&&s.month===sourceMonth);if(!src)throw new Error('No source schedule exists for that month.');const sv=src.versions.find(v=>v.id===src.current_published_version_id)||src.versions.find(v=>v.status==='draft');if(!sv)throw new Error('The source month has no schedule data.');
      const targetDates=[];const unit=this.demo.units.find(u=>u.id===target.schedule.unit_id);const d=new Date(target.schedule.year,target.schedule.month-1,1);while(d.getMonth()===target.schedule.month-1){if(d.getDay()===unit.meeting_weekday)targetDates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);d.setDate(d.getDate()+1);}target.version.meetings=[];sv.meetings.forEach((m,i)=>{if(!targetDates[i])return;const c=deepClone(m);c.id=uid('m');c.meeting_date=targetDates[i];c.events=c.events.map(e=>({...e,id:uid('e')}));target.version.meetings.push(c);});this.persistDemo();return deepClone(target.version);
    }
    const {error}=await this.client.rpc('copy_month_into_draft',{p_target_version_id:targetVersionId,p_source_year:sourceYear,p_source_month:sourceMonth});if(error)throw error;return(await this.fetchDraftVersion(targetVersionId)).version;
  }
  async publishVersion(versionId){
    if(this.demoMode){const f=this.findDemoVersion(versionId);f.schedule.versions.forEach(v=>{if(v.status==='published')v.status='archived';});f.version.status='published';f.version.published_at=new Date().toISOString();f.schedule.current_published_version_id=f.version.id;this.persistDemo();return;}
    const {error}=await this.client.rpc('publish_schedule_version',{p_version_id:versionId});if(error)throw error;
  }

  async getMeetingTemplates(unitId,program){
    if(this.demoMode) return deepClone((this.demo.meetingTemplates||[]).filter(t=>t.unit_id===unitId&&t.program_type===program).sort((a,b)=>a.name.localeCompare(b.name)));
    const {data,error}=await this.client.from('meeting_templates').select('*,meeting_template_events(*)').eq('unit_id',unitId).eq('program_type',program).eq('active',true).order('name');if(error)throw error;return data||[];
  }
  async saveMeetingAsTemplate(meetingId,name){
    const f=this.demoMode?this.findDemoMeeting(meetingId):null;
    if(this.demoMode){
      const t={id:uid('tpl'),unit_id:f.schedule.unit_id,program_type:f.schedule.program_type,name,theme_id:f.meeting.theme_id,uniform_id:f.meeting.uniform_id,start_time:f.meeting.start_time,end_time:f.meeting.end_time,active:true,events:(f.meeting.events||[]).map(e=>({...deepClone(e),id:uid('te')}))};
      this.demo.meetingTemplates=this.demo.meetingTemplates||[];this.demo.meetingTemplates.push(t);this.persistDemo();return deepClone(t);
    }
    const {data,error}=await this.client.rpc('save_meeting_as_template',{p_meeting_id:meetingId,p_name:name});if(error)throw error;return data;
  }
  async applyMeetingTemplate(meetingId,templateId){
    if(this.demoMode){
      const f=this.findDemoMeeting(meetingId);const t=(this.demo.meetingTemplates||[]).find(x=>x.id===templateId);if(!t)throw new Error('Template not found.');
      Object.assign(f.meeting,{theme_id:t.theme_id,uniform_id:t.uniform_id,start_time:t.start_time,end_time:t.end_time,is_cancelled:false,cancel_reason:null,events:(t.events||[]).map(e=>({...deepClone(e),id:uid('e')}))});this.persistDemo();return deepClone(f.meeting);
    }
    const {error}=await this.client.rpc('apply_meeting_template',{p_meeting_id:meetingId,p_template_id:templateId});if(error)throw error;return;
  }

  async getSpecialActivities(unitId='all',range='upcoming'){
    if(this.demoMode){let rows=deepClone(this.demo.specialActivities.filter(x=>x.status==='published'));if(unitId!=='all')rows=rows.filter(x=>x.unit_id===unitId);return rows.sort((a,b)=>a.starts_at.localeCompare(b.starts_at));}
    let q=this.client.from('special_activities').select('*,units(name,charter_number)').eq('status','published').order('starts_at');if(unitId!=='all')q=q.eq('unit_id',unitId);const now=new Date().toISOString();if(range==='upcoming'||range==='90')q=q.gte('ends_at',now);const {data,error}=await q;if(error)throw error;return data||[];
  }
  async saveSpecialActivity(activity){
    if(!this.canEdit(activity.unit_id,'cadet')&&!this.canEdit(activity.unit_id,'senior'))throw new Error('You do not have edit permission for this unit.');
    const clean={unit_id:activity.unit_id,title:activity.title,audience:activity.audience||null,starts_at:activity.starts_at,ends_at:activity.ends_at,location:activity.location||null,description:activity.description||null,status:activity.status||'published'};
    if(this.demoMode){let row;if(activity.id){row=this.demo.specialActivities.find(x=>x.id===activity.id);Object.assign(row,clean);}else{row={id:uid('sp'),...clean};this.demo.specialActivities.push(row);}this.persistDemo();return deepClone(row);}
    if(activity.id){const {data,error}=await this.client.from('special_activities').update(clean).eq('id',activity.id).select().single();if(error)throw error;return data;}
    const {data,error}=await this.client.from('special_activities').insert(clean).select().single();if(error)throw error;return data;
  }

  async adminListUnits(){return this.getUnits();}
  async adminSaveUnit(unit){
    if(this.demoMode){let row;if(unit.id){row=this.demo.units.find(x=>x.id===unit.id);Object.assign(row,unit);}else{row={id:uid('u'),active:true,...unit};this.demo.units.push(row);}this.persistDemo();return deepClone(row);}
    const payload={charter_number:unit.charter_number,name:unit.name,city:unit.city||null,state:unit.state||'MT',meeting_weekday:Number(unit.meeting_weekday),default_start_time:unit.default_start_time,default_end_time:unit.default_end_time,active:unit.active!==false};
    const r=unit.id?await this.client.from('units').update(payload).eq('id',unit.id).select().single():await this.client.from('units').insert(payload).select().single();if(r.error)throw r.error;return r.data;
  }
  async adminSaveRoom(room){
    if(this.demoMode){let row;if(room.id){row=this.demo.rooms.find(x=>x.id===room.id);Object.assign(row,room);}else{row={id:uid('r'),sort_order:99,active:true,...room};this.demo.rooms.push(row);}this.persistDemo();return deepClone(row);}
    const r=room.id?await this.client.from('rooms').update(room).eq('id',room.id).select().single():await this.client.from('rooms').insert(room).select().single();if(r.error)throw r.error;return r.data;
  }
  async adminListUsers(unitId){
    if(this.demoMode) return [{id:'demo-user',email:'admin@example.org',display_name:'Demo Administrator',is_app_admin:true,permissions:this.userContext?.permissions||[]}];
    const token=(await this.client.auth.getSession()).data.session?.access_token;const res=await fetch(`${cfg.supabaseUrl}/functions/v1/admin-users?unit_id=${encodeURIComponent(unitId||'')}`,{headers:{Authorization:`Bearer ${token}`,apikey:cfg.supabaseAnonKey}});const body=await res.json();if(!res.ok)throw new Error(body.error||'Unable to load users.');return body.users||[];
  }
  async adminUpsertUser(payload){
    if(this.demoMode) return {ok:true};
    const token=(await this.client.auth.getSession()).data.session?.access_token;const res=await fetch(`${cfg.supabaseUrl}/functions/v1/admin-users`,{method:'POST',headers:{Authorization:`Bearer ${token}`,apikey:cfg.supabaseAnonKey,'Content-Type':'application/json'},body:JSON.stringify(payload)});const body=await res.json();if(!res.ok)throw new Error(body.error||'Unable to save user.');return body;
  }
  async adminUpdateRequirement(id,patch){
    if(!this.userContext?.isAppAdmin) throw new Error('App Administrator permission required.');
    if(this.demoMode){const r=this.demo.requirements.find(x=>x.id===id);if(!r)throw new Error('Requirement not found.');Object.assign(r,patch);this.persistDemo();return deepClone(r);}
    const {data,error}=await this.client.from('training_requirements').update(patch).eq('id',id).select().single();if(error)throw error;return data;
  }
  async adminAddTheme(unitId,name){
    if(!this.isUnitAdmin(unitId)) throw new Error('Unit Administrator permission required.');
    if(this.demoMode){const row={id:uid('t'),unit_id:unitId,name,active:true};this.demo.themes.push(row);this.persistDemo();return deepClone(row);}
    const {data,error}=await this.client.from('meeting_themes').insert({unit_id:unitId,name,active:true}).select().single();if(error)throw error;return data;
  }
  async adminAddUniform(unitId,name){
    if(!this.isUnitAdmin(unitId)) throw new Error('Unit Administrator permission required.');
    if(this.demoMode){const row={id:uid('uod'),unit_id:unitId,name,active:true};this.demo.uniforms.push(row);this.persistDemo();return deepClone(row);}
    const {data,error}=await this.client.from('uniforms').insert({unit_id:unitId,name,active:true}).select().single();if(error)throw error;return data;
  }
  async adminAddLibraryActivity(unitId,title,minutes=30){
    if(!this.isUnitAdmin(unitId)) throw new Error('Unit Administrator permission required.');
    if(this.demoMode){const row={id:uid('a'),scope:'unit',unit_id:unitId,title,default_duration_minutes:minutes,category_id:null,default_audience:null,active:true};this.demo.activityLibrary.push(row);this.persistDemo();return deepClone(row);}
    const {data,error}=await this.client.from('activity_library').insert({scope:'unit',unit_id:unitId,title,default_duration_minutes:minutes,active:true}).select().single();if(error)throw error;return data;
  }
  async adminGetAudit(limit=100){
    if(this.demoMode)return[];const {data,error}=await this.client.from('audit_log').select('*,profiles(display_name)').order('created_at',{ascending:false}).limit(limit);if(error)throw error;return data||[];
  }
}
