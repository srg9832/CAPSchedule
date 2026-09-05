import { buildDemoState } from './demo-data.js';
import { putCache, getCache, putDraft, getDraft, getDirtyDrafts, markDraftClean, offlineKeys } from './offline-store.js';

const cfg = window.CAP_SCHEDULE_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
const deepClone = obj => JSON.parse(JSON.stringify(obj));
const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const pad = n => String(n).padStart(2,'0');
const dateISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export class CapScheduleDB {
  constructor(){
    this.demoMode=!configured && cfg.demoModeWhenUnconfigured !== false;
    this.client=null;
    this.demo=null;
    this.userContext=null;
  }

  async init(onAuthChange){
    this.authChangeHandler=onAuthChange;
    if(this.demoMode){
      const stored=localStorage.getItem('capSchedule.demoState');
      this.demo=stored?JSON.parse(stored):buildDemoState();
      this.userContext=JSON.parse(sessionStorage.getItem('capSchedule.demoUser')||'null');
      return {demoMode:true,userContext:this.userContext};
    }
    if(!isOnline()){
      this.userContext=JSON.parse(localStorage.getItem('capSchedule.offlineUserContext')||'null');
      return {demoMode:false,userContext:this.userContext,offline:true};
    }
    await this.connectClient();
    const {data:{session}}=await this.client.auth.getSession();
    if(session)this.userContext=await this.loadUserContext(session.user);
    return {demoMode:false,userContext:this.userContext};
  }

  async connectClient(){
    if(this.demoMode||this.client)return this.client;
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    this.client=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
    this.client.auth.onAuthStateChange(async (_event,session2)=>{
      try{
        this.userContext=session2?await this.loadUserContext(session2.user):null;
        if(this.userContext)localStorage.setItem('capSchedule.offlineUserContext',JSON.stringify(this.userContext));
        else localStorage.removeItem('capSchedule.offlineUserContext');
        this.authChangeHandler?.(this.userContext);
      }catch(err){console.warn('Auth refresh failed',err);}
    });
    return this.client;
  }

  async reconnect(){
    if(this.demoMode)return;
    await this.connectClient();
    const {data:{session}}=await this.client.auth.getSession();
    if(session)this.userContext=await this.loadUserContext(session.user);
  }


  persistDemo(){if(this.demoMode)localStorage.setItem('capSchedule.demoState',JSON.stringify(this.demo));}
  online(){return this.demoMode||isOnline();}

  async signIn(email,password){
    if(this.demoMode){
      if(!email||!password)throw new Error('Enter an email and password.');
      this.userContext={id:'demo-user',email,displayName:'Demo App Administrator',isAppAdmin:true,defaultUnitId:this.demo.units[0]?.id||null,permissions:this.demo.units.map(u=>({unit_id:u.id,unit_name:u.name,can_edit_cadet:true,can_edit_senior:true,is_unit_admin:true}))};
      sessionStorage.setItem('capSchedule.demoUser',JSON.stringify(this.userContext));return this.userContext;
    }
    if(!isOnline())throw new Error('You must be online to log in. Existing signed-in sessions can continue using cached offline data.');
    if(!this.client)await this.reconnect();
    const {data,error}=await this.client.auth.signInWithPassword({email,password});if(error)throw error;
    this.userContext=await this.loadUserContext(data.user);localStorage.setItem('capSchedule.offlineUserContext',JSON.stringify(this.userContext));return this.userContext;
  }
  async updatePassword(password){if(this.demoMode)return{ok:true};if(!isOnline())throw new Error('Reconnect before changing your password.');if(!this.client)await this.reconnect();const {error}=await this.client.auth.updateUser({password});if(error)throw error;return{ok:true};}
  async updateMyDefaultUnit(unitId){
    if(!this.userContext)throw new Error('Login required.');
    if(this.demoMode){this.userContext.defaultUnitId=unitId||null;sessionStorage.setItem('capSchedule.demoUser',JSON.stringify(this.userContext));return;}
    if(!isOnline())throw new Error('Reconnect before changing your account default unit.');
    if(!this.client)await this.reconnect();
    const {error}=await this.client.from('profiles').update({default_unit_id:unitId||null}).eq('id',this.userContext.id);if(error)throw error;
    this.userContext.defaultUnitId=unitId||null;localStorage.setItem('capSchedule.offlineUserContext',JSON.stringify(this.userContext));
  }
  async signOut(){if(this.demoMode){sessionStorage.removeItem('capSchedule.demoUser');this.userContext=null;return;}if(!this.client||!isOnline()){this.userContext=null;localStorage.removeItem('capSchedule.offlineUserContext');return;}const {error}=await this.client.auth.signOut();if(error)throw error;localStorage.removeItem('capSchedule.offlineUserContext');}
  async loadUserContext(user){
    const [{data:profile,error:pe},{data:perms,error:ue}]=await Promise.all([
      this.client.from('profiles').select('display_name,is_app_admin,default_unit_id').eq('id',user.id).maybeSingle(),
      this.client.from('user_unit_permissions').select('unit_id,can_edit_cadet,can_edit_senior,is_unit_admin,units(name)').eq('user_id',user.id)
    ]);
    if(pe)throw pe;if(ue)throw ue;
    const context={id:user.id,email:user.email,displayName:profile?.display_name||user.email,isAppAdmin:Boolean(profile?.is_app_admin),defaultUnitId:profile?.default_unit_id||null,permissions:(perms||[]).map(p=>({...p,unit_name:p.units?.name}))};localStorage.setItem('capSchedule.offlineUserContext',JSON.stringify(context));return context;
  }

  canEdit(unitId,program){if(!this.userContext)return false;if(this.userContext.isAppAdmin)return true;const p=this.userContext.permissions.find(x=>x.unit_id===unitId);return Boolean(p&&(program==='cadet'?p.can_edit_cadet:p.can_edit_senior));}
  canEditAnyAtUnit(unitId){return this.canEdit(unitId,'cadet')||this.canEdit(unitId,'senior');}
  isUnitAdmin(unitId){if(!this.userContext)return false;if(this.userContext.isAppAdmin)return true;return Boolean(this.userContext.permissions.find(x=>x.unit_id===unitId&&x.is_unit_admin));}

  async getUnits(){
    if(this.demoMode)return deepClone(this.demo.units.filter(u=>u.active));
    if(!isOnline()){const cached=await getCache(offlineKeys.units);if(cached)return cached;throw new Error('No unit list has been cached for offline use yet.');}
    const {data,error}=await this.client.from('units').select('*').eq('active',true).order('name');if(error)throw error;await putCache(offlineKeys.units,data||[]);try{localStorage.setItem('capSchedule.cachedUnits',JSON.stringify(data||[]));}catch{}return data||[];
  }

  async getLookupData(unitId){
    if(this.demoMode)return{
      rooms:deepClone(this.demo.rooms.filter(r=>r.unit_id===unitId).sort((a,b)=>a.sort_order-b.sort_order)),
      groups:deepClone((this.demo.groups||[]).filter(g=>g.unit_id===unitId).sort((a,b)=>a.sort_order-b.sort_order)),
      categories:deepClone(this.demo.categories),requirements:deepClone(this.demo.requirements),
      themes:deepClone(this.demo.themes.filter(x=>(!x.unit_id||x.unit_id===unitId))),uniforms:deepClone(this.demo.uniforms.filter(x=>(!x.unit_id||x.unit_id===unitId))),
      activityLibrary:deepClone(this.demo.activityLibrary.filter(x=>(x.scope==='statewide'||x.unit_id===unitId)&&x.active!==false))
    };
    if(!isOnline()){const cached=await getCache(offlineKeys.lookup(unitId));if(cached)return cached;throw new Error('This unit has not been cached for offline planning yet. Open it once while online.');}
    const [rooms,groups,categories,requirements,themes,uniforms,library]=await Promise.all([
      this.client.from('rooms').select('*').eq('unit_id',unitId).order('sort_order'),
      this.client.from('schedule_groups').select('*').eq('unit_id',unitId).order('sort_order'),
      this.client.from('activity_categories').select('*').order('sort_order'),
      this.client.from('training_requirements').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).order('sort_order'),
      this.client.from('meeting_themes').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).order('name'),
      this.client.from('uniforms').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).order('name'),
      this.client.from('activity_library').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).eq('active',true).order('title')
    ]);
    for(const r of [rooms,groups,categories,requirements,themes,uniforms,library])if(r.error)throw r.error;
    const result={rooms:rooms.data||[],groups:groups.data||[],categories:categories.data||[],requirements:requirements.data||[],themes:themes.data||[],uniforms:uniforms.data||[],activityLibrary:library.data||[]};
    await putCache(offlineKeys.lookup(unitId),result);return result;
  }

  async loadGroupMap(table,eventColumn,eventIds){
    const map=new Map();if(!eventIds.length||this.demoMode)return map;
    const {data,error}=await this.client.from(table).select(`${eventColumn},group_id`).in(eventColumn,eventIds);if(error)throw error;
    for(const row of data||[]){if(!map.has(row[eventColumn]))map.set(row[eventColumn],[]);map.get(row[eventColumn]).push(row.group_id);}return map;
  }

  async getPublicMonth(unitId,year,month,program='combined'){
    if(program==='combined'){
      const [cadet,senior]=await Promise.all([this.getPublicMonth(unitId,year,month,'cadet'),this.getPublicMonth(unitId,year,month,'senior')]);
      return [...cadet,...senior].sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date)||a.program_type.localeCompare(b.program_type));
    }
    const cacheKey=offlineKeys.publicMonth(unitId,year,month,program);
    if(this.demoMode){
      return deepClone(this.demo.schedules.filter(s=>s.unit_id===unitId&&s.year===year&&s.month===month&&s.program_type===program).flatMap(s=>{const v=s.versions.find(x=>x.id===s.current_published_version_id&&x.status==='published');return v?v.meetings.map(m=>({...m,program_type:s.program_type,version_number:v.version_number,published_at:v.published_at,events:m.events||[]})):[];}));
    }
    if(!isOnline()){const cached=await getCache(cacheKey);return cached||[];}
    let q=this.client.from('published_meetings_view').select('*').eq('unit_id',unitId).eq('schedule_year',year).eq('schedule_month',month).eq('program_type',program).order('meeting_date');
    const {data,error}=await q;if(error)throw error;const ids=(data||[]).map(x=>x.meeting_id);let events=[];
    if(ids.length){const res=await this.client.from('published_events_view').select('*').in('meeting_id',ids).order('start_time');if(res.error)throw res.error;events=res.data||[];}
    const eventIds=events.map(e=>e.event_id);const groupMap=await this.loadGroupMap('meeting_event_groups','event_id',eventIds);
    const rows=(data||[]).map(m=>({...m,id:m.meeting_id,events:events.filter(e=>e.meeting_id===m.meeting_id).map(e=>({...e,id:e.event_id,group_ids:groupMap.get(e.event_id)||[]}))}));
    await putCache(cacheKey,rows);return rows;
  }

  draftKey(unitId,program,year,month){return offlineKeys.draft(unitId,program,year,month);}
  makeOfflinePlanning(unit,program,year,month){
    const schedule={id:`offline-s-${unit.id}-${program}-${year}-${month}`,unit_id:unit.id,program_type:program,year,month,meeting_weekday:Number(unit.meeting_weekday??1),current_published_version_id:null};
    const meetings=[];const d=new Date(year,month-1,1);while(d.getMonth()===month-1){if(d.getDay()===schedule.meeting_weekday)meetings.push({id:uid('offline-m'),meeting_date:dateISO(d),theme_id:null,uniform_id:null,title:null,start_time:unit.default_start_time||'18:30',end_time:unit.default_end_time||'21:00',is_cancelled:false,cancel_reason:null,events:[]});d.setDate(d.getDate()+1);}
    return {schedule,version:{id:uid('offline-v'),version_number:0,status:'draft',offline:true,meetings}};
  }

  async getPlanningMonth(unitId,program,year,month){
    if(!this.canEdit(unitId,program))throw new Error('You do not have permission to edit this schedule.');
    const key=this.draftKey(unitId,program,year,month);
    if(this.demoMode){
      let s=this.demo.schedules.find(x=>x.unit_id===unitId&&x.program_type===program&&x.year===year&&x.month===month);if(!s){s={id:uid('s'),unit_id:unitId,program_type:program,year,month,meeting_weekday:this.demo.units.find(u=>u.id===unitId)?.meeting_weekday??1,current_published_version_id:null,versions:[]};this.demo.schedules.push(s);}let draft=s.versions.find(v=>v.status==='draft');if(!draft){const pub=s.versions.find(v=>v.id===s.current_published_version_id);draft=pub?deepClone(pub):{id:uid('v'),version_number:1,status:'draft',meetings:[]};draft.id=uid('v');draft.status='draft';draft.version_number=Math.max(0,...s.versions.map(v=>v.version_number||0))+1;draft.meetings=(draft.meetings||[]).map(m=>({...m,id:uid('m'),events:(m.events||[]).map(e=>({...e,id:uid('e')}))}));s.versions.push(draft);}this.syncDemoMeetings(s,draft);this.persistDemo();return{schedule:deepClone(s),version:deepClone(draft)};
    }
    if(!isOnline()){
      const cached=await getDraft(key);if(cached)return deepClone(cached.value);
      const units=await this.getUnits();const unit=units.find(u=>u.id===unitId);if(!unit)throw new Error('This unit is not available offline.');
      await this.getLookupData(unitId);const planning=this.makeOfflinePlanning(unit,program,year,month);await putDraft(key,planning,false);return planning;
    }
    const {data,error}=await this.client.rpc('get_or_create_schedule_draft',{p_unit_id:unitId,p_program_type:program,p_year:year,p_month:month});if(error)throw error;
    const {error:syncError}=await this.client.rpc('sync_normal_meetings',{p_schedule_version_id:data});if(syncError)throw syncError;
    const planning=await this.fetchDraftVersion(data);await putDraft(key,planning,false);return planning;
  }
  syncDemoMeetings(s,draft){const u=this.demo.units.find(x=>x.id===s.unit_id);if(s.meeting_weekday==null)s.meeting_weekday=u?.meeting_weekday??1;const d=new Date(s.year,s.month-1,1);while(d.getMonth()===s.month-1){if(d.getDay()===Number(s.meeting_weekday)){const iso=dateISO(d);if(!draft.meetings.some(m=>m.meeting_date===iso))draft.meetings.push({id:uid('m'),meeting_date:iso,theme_id:null,uniform_id:null,title:null,start_time:u?.default_start_time||'18:30',end_time:u?.default_end_time||'21:00',is_cancelled:false,cancel_reason:null,events:[]});}d.setDate(d.getDate()+1);}draft.meetings.sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date));}

  async fetchDraftVersion(versionId){
    const {data:v,error:ve}=await this.client.from('schedule_versions').select('*').eq('id',versionId).single();if(ve)throw ve;
    const {data:schedule,error:se}=await this.client.from('schedules').select('*').eq('id',v.schedule_id).single();if(se)throw se;
    const {data:meetings,error:me}=await this.client.from('meetings').select('*').eq('schedule_version_id',versionId).order('meeting_date');if(me)throw me;
    const ids=(meetings||[]).map(m=>m.id);let events=[];if(ids.length){const r=await this.client.from('meeting_events').select('*').in('meeting_id',ids).order('start_time');if(r.error)throw r.error;events=r.data||[];}
    const groupMap=await this.loadGroupMap('meeting_event_groups','event_id',events.map(e=>e.id));
    return {schedule,version:{...v,meetings:(meetings||[]).map(m=>({...m,events:events.filter(e=>e.meeting_id===m.id).map(e=>({...e,group_ids:groupMap.get(e.id)||[]}))}))}};
  }
  async persistPlanningSnapshot(planning,dirty=false){if(!planning?.schedule)return;await putDraft(this.draftKey(planning.schedule.unit_id,planning.schedule.program_type,planning.schedule.year,planning.schedule.month),deepClone(planning),dirty);}

  findDemoVersion(versionId){for(const s of this.demo.schedules){const v=s.versions.find(x=>x.id===versionId);if(v)return{schedule:s,version:v};}throw new Error('Draft version not found.');}
  findDemoMeeting(meetingId){for(const s of this.demo.schedules)for(const v of s.versions){const m=v.meetings.find(x=>x.id===meetingId);if(m)return{schedule:s,version:v,meeting:m};}throw new Error('Meeting not found.');}

  async setScheduleMeetingWeekday(planning,weekday){
    weekday=Number(weekday);if(!Number.isInteger(weekday)||weekday<0||weekday>6)throw new Error('Choose a valid meeting weekday.');
    if(this.demoMode){const f=this.findDemoVersion(planning.version.id);f.schedule.meeting_weekday=weekday;this.applyWeekdayLocally({schedule:f.schedule,version:f.version},weekday);this.persistDemo();return deepClone({schedule:f.schedule,version:f.version});}
    if(!isOnline()||String(planning.version.id).startsWith('offline-')){this.applyWeekdayLocally(planning,weekday);await this.persistPlanningSnapshot(planning,true);return deepClone(planning);}
    const {error}=await this.client.rpc('set_schedule_meeting_weekday',{p_schedule_version_id:planning.version.id,p_weekday:weekday});if(error)throw error;const fresh=await this.fetchDraftVersion(planning.version.id);await this.persistPlanningSnapshot(fresh,false);return fresh;
  }
  applyWeekdayLocally(planning,weekday){
    planning.schedule.meeting_weekday=weekday;const unit=(this.demoMode?this.demo.units:JSON.parse(localStorage.getItem('capSchedule.cachedUnits')||'[]')).find?.(u=>u.id===planning.schedule.unit_id);
    planning.version.meetings=(planning.version.meetings||[]).filter(m=>new Date(`${m.meeting_date}T12:00:00`).getDay()===weekday||(m.events||[]).length||m.theme_id||m.uniform_id||m.title||m.is_cancelled);
    const d=new Date(planning.schedule.year,planning.schedule.month-1,1);while(d.getMonth()===planning.schedule.month-1){if(d.getDay()===weekday){const iso=dateISO(d);if(!planning.version.meetings.some(m=>m.meeting_date===iso))planning.version.meetings.push({id:uid('offline-m'),meeting_date:iso,theme_id:null,uniform_id:null,title:null,start_time:unit?.default_start_time||'18:30',end_time:unit?.default_end_time||'21:00',is_cancelled:false,cancel_reason:null,events:[]});}d.setDate(d.getDate()+1);}planning.version.meetings.sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date));
  }

  async updateMeeting(meetingId,patch,planning){
    if(this.demoMode){const f=this.findDemoMeeting(meetingId);Object.assign(f.meeting,patch);this.persistDemo();return deepClone(f.meeting);}
    if(!isOnline()||String(meetingId).startsWith('offline-')){const m=planning.version.meetings.find(x=>x.id===meetingId);if(!m)throw new Error('Meeting not found in offline draft.');Object.assign(m,patch);await this.persistPlanningSnapshot(planning,true);return deepClone(m);}
    const {data,error}=await this.client.from('meetings').update(patch).eq('id',meetingId).select().single();if(error)throw error;return data;
  }

  async saveEvent(meetingId,event,planning){
    const clean={room_id:event.room_id||null,start_time:event.start_time,end_time:event.end_time,title:event.title,category_id:event.category_id||null,audience:null,instructor_name:event.instructor_name||null,uniform_override_id:event.uniform_override_id||null,description:event.description||null,group_ids:[...(event.group_ids||[])]};
    if(this.demoMode){const f=this.findDemoMeeting(meetingId);let row;if(event.id){row=f.meeting.events.find(x=>x.id===event.id);Object.assign(row,clean);}else{row={id:uid('e'),...clean};f.meeting.events.push(row);}this.persistDemo();return deepClone(row);}
    if(!isOnline()||String(meetingId).startsWith('offline-')||String(event.id||'').startsWith('offline-')){const m=planning.version.meetings.find(x=>x.id===meetingId);if(!m)throw new Error('Meeting not found in offline draft.');let row;if(event.id){row=m.events.find(x=>x.id===event.id);if(row)Object.assign(row,clean);else{row={id:event.id,...clean};m.events.push(row);}}else{row={id:uid('offline-e'),...clean};m.events.push(row);}await this.persistPlanningSnapshot(planning,true);return deepClone(row);}
    let row;const {group_ids,...payload}=clean;if(event.id){const {data,error}=await this.client.from('meeting_events').update(payload).eq('id',event.id).select().single();if(error)throw error;row=data;}else{const {data,error}=await this.client.from('meeting_events').insert({meeting_id:meetingId,...payload}).select().single();if(error)throw error;row=data;}
    const {error:de}=await this.client.from('meeting_event_groups').delete().eq('event_id',row.id);if(de)throw de;
    if(clean.group_ids.length){const {error:ie}=await this.client.from('meeting_event_groups').insert(clean.group_ids.map(group_id=>({event_id:row.id,group_id})));if(ie)throw ie;}
    return {...row,group_ids:clean.group_ids};
  }
  async deleteEvent(eventId,planning){
    if(this.demoMode){for(const s of this.demo.schedules)for(const v of s.versions)for(const m of v.meetings){const i=m.events.findIndex(e=>e.id===eventId);if(i>=0){m.events.splice(i,1);this.persistDemo();return;}}return;}
    if(!isOnline()||String(eventId).startsWith('offline-')){for(const m of planning.version.meetings){const i=(m.events||[]).findIndex(e=>e.id===eventId);if(i>=0)m.events.splice(i,1);}await this.persistPlanningSnapshot(planning,true);return;}
    const {error}=await this.client.from('meeting_events').delete().eq('id',eventId);if(error)throw error;
  }

  async copyMeeting(sourceMeetingId,targetDate,planning){
    if(this.demoMode){const src=this.findDemoMeeting(sourceMeetingId);const c=deepClone(src.meeting);c.id=uid('m');c.meeting_date=targetDate;c.events=c.events.map(e=>({...e,id:uid('e')}));src.version.meetings.push(c);this.persistDemo();return deepClone(c);}
    if(!isOnline()||String(sourceMeetingId).startsWith('offline-')){const src=planning.version.meetings.find(m=>m.id===sourceMeetingId);if(!src)throw new Error('Meeting not found.');const c=deepClone(src);c.id=uid('offline-m');c.meeting_date=targetDate;c.events=(c.events||[]).map(e=>({...e,id:uid('offline-e')}));planning.version.meetings.push(c);planning.version.meetings.sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date));await this.persistPlanningSnapshot(planning,true);return c;}
    const {data,error}=await this.client.rpc('copy_meeting',{p_source_meeting_id:sourceMeetingId,p_target_date:targetDate});if(error)throw error;return data;
  }
  async copyMonth(targetVersionId,sourceYear,sourceMonth){if(!isOnline())throw new Error('Reconnect before using Copy Month. Individual offline editing is supported, but copying another month requires the server.');const {error}=await this.client.rpc('copy_month_into_draft',{p_target_version_id:targetVersionId,p_source_year:sourceYear,p_source_month:sourceMonth});if(error)throw error;return(await this.fetchDraftVersion(targetVersionId)).version;}
  async publishVersion(versionId){if(!isOnline())throw new Error('Reconnect before publishing. Offline edits are saved on this device and can be synchronized first.');if(this.demoMode){const f=this.findDemoVersion(versionId);f.schedule.versions.forEach(v=>{if(v.status==='published')v.status='archived';});f.version.status='published';f.version.published_at=new Date().toISOString();f.schedule.current_published_version_id=f.version.id;this.persistDemo();return;}const {error}=await this.client.rpc('publish_schedule_version',{p_version_id:versionId});if(error)throw error;}

  async getMeetingTemplates(unitId,program){if(this.demoMode)return deepClone((this.demo.meetingTemplates||[]).filter(t=>t.unit_id===unitId&&t.program_type===program));if(!isOnline())throw new Error('Meeting templates require a connection.');const {data,error}=await this.client.from('meeting_templates').select('*,meeting_template_events(*)').eq('unit_id',unitId).eq('program_type',program).eq('active',true).order('name');if(error)throw error;const events=(data||[]).flatMap(t=>t.meeting_template_events||[]);const gm=await this.loadGroupMap('meeting_template_event_groups','template_event_id',events.map(e=>e.id));return(data||[]).map(t=>({...t,meeting_template_events:(t.meeting_template_events||[]).map(e=>({...e,group_ids:gm.get(e.id)||[]}))}));}
  async saveMeetingAsTemplate(meetingId,name){if(!isOnline())throw new Error('Reconnect before saving a meeting template.');if(this.demoMode){const f=this.findDemoMeeting(meetingId);const t={id:uid('tpl'),unit_id:f.schedule.unit_id,program_type:f.schedule.program_type,name,theme_id:f.meeting.theme_id,uniform_id:f.meeting.uniform_id,start_time:f.meeting.start_time,end_time:f.meeting.end_time,active:true,events:(f.meeting.events||[]).map(e=>({...deepClone(e),id:uid('te')}))};this.demo.meetingTemplates.push(t);this.persistDemo();return t;}const {data,error}=await this.client.rpc('save_meeting_as_template',{p_meeting_id:meetingId,p_name:name});if(error)throw error;return data;}
  async applyMeetingTemplate(meetingId,templateId){if(!isOnline())throw new Error('Reconnect before applying a meeting template.');if(this.demoMode)return;const {error}=await this.client.rpc('apply_meeting_template',{p_meeting_id:meetingId,p_template_id:templateId});if(error)throw error;}

  async getSpecialActivities(unitId='all',range='upcoming',includeDraft=false){
    if(this.demoMode){let rows=deepClone(this.demo.specialActivities.filter(x=>includeDraft||x.status==='published'));if(unitId!=='all')rows=rows.filter(x=>x.unit_id===unitId);return rows.sort((a,b)=>a.starts_at.localeCompare(b.starts_at));}
    if(!isOnline()){let rows=await getCache(offlineKeys.specialActivities)||[];if(includeDraft){const dirty=await getDirtyDrafts();for(const item of dirty.filter(x=>x.key.startsWith('special:'))){const a=item.value?.activity;if(a&&!rows.some(x=>x.id===a.id))rows.push(deepClone(a));else if(a){const i=rows.findIndex(x=>x.id===a.id);rows[i]=deepClone(a);}}}if(unitId!=='all')rows=rows.filter(x=>x.unit_id===unitId);return rows.sort((a,b)=>String(a.starts_at).localeCompare(String(b.starts_at)));}
    let q=this.client.from('special_activities').select('*,units(name,charter_number)').order('starts_at');if(!includeDraft)q=q.eq('status','published');if(unitId!=='all')q=q.eq('unit_id',unitId);const {data,error}=await q;if(error)throw error;if(!includeDraft)await putCache(offlineKeys.specialActivities,data||[]);return data||[];
  }
  async saveSpecialActivity(activity){
    if(!this.canEditAnyAtUnit(activity.unit_id))throw new Error('You do not have edit permission for this unit.');
    const start=new Date(activity.starts_at),end=new Date(activity.ends_at);if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime()))throw new Error('Enter a valid start and end date/time.');if(end<=start)throw new Error('The special activity end time must be after the start time.');
    const clean={unit_id:activity.unit_id,title:activity.title,audience:null,starts_at:start.toISOString(),ends_at:end.toISOString(),location:activity.location||null,description:activity.description||null,status:activity.status||'draft'};
    if(this.demoMode){let row;if(activity.id){row=this.demo.specialActivities.find(x=>x.id===activity.id);Object.assign(row,clean);}else{row={id:uid('sp'),...clean,rooms:[],events:[]};this.demo.specialActivities.push(row);}this.persistDemo();return deepClone(row);}
    if(!isOnline()){
      const id=activity.id||uid('offline-sp');const detail={activity:{id,...clean},rooms:[],events:[]};await putDraft(`special:${id}`,detail,true);return detail.activity;
    }
    const r=activity.id?await this.client.from('special_activities').update(clean).eq('id',activity.id).select('*,units(name,charter_number)').single():await this.client.from('special_activities').insert(clean).select('*,units(name,charter_number)').single();if(r.error)throw r.error;return r.data;
  }
  async getSpecialActivityDetail(activityId){
    if(this.demoMode){const a=this.demo.specialActivities.find(x=>x.id===activityId);if(!a)throw new Error('Activity not found.');return deepClone({activity:a,rooms:a.rooms||[],events:a.events||[]});}
    const dirty=await getDraft(`special:${activityId}`);if(!isOnline()&&dirty)return dirty.value;
    if(!isOnline()){const cached=await getCache(offlineKeys.specialDetail(activityId));if(cached)return cached;throw new Error('This activity detail has not been cached for offline use.');}
    const {data:activity,error:ae}=await this.client.from('special_activities').select('*,units(name,charter_number)').eq('id',activityId).single();if(ae)throw ae;
    const [{data:rooms,error:re},{data:events,error:ee}]=await Promise.all([
      this.client.from('special_activity_rooms').select('*').eq('activity_id',activityId).order('sort_order'),
      this.client.from('special_activity_events').select('*').eq('activity_id',activityId).order('starts_at')
    ]);if(re)throw re;if(ee)throw ee;
    const gm=await this.loadGroupMap('special_activity_event_groups','event_id',(events||[]).map(e=>e.id));const detail={activity,rooms:rooms||[],events:(events||[]).map(e=>({...e,group_ids:gm.get(e.id)||[]}))};
    await putCache(offlineKeys.specialDetail(activityId),detail);return detail;
  }
  async persistSpecialDetail(detail,dirty=false){const key=`special:${detail.activity.id}`;await putDraft(key,deepClone(detail),dirty);if(!dirty&&detail.activity.status==='published')await putCache(offlineKeys.specialDetail(detail.activity.id),deepClone(detail));}
  async saveSpecialRoom(detail,room){
    if(this.demoMode){let r;if(room.id){r=detail.rooms.find(x=>x.id===room.id);Object.assign(r,room);}else{r={id:uid('spr'),...room};detail.rooms.push(r);}const a=this.demo.specialActivities.find(x=>x.id===detail.activity.id);if(a)a.rooms=deepClone(detail.rooms);this.persistDemo();return deepClone(r);}
    if(!isOnline()||String(detail.activity.id).startsWith('offline-')){let r;if(room.id){r=detail.rooms.find(x=>x.id===room.id);Object.assign(r,room);}else{r={id:uid('offline-spr'),...room};detail.rooms.push(r);}await this.persistSpecialDetail(detail,true);return deepClone(r);}
    const payload={activity_id:detail.activity.id,name:room.name,sort_order:Number(room.sort_order||100),active:room.active!==false};const r=room.id?await this.client.from('special_activity_rooms').update(payload).eq('id',room.id).select().single():await this.client.from('special_activity_rooms').insert(payload).select().single();if(r.error)throw r.error;return r.data;
  }
  async saveSpecialEvent(detail,event){
    const clean={activity_id:detail.activity.id,room_id:event.room_id||null,starts_at:new Date(event.starts_at).toISOString(),ends_at:new Date(event.ends_at).toISOString(),title:event.title,category_id:event.category_id||null,instructor_name:event.instructor_name||null,uniform_override_id:event.uniform_override_id||null,description:event.description||null,sort_order:event.sort_order||100,group_ids:[...(event.group_ids||[])]};
    if(new Date(clean.ends_at)<=new Date(clean.starts_at))throw new Error('End time must be after start time.');
    if(this.demoMode||!isOnline()||String(detail.activity.id).startsWith('offline-')){let row;if(event.id){row=detail.events.find(x=>x.id===event.id);Object.assign(row,clean);}else{row={id:uid('offline-spe'),...clean};detail.events.push(row);}if(this.demoMode){const a=this.demo.specialActivities.find(x=>x.id===detail.activity.id);if(a)a.events=deepClone(detail.events);this.persistDemo();}await this.persistSpecialDetail(detail,!this.demoMode);return deepClone(row);}
    let row;if(event.id){const {group_ids,...payload}=clean;const r=await this.client.from('special_activity_events').update(payload).eq('id',event.id).select().single();if(r.error)throw r.error;row=r.data;}else{const {group_ids,...payload}=clean;const r=await this.client.from('special_activity_events').insert(payload).select().single();if(r.error)throw r.error;row=r.data;}
    const {error:de}=await this.client.from('special_activity_event_groups').delete().eq('event_id',row.id);if(de)throw de;if(clean.group_ids.length){const {error:ie}=await this.client.from('special_activity_event_groups').insert(clean.group_ids.map(group_id=>({event_id:row.id,group_id})));if(ie)throw ie;}return{...row,group_ids:clean.group_ids};
  }
  async deleteSpecialEvent(detail,eventId){if(this.demoMode||!isOnline()||String(eventId).startsWith('offline-')){detail.events=detail.events.filter(e=>e.id!==eventId);if(this.demoMode){const a=this.demo.specialActivities.find(x=>x.id===detail.activity.id);if(a)a.events=deepClone(detail.events);this.persistDemo();}await this.persistSpecialDetail(detail,!this.demoMode);return;}const {error}=await this.client.from('special_activity_events').delete().eq('id',eventId);if(error)throw error;}

  async syncOfflineDrafts(){
    if(this.demoMode||!isOnline()||!this.userContext)return {synced:0,failed:0};
    if(!this.client)await this.reconnect();
    const dirty=await getDirtyDrafts();let synced=0,failed=0;
    for(const item of dirty){
      try{
        if(item.key.startsWith('draft:')){
          const p=item.value;const payload={meeting_weekday:p.schedule.meeting_weekday,meetings:(p.version.meetings||[]).map(m=>({meeting_date:m.meeting_date,theme_id:m.theme_id||null,uniform_id:m.uniform_id||null,title:m.title||null,start_time:m.start_time,end_time:m.end_time,is_cancelled:Boolean(m.is_cancelled),cancel_reason:m.cancel_reason||null,events:(m.events||[]).map(e=>({room_id:e.room_id||null,start_time:e.start_time,end_time:e.end_time,title:e.title,category_id:e.category_id||null,instructor_name:e.instructor_name||null,uniform_override_id:e.uniform_override_id||null,description:e.description||null,sort_order:e.sort_order||100,group_ids:e.group_ids||[]}))}))};
          const {data,error}=await this.client.rpc('replace_schedule_draft_from_json',{p_unit_id:p.schedule.unit_id,p_program_type:p.schedule.program_type,p_year:p.schedule.year,p_month:p.schedule.month,p_payload:payload});if(error)throw error;const fresh=await this.fetchDraftVersion(data);await markDraftClean(item.key,fresh);synced++;
        } else if(item.key.startsWith('special:')){
          const d=item.value;const activityId=String(d.activity.id).startsWith('offline-')?null:d.activity.id;const payload={...d.activity,id:undefined,rooms:(d.rooms||[]).map(r=>({name:r.name,sort_order:r.sort_order||100,active:r.active!==false})),events:(d.events||[]).map(e=>({room_name:(d.rooms||[]).find(r=>r.id===e.room_id)?.name||null,starts_at:e.starts_at,ends_at:e.ends_at,title:e.title,category_id:e.category_id||null,instructor_name:e.instructor_name||null,uniform_override_id:e.uniform_override_id||null,description:e.description||null,sort_order:e.sort_order||100,group_ids:e.group_ids||[]}))};
          const {data,error}=await this.client.rpc('replace_special_activity_from_json',{p_activity_id:activityId,p_payload:payload});if(error)throw error;const fresh=await this.getSpecialActivityDetail(data);await markDraftClean(item.key,fresh);synced++;
        }
      }catch(err){console.error('Offline sync failed',item.key,err);failed++;}
    }
    return {synced,failed};
  }

  async refreshOfflinePublicCache(){
    if(this.demoMode||!isOnline())return;
    if(!this.client)await this.reconnect();
    try{
      const units=await this.getUnits();
      const since=new Date();since.setHours(0,0,0,0);since.setDate(1);since.setMonth(since.getMonth()-3);
      const {data:meetings,error:me}=await this.client.from('published_meetings_view').select('*').gte('meeting_date',dateISO(since)).order('meeting_date');if(me)throw me;
      const meetingIds=(meetings||[]).map(m=>m.meeting_id);let events=[];
      for(let i=0;i<meetingIds.length;i+=500){const ids=meetingIds.slice(i,i+500);if(!ids.length)continue;const r=await this.client.from('published_events_view').select('*').in('meeting_id',ids).order('start_time');if(r.error)throw r.error;events.push(...(r.data||[]));}
      const gm=await this.loadGroupMap('meeting_event_groups','event_id',events.map(e=>e.event_id));
      for(const u of units){await this.getLookupData(u.id);const unitMeetings=(meetings||[]).filter(m=>m.unit_id===u.id);const keys=new Set(unitMeetings.map(m=>`${m.schedule_year}:${m.schedule_month}:${m.program_type}`));for(const k of keys){const [y,mo,program]=k.split(':');const rows=unitMeetings.filter(m=>String(m.schedule_year)===y&&String(m.schedule_month)===mo&&m.program_type===program).map(m=>({...m,id:m.meeting_id,events:events.filter(e=>e.meeting_id===m.meeting_id).map(e=>({...e,id:e.event_id,group_ids:gm.get(e.event_id)||[]}))}));await putCache(offlineKeys.publicMonth(u.id,Number(y),Number(mo),program),rows);}}
      const {data:special,error:se}=await this.client.from('special_activities').select('*,units(name,charter_number)').eq('status','published').gte('ends_at',since.toISOString()).order('starts_at');if(se)throw se;await putCache(offlineKeys.specialActivities,special||[]);
      for(const a of special||[]){try{await this.getSpecialActivityDetail(a.id);}catch(err){console.warn('Could not cache special activity detail',a.id,err);}}
    }catch(err){console.warn('Offline cache refresh failed',err);}
  }

  async getOfflineWorkStatus(){
    const dirty=await getDirtyDrafts();
    return {dirtyCount:dirty.length,online:this.online()};
  }

  async adminSaveUnit(unit){if(this.demoMode){let row;if(unit.id){row=this.demo.units.find(x=>x.id===unit.id);Object.assign(row,unit);}else{row={id:uid('u'),active:true,...unit};this.demo.units.push(row);}this.persistDemo();return deepClone(row);}const payload={charter_number:unit.charter_number,name:unit.name,city:unit.city||null,state:unit.state||'MT',meeting_weekday:Number(unit.meeting_weekday),default_start_time:unit.default_start_time,default_end_time:unit.default_end_time,active:unit.active!==false};const r=unit.id?await this.client.from('units').update(payload).eq('id',unit.id).select().single():await this.client.from('units').insert(payload).select().single();if(r.error)throw r.error;return r.data;}
  async adminListRooms(unitId){if(this.demoMode)return deepClone(this.demo.rooms.filter(r=>r.unit_id===unitId).sort((a,b)=>a.sort_order-b.sort_order));const {data,error}=await this.client.from('rooms').select('*').eq('unit_id',unitId).order('sort_order');if(error)throw error;return data||[];}
  async adminSaveRoom(room){if(this.demoMode){let row;if(room.id){row=this.demo.rooms.find(x=>x.id===room.id);Object.assign(row,room);}else{row={id:uid('r'),active:true,...room};this.demo.rooms.push(row);}this.persistDemo();return deepClone(row);}const payload={unit_id:room.unit_id,name:room.name,sort_order:Number(room.sort_order||100),active:room.active!==false};const r=room.id?await this.client.from('rooms').update(payload).eq('id',room.id).select().single():await this.client.from('rooms').insert(payload).select().single();if(r.error)throw r.error;return r.data;}
  async adminListGroups(unitId){if(this.demoMode)return deepClone((this.demo.groups||[]).filter(g=>g.unit_id===unitId).sort((a,b)=>a.sort_order-b.sort_order));const {data,error}=await this.client.from('schedule_groups').select('*').eq('unit_id',unitId).order('sort_order');if(error)throw error;return data||[];}
  async adminSaveGroup(group){if(this.demoMode){this.demo.groups=this.demo.groups||[];let row;if(group.id){row=this.demo.groups.find(x=>x.id===group.id);Object.assign(row,group);}else{row={id:uid('g'),active:true,...group};this.demo.groups.push(row);}this.persistDemo();return deepClone(row);}const payload={unit_id:group.unit_id,name:group.name,color:group.color,sort_order:Number(group.sort_order||100),active:group.active!==false};const r=group.id?await this.client.from('schedule_groups').update(payload).eq('id',group.id).select().single():await this.client.from('schedule_groups').insert(payload).select().single();if(r.error)throw r.error;return r.data;}
  async adminListUsers(unitId){if(this.demoMode)return[{id:'demo-user',email:'admin@example.org',display_name:'Demo Administrator',is_app_admin:true,permissions:this.userContext?.permissions||[]}];if(!this.client)await this.reconnect();const token=(await this.client.auth.getSession()).data.session?.access_token;const res=await fetch(`${cfg.supabaseUrl}/functions/v1/admin-users?unit_id=${encodeURIComponent(unitId||'')}`,{headers:{Authorization:`Bearer ${token}`,apikey:cfg.supabaseAnonKey}});const body=await res.json();if(!res.ok)throw new Error(body.error||'Unable to load users.');return body.users||[];}
  async adminUpsertUser(payload){if(this.demoMode)return{ok:true};if(!this.client)await this.reconnect();const token=(await this.client.auth.getSession()).data.session?.access_token;const res=await fetch(`${cfg.supabaseUrl}/functions/v1/admin-users`,{method:'POST',headers:{Authorization:`Bearer ${token}`,apikey:cfg.supabaseAnonKey,'Content-Type':'application/json'},body:JSON.stringify({...payload,action:'save'})});const body=await res.json();if(!res.ok)throw new Error(body.error||'Unable to save user.');return body;}
  async adminUpdateRequirement(id,patch){if(!this.userContext?.isAppAdmin)throw new Error('App Administrator permission required.');if(this.demoMode){const r=this.demo.requirements.find(x=>x.id===id);Object.assign(r,patch);this.persistDemo();return r;}const {data,error}=await this.client.from('training_requirements').update(patch).eq('id',id).select().single();if(error)throw error;return data;}
  async adminSaveTheme(theme){if(!this.userContext?.isAppAdmin)throw new Error('App Administrator permission required.');if(this.demoMode){let r;if(theme.id){r=this.demo.themes.find(x=>x.id===theme.id);Object.assign(r,theme);}else{r={id:uid('t'),active:true,...theme};this.demo.themes.push(r);}this.persistDemo();return r;}const payload={unit_id:theme.unit_id||null,name:theme.name,active:theme.active!==false};const r=theme.id?await this.client.from('meeting_themes').update(payload).eq('id',theme.id).select().single():await this.client.from('meeting_themes').insert(payload).select().single();if(r.error)throw r.error;return r.data;}
  async adminSaveUniform(uniform){if(this.demoMode){let r;if(uniform.id){r=this.demo.uniforms.find(x=>x.id===uniform.id);Object.assign(r,uniform);}else{r={id:uid('uod'),active:true,...uniform};this.demo.uniforms.push(r);}this.persistDemo();return deepClone(r);}const payload={unit_id:uniform.unit_id||null,name:uniform.name,active:uniform.active!==false};const r=uniform.id?await this.client.from('uniforms').update(payload).eq('id',uniform.id).select().single():await this.client.from('uniforms').insert(payload).select().single();if(r.error)throw r.error;return r.data;}
  async adminSaveLibraryActivity(item){if(!this.userContext?.isAppAdmin)throw new Error('App Administrator permission required.');if(this.demoMode){let r;if(item.id){r=this.demo.activityLibrary.find(x=>x.id===item.id);Object.assign(r,item);}else{r={id:uid('a'),default_duration_minutes:null,active:true,...item};this.demo.activityLibrary.push(r);}this.persistDemo();return r;}const payload={scope:item.scope||'statewide',unit_id:item.scope==='unit'?item.unit_id:null,title:item.title,default_duration_minutes:null,category_id:item.category_id||null,description:item.description||null,active:item.active!==false};const r=item.id?await this.client.from('activity_library').update(payload).eq('id',item.id).select().single():await this.client.from('activity_library').insert(payload).select().single();if(r.error)throw r.error;return r.data;}
  async adminGetSettings(unitId){const base=await this.getLookupData(unitId);if(this.demoMode)return {...base,themes:deepClone(this.demo.themes.filter(x=>!x.unit_id||x.unit_id===unitId)),uniforms:deepClone(this.demo.uniforms.filter(x=>!x.unit_id||x.unit_id===unitId)),activityLibrary:deepClone(this.demo.activityLibrary.filter(x=>x.scope==='statewide'||x.unit_id===unitId))};const [themes,uniforms,library]=await Promise.all([this.client.from('meeting_themes').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).order('name'),this.client.from('uniforms').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).order('name'),this.client.from('activity_library').select('*').or(`unit_id.is.null,unit_id.eq.${unitId}`).order('title')]);for(const r of [themes,uniforms,library])if(r.error)throw r.error;return{...base,themes:themes.data||[],uniforms:uniforms.data||[],activityLibrary:library.data||[]};}
  async adminGetContactHours(unitId=null){if(!this.userContext)throw new Error('Login required.');if(!this.userContext.isAppAdmin&&!unitId)throw new Error('Select one of your Unit Administrator units.');if(unitId&&!this.isUnitAdmin(unitId))throw new Error('Unit Administrator permission required.');if(this.demoMode)return[];const {data,error}=await this.client.rpc('get_contact_hour_compliance',{p_unit_id:unitId||null});if(error)throw error;return data||[];}
}
