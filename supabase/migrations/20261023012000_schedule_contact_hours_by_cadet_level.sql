create or replace function public.get_contact_hour_compliance(p_unit_id uuid default null::uuid)
returns table(
  schedule_id uuid,
  unit_id uuid,
  unit_name text,
  program_type schedule_program,
  year integer,
  month integer,
  published_at timestamptz,
  requirements jsonb,
  met boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_unit_id is null then
    if not public.is_app_admin() then
      raise exception 'App Administrator permission required to view all units';
    end if;
  elsif not (public.is_app_admin() or public.is_unit_admin(p_unit_id)) then
    raise exception 'Unit Administrator permission required';
  end if;

  return query
  with pub as (
    select
      s.id as schedule_id,
      s.unit_id,
      u.name as unit_name,
      u.charter_number,
      s.program_type,
      s.year,
      s.month,
      v.id as version_id,
      v.published_at
    from public.schedules s
    join public.units u on u.id=s.unit_id
    join public.schedule_versions v
      on v.id=s.current_published_version_id
     and v.status='published'
    where p_unit_id is null or s.unit_id=p_unit_id
  ),
  req_ranked as (
    select
      p.schedule_id,p.version_id,p.program_type,
      r.id as requirement_id,r.name,r.category_id,r.minimum_minutes,
      r.occurrence_required,r.sort_order,
      row_number() over(
        partition by p.schedule_id,r.name
        order by (r.unit_id is not null) desc,r.created_at desc
      ) as rn
    from pub p
    join public.training_requirements r
      on r.program_type=p.program_type
     and (r.unit_id is null or r.unit_id=p.unit_id)
    where (r.effective_start is null or r.effective_start<=make_date(p.year,p.month,1))
      and (r.effective_end is null or r.effective_end>=make_date(p.year,p.month,1))
  ),
  req as (
    select rr.* from req_ranked rr where rr.rn=1
  ),
  requirement_lanes as (
    select r.*,lane.kind as audience_kind
    from req r
    cross join lateral (
      select unnest(
        case
          when r.program_type::text='cadet' then array['airmen','nco','officer']::text[]
          else array['all']::text[]
        end
      ) as kind
    ) lane
  ),
  lane_eval as (
    select
      rl.schedule_id,rl.requirement_id,rl.name,rl.category_id,
      rl.minimum_minutes,rl.occurrence_required,rl.sort_order,rl.audience_kind,
      (
        count(distinct (m.id,slot))
        filter (where e.id is not null and slot is not null)
      )::integer * 5 as scheduled_minutes,
      count(distinct e.id)::integer as occurrences
    from requirement_lanes rl
    left join public.meetings m
      on m.schedule_version_id=rl.version_id
     and not m.is_cancelled
    left join public.meeting_events e
      on e.meeting_id=m.id
     and e.category_id=rl.category_id
     and (
       rl.audience_kind='all'
       or not exists(
         select 1 from public.meeting_event_groups meg where meg.event_id=e.id
       )
       or exists(
         select 1
         from public.meeting_event_groups meg
         join public.schedule_groups g on g.id=meg.group_id
         where meg.event_id=e.id
           and (
             regexp_replace(lower(g.name),'[^a-z0-9]+','','g') in ('allcadets','allcadet')
             or (
               rl.audience_kind='airmen'
               and (
                 regexp_replace(lower(g.name),'[^a-z0-9]+','','g') in ('airmen','airman')
                 or regexp_replace(lower(g.name),'[^a-z0-9]+','','g') like '%airmen%'
               )
             )
             or (
               rl.audience_kind='nco'
               and (
                 regexp_replace(lower(g.name),'[^a-z0-9]+','','g') in ('nco','ncos')
                 or regexp_replace(lower(g.name),'[^a-z0-9]+','','g') like '%noncommissioned%'
               )
             )
             or (
               rl.audience_kind='officer'
               and (
                 regexp_replace(lower(g.name),'[^a-z0-9]+','','g') in ('officer','officers')
                 or regexp_replace(lower(g.name),'[^a-z0-9]+','','g') like '%cadetofficer%'
               )
             )
           )
       )
     )
    left join lateral generate_series(
      floor(extract(epoch from e.start_time)/300)::integer,
      ceil(extract(epoch from e.end_time)/300)::integer - 1
    ) as slot on e.id is not null
    group by
      rl.schedule_id,rl.requirement_id,rl.name,rl.category_id,
      rl.minimum_minutes,rl.occurrence_required,rl.sort_order,rl.audience_kind
  ),
  eval as (
    select
      le.schedule_id,le.requirement_id,le.name,le.category_id,
      le.minimum_minutes,le.occurrence_required,le.sort_order,
      coalesce(min(le.scheduled_minutes),0)::integer as scheduled_minutes,
      coalesce(min(le.occurrences),0)::integer as occurrences
    from lane_eval le
    group by
      le.schedule_id,le.requirement_id,le.name,le.category_id,
      le.minimum_minutes,le.occurrence_required,le.sort_order
  ),
  packed as (
    select
      e.schedule_id,
      jsonb_agg(
        jsonb_build_object(
          'id',e.requirement_id,
          'name',e.name,
          'minimum_minutes',e.minimum_minutes,
          'occurrence_required',e.occurrence_required,
          'scheduled_minutes',e.scheduled_minutes,
          'occurrences',e.occurrences,
          'met',case
            when e.occurrence_required then e.occurrences>0
            else e.scheduled_minutes>=coalesce(e.minimum_minutes,0)
          end
        )
        order by e.sort_order,e.name
      ) as requirements,
      bool_and(
        case
          when e.occurrence_required then e.occurrences>0
          else e.scheduled_minutes>=coalesce(e.minimum_minutes,0)
        end
      ) as met
    from eval e
    group by e.schedule_id
  )
  select
    p.schedule_id,p.unit_id,p.unit_name,p.program_type,p.year,p.month,p.published_at,
    coalesce(pk.requirements,'[]'::jsonb),coalesce(pk.met,true)
  from pub p
  left join packed pk on pk.schedule_id=p.schedule_id
  order by p.year desc,p.month desc,p.charter_number,p.program_type;
end
$function$;
