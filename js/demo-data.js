export const DEMO_IDS = {
  unit1: '11111111-1111-4111-8111-111111111111',
  unit2: '22222222-2222-4222-8222-222222222222'
};

const pad = n => String(n).padStart(2,'0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export function buildDemoState() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const mondays = [];
  const cursor = new Date(year, month, 1);
  while (cursor.getMonth() === month) {
    if (cursor.getDay() === 1) mondays.push(isoDate(cursor));
    cursor.setDate(cursor.getDate()+1);
  }
  const date1 = mondays[0] || isoDate(new Date(year,month,1));
  const date2 = mondays[1] || date1;
  const date3 = mondays[2] || date2;
  const date4 = mondays[3] || date3;
  const monthKey = `${year}-${pad(month+1)}`;
  return {
    units: [
      {id:DEMO_IDS.unit1,charter_number:'MT-001',name:'Example Composite Squadron',city:'Example City',state:'MT',meeting_weekday:1,default_start_time:'18:30',default_end_time:'21:00',active:true},
      {id:DEMO_IDS.unit2,charter_number:'MT-002',name:'River Valley Composite Squadron',city:'River Valley',state:'MT',meeting_weekday:2,default_start_time:'18:30',default_end_time:'21:00',active:true}
    ],
    rooms: [
      {id:'r1',unit_id:DEMO_IDS.unit1,name:'Main Classroom',sort_order:1,active:true},
      {id:'r2',unit_id:DEMO_IDS.unit1,name:'Classroom 2',sort_order:2,active:true},
      {id:'r3',unit_id:DEMO_IDS.unit1,name:'Drill Floor',sort_order:3,active:true},
      {id:'r4',unit_id:DEMO_IDS.unit2,name:'Training Room',sort_order:1,active:true},
      {id:'r5',unit_id:DEMO_IDS.unit2,name:'Hangar',sort_order:2,active:true}
    ],
    categories: [
      {id:'c-lead',name:'Leadership',requirement_key:'leadership'},
      {id:'c-aero',name:'Aerospace',requirement_key:'aerospace'},
      {id:'c-fit',name:'Fitness',requirement_key:'fitness'},
      {id:'c-char',name:'Character',requirement_key:'character'},
      {id:'c-safe',name:'Safety',requirement_key:'safety'},
      {id:'c-es',name:'Emergency Services',requirement_key:null},
      {id:'c-admin',name:'Administration',requirement_key:null},
      {id:'c-none',name:'Other',requirement_key:null}
    ],
    requirements: [
      {id:'q1',program_type:'cadet',category_id:'c-lead',name:'Leadership',minimum_minutes:90,occurrence_required:false},
      {id:'q2',program_type:'cadet',category_id:'c-aero',name:'Aerospace',minimum_minutes:90,occurrence_required:false},
      {id:'q3',program_type:'cadet',category_id:'c-fit',name:'Fitness',minimum_minutes:45,occurrence_required:false},
      {id:'q4',program_type:'cadet',category_id:'c-char',name:'Character',minimum_minutes:45,occurrence_required:false},
      {id:'q5',program_type:'cadet',category_id:'c-safe',name:'Safety',minimum_minutes:null,occurrence_required:true}
    ],
    themes: [
      {id:'t-lead',unit_id:null,name:'Leadership / Character'},
      {id:'t-fit',unit_id:null,name:'Fitness'},
      {id:'t-aero',unit_id:null,name:'Aerospace'},
      {id:'t-es',unit_id:null,name:'Emergency Services'},
      {id:'t-holiday',unit_id:null,name:'Holiday / No Meeting'},
      {id:'t-general',unit_id:null,name:'General Meeting'}
    ],
    uniforms: [
      {id:'u-ocp',unit_id:null,name:'OCP'},
      {id:'u-blues',unit_id:null,name:'Blues'},
      {id:'u-pt',unit_id:null,name:'PT Gear'},
      {id:'u-civ',unit_id:null,name:'Civilian Attire'}
    ],
    meetingTemplates: [],
    activityLibrary: [
      {id:'a1',scope:'statewide',unit_id:null,title:'Opening Formation',default_duration_minutes:15,category_id:'c-lead',default_audience:'All Members'},
      {id:'a2',scope:'statewide',unit_id:null,title:'Opening Formation / Uniform Inspections',default_duration_minutes:15,category_id:'c-lead',default_audience:'All Cadets'},
      {id:'a3',scope:'statewide',unit_id:null,title:'Drill / Drill Testing',default_duration_minutes:15,category_id:'c-lead',default_audience:'Cadets'},
      {id:'a4',scope:'statewide',unit_id:null,title:'Leadership for Airmen',default_duration_minutes:45,category_id:'c-lead',default_audience:'Cadet Airmen'},
      {id:'a5',scope:'statewide',unit_id:null,title:"Leadership for NCO's",default_duration_minutes:45,category_id:'c-lead',default_audience:'Cadet NCOs'},
      {id:'a6',scope:'statewide',unit_id:null,title:'Leadership for Company Grade Officers',default_duration_minutes:45,category_id:'c-lead',default_audience:'Cadet Officers'},
      {id:'a7',scope:'statewide',unit_id:null,title:'Aerospace Lesson',default_duration_minutes:45,category_id:'c-aero',default_audience:'Cadets'},
      {id:'a8',scope:'statewide',unit_id:null,title:'Aerospace Activity',default_duration_minutes:45,category_id:'c-aero',default_audience:'Cadets'},
      {id:'a9',scope:'statewide',unit_id:null,title:'Aerospace Current Events',default_duration_minutes:20,category_id:'c-aero',default_audience:'Cadets'},
      {id:'a10',scope:'statewide',unit_id:null,title:'Safety',default_duration_minutes:15,category_id:'c-safe',default_audience:'All Members'},
      {id:'a11',scope:'statewide',unit_id:null,title:'Character Development Module',default_duration_minutes:45,category_id:'c-char',default_audience:'Cadets'},
      {id:'a12',scope:'statewide',unit_id:null,title:'CyberPatriot',default_duration_minutes:60,category_id:'c-aero',default_audience:'Cyber Team'},
      {id:'a13',scope:'statewide',unit_id:null,title:'Emergency Services',default_duration_minutes:45,category_id:'c-es',default_audience:'All Members'},
      {id:'a14',scope:'statewide',unit_id:null,title:'Topo Maps',default_duration_minutes:45,category_id:'c-es',default_audience:'Ground Team'},
      {id:'a15',scope:'statewide',unit_id:null,title:'Color Guard',default_duration_minutes:45,category_id:'c-lead',default_audience:'Color Guard'},
      {id:'a16',scope:'statewide',unit_id:null,title:'P90X Workout',default_duration_minutes:45,category_id:'c-fit',default_audience:'Cadets'}
    ],
    schedules: [
      {
        id:`s-${monthKey}-cadet`,unit_id:DEMO_IDS.unit1,program_type:'cadet',year,month:month+1,
        current_published_version_id:`v-${monthKey}-cadet-pub`,
        versions:[
          {id:`v-${monthKey}-cadet-pub`,version_number:1,status:'published',published_at:new Date().toISOString(),meetings:[
            makeMeeting('m1',date1,'t-lead','u-ocp','18:30','21:00',[
              ev('e1','r1','18:30','18:45','Opening Formation / Uniform Inspections','c-lead','All Cadets','Cadet Commander'),
              ev('e2','r1','18:45','19:30','Leadership for Airmen','c-lead','Cadet Airmen','Flight Commander'),
              ev('e3','r2','18:45','19:30',"Leadership for NCO's",'c-lead','Cadet NCOs','Deputy Commander for Cadets'),
              ev('e4','r3','19:30','19:45','Drill / Drill Testing','c-lead','All Cadets','First Sergeant'),
              ev('e5','r1','19:45','20:30','Character Development Module','c-char','All Cadets','Chaplain / CDI'),
              ev('e6','r1','20:30','20:45','Safety','c-safe','All Members','Safety Officer'),
              ev('e7','r3','20:45','21:00','Closing Formation','c-lead','All Cadets','Cadet Commander')
            ]),
            makeMeeting('m2',date2,'t-fit','u-ocp','18:30','21:00',[
              ev('e8','r3','18:30','18:45','Opening Formation','c-lead','All Cadets','Cadet Commander'),
              {...ev('e9','r3','18:45','19:30','Fitness Training','c-fit','Cadets','Fitness Officer'),uniform_override_id:'u-pt'},
              ev('e10','r1','19:30','20:15','Emergency Services','c-es','Cadets','ES Officer'),
              ev('e11','r3','20:15','21:00','Drill / Drill Testing','c-lead','Cadets','First Sergeant')
            ]),
            makeMeeting('m3',date3,'t-aero','u-ocp','18:30','21:00',[
              ev('e12','r3','18:30','18:45','Opening Formation','c-lead','All Cadets','Cadet Commander'),
              ev('e13','r1','18:45','19:30','Aerospace Lesson','c-aero','Cadets','Aerospace Education Officer'),
              ev('e14','r2','19:30','20:15','Aerospace Activity','c-aero','Cadets','Aerospace Education Officer'),
              ev('e15','r3','20:15','21:00','Color Guard / Drill','c-lead','Cadets','First Sergeant')
            ]),
            makeMeeting('m4',date4,'t-es','u-ocp','18:30','21:00',[
              ev('e16','r3','18:30','18:45','Opening Formation','c-lead','All Cadets','Cadet Commander'),
              ev('e17','r1','18:45','19:30','Topo Maps','c-es','Ground Team','ES Officer'),
              ev('e18','r2','19:30','20:15','Mission Communications','c-es','Mission Staff','Communications Officer'),
              ev('e19','r3','20:15','21:00','Practical Exercise','c-es','All Cadets','ES Officer')
            ])
          ]}
        ]
      },
      {
        id:`s-${monthKey}-senior`,unit_id:DEMO_IDS.unit1,program_type:'senior',year,month:month+1,
        current_published_version_id:`v-${monthKey}-senior-pub`,versions:[
          {id:`v-${monthKey}-senior-pub`,version_number:1,status:'published',published_at:new Date().toISOString(),meetings:[
            makeMeeting('sm1',date1,'t-general','u-civ','18:45','20:30',[
              ev('se1','r2','18:45','19:15','Commander Staff Update','c-admin','Senior Members','Squadron Commander'),
              ev('se2','r2','19:15','20:00','Professional Development','c-admin','Senior Members','Education & Training Officer'),
              ev('se3','r2','20:00','20:30','Mission Readiness Discussion','c-es','Senior Members','Emergency Services Officer')
            ])
          ]}
        ]
      }
    ],
    specialActivities: [
      {id:'sp1',unit_id:DEMO_IDS.unit1,title:'Ground Team Field Training Exercise',audience:'Cadets & Senior Members',starts_at:new Date(year,month+1,12,8,0).toISOString(),ends_at:new Date(year,month+1,12,16,0).toISOString(),location:'Regional Training Area',description:'Statewide ground-team navigation and field skills training.',status:'published'},
      {id:'sp2',unit_id:DEMO_IDS.unit2,title:'Orientation Flight Day',audience:'Cadets',starts_at:new Date(year,month+1,19,9,0).toISOString(),ends_at:new Date(year,month+1,19,15,0).toISOString(),location:'Municipal Airport',description:'Cadet orientation flights; weather dependent.',status:'published'}
    ]
  };
}

function makeMeeting(id,date,theme_id,uniform_id,start_time,end_time,events){
  return {id,meeting_date:date,theme_id,uniform_id,start_time,end_time,is_cancelled:false,cancel_reason:null,title:null,events};
}
function ev(id,room_id,start_time,end_time,title,category_id,audience,instructor_name){
  return {id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id:null,description:''};
}
