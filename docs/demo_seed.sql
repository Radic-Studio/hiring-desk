-- Management demo records (Stage 9). Every record is named or numbered DEMO and notes say it is not real business.
-- Written through apply_op as a Group Admin, so each one has a version, an operation id and an ops_log entry.
-- No payments are created and no real number sequence is used: job numbers are DEMO-Q-00x, typed by hand.
-- Contact details are fake: 0800 000 xxxx phone numbers and @example.com addresses (a reserved domain no email reaches).
-- Remove after management has decided: soft-delete the DEMO role (its candidates and issue go with it), the DEMO staff,
-- customer, jobs and materials from the app. They stay in Recently deleted for a Group Admin.
-- Run in the SQL Editor of the live project as one block. Safe to run once; a second run is refused ("already exists").
do $$
declare
  ga uuid := '262d318c-0cb4-4dcb-8ba6-0a487e687d9d';   -- radiantb3@gmail.com, Group Admin
  me text := 'radiantb3@gmail.com'; note text := 'DEMO record for the management presentation. Not real business.';
  r jsonb; out text := ''; cust uuid; st1 uuid; t timestamptz := now();
  h jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ga, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  r := apply_op(gen_random_uuid(), 'roles', 'demo', 'insert', jsonb_build_object('name', 'DEMO Sales Assistant (test role)', 'company_id', 'group',
        'qual_weight', 1, 'top', 3, 'second', 6, 'order', 3, 'status', 'open', 'source', 'DEMO data, not a real vacancy', 'created_by', me), null);
  out := out || 'role ' || (r->>'result') || E'\n';

  for h in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('id','demo-01','sn',1,'name','DEMO Ada Example','qualification','BSc','location','Close to office','state','Enugu','address','DEMO address, Obiagu, Enugu','status','contacted','mode','Call','availability','Immediately','relocation','N/A','next_action','Confirm interview time',
      'interview', jsonb_build_object('date','2026-11-04','time','10:00','outcome','Pending','notes','DEMO interview'),
      'history', jsonb_build_array(jsonb_build_object('ts','2026-10-26T09:00:00Z','by',me,'summary','Called: available immediately, lives close to the office'))),
    jsonb_build_object('id','demo-02','sn',2,'name','DEMO Bayo Example','qualification','HND','location','Within Enugu','state','Enugu','address','DEMO address, Independence Layout, Enugu','status','contacted','mode','WhatsApp','availability','Immediately','relocation','N/A',
      'history', jsonb_build_array(jsonb_build_object('ts','2026-10-26T09:20:00Z','by',me,'summary','WhatsApp reply: available immediately'))),
    jsonb_build_object('id','demo-03','sn',3,'name','DEMO Chika Example','qualification','MBA/MSc','location','Other state','state','Lagos','address','DEMO address, Lagos','status','contacted','mode','Call','availability','Within a month','relocation','Yes',
      'history', jsonb_build_array(jsonb_build_object('ts','2026-10-26T09:40:00Z','by',me,'summary','Called: in Lagos, willing to relocate within a month'))),
    jsonb_build_object('id','demo-04','sn',4,'name','DEMO Dele Example','qualification','OND','location','Outside Enugu Town','state','Enugu','address','DEMO address, Nsukka','status','attempted','attempts',2,'mode','Call',
      'history', jsonb_build_array(jsonb_build_object('ts','2026-10-25T15:00:00Z','by',me,'summary','No answer'), jsonb_build_object('ts','2026-10-26T10:00:00Z','by',me,'summary','No answer'))),
    jsonb_build_object('id','demo-05','sn',5,'name','DEMO Efe Example','qualification','SSCE','location','Within Enugu','state','Enugu','address','DEMO address, Uwani, Enugu','status','awaiting','mode','WhatsApp'),
    jsonb_build_object('id','demo-06','sn',6,'name','DEMO Funmi Example','qualification','BSc','location','Unknown','state','','address',''),
    jsonb_build_object('id','demo-07','sn',7,'name','DEMO Gozie Example','qualification','Degree','location','Close to office','state','Enugu','address','DEMO address, Ogui, Enugu','notes','Use this record for the delete and restore demonstration.'),
    jsonb_build_object('id','demo-08','sn',8,'name','DEMO Hauwa Example','qualification','B.A.','location','Other state','state','Kano','address','DEMO address, Kano','status','contacted','mode','Call','availability','In one week','relocation','No',
      'history', jsonb_build_array(jsonb_build_object('ts','2026-10-26T10:30:00Z','by',me,'summary','Called: will not relocate')))
  )) loop
    r := apply_op(gen_random_uuid(), 'candidates', h->>'id', 'insert', h || jsonb_build_object('role','demo','company_id','group',
          'phone', '0800000' || lpad(h->>'sn', 4, '0'), 'email', 'demo' || (h->>'sn') || '@example.com',
          'notes', trim(coalesce(h->>'notes','') || ' ' || note), 'added_manually', true, 'added_by', me, 'imported_from', 'DEMO data',
          'last_contact', case when h ? 'history' then t end, 'last_by', case when h ? 'history' then me end), null);
    out := out || (h->>'id') || ' ' || (r->>'result') || coalesce(' ' || (r->>'message'), '') || E'\n';
  end loop;

  r := apply_op(gen_random_uuid(), 'issues', 'demo-issue-1', 'insert', jsonb_build_object('candidate_id','demo-06','name','DEMO Funmi Example','role','demo','company_id','group',
        'issue','Location unclear','detail','DEMO: the application gives no town or state.','action','Call to confirm where she lives'), null);
  out := out || 'issue ' || (r->>'result') || E'\n';

  r := apply_op(gen_random_uuid(), 'staff', null, 'insert', jsonb_build_object('company_id','press','companies',array['press'],'first_name','Ifeoma','surname','DEMO Example',
        'full_name','DEMO Ifeoma Example','position','Production Assistant','department','Press','employment_type','full_time','start_date','2026-09-01',
        'phone','08000000101','email','demo.staff1@example.com','notes',note,'created_by',me), null);
  st1 := (r->>'id')::uuid; out := out || 'staff 1 ' || (r->>'result') || E'\n';
  r := apply_op(gen_random_uuid(), 'staff', null, 'insert', jsonb_build_object('company_id','press','companies',array['press'],'first_name','Jide','surname','DEMO Example',
        'full_name','DEMO Jide Example','position','Graphic Designer','department','Press','employment_type','contract','start_date','2026-10-01',
        'phone','08000000102','email','demo.staff2@example.com','notes',note,'created_by',me), null);
  out := out || 'staff 2 ' || (r->>'result') || coalesce(' ' || (r->>'message'), '') || E'\n';
  r := apply_op(gen_random_uuid(), 'leave_requests', null, 'insert', jsonb_build_object('staff_id',st1,'company_id','press','kind','annual',
        'start_date','2026-11-16','end_date','2026-11-20','reason','DEMO leave request','requested_by',me), null);
  out := out || 'leave ' || (r->>'result') || coalesce(' ' || (r->>'message'), '') || E'\n';

  r := apply_op(gen_random_uuid(), 'press_customers', null, 'insert', jsonb_build_object('company_id','press','name','DEMO Example School',
        'phone','08000000201','email','demo.customer@example.com','address','DEMO address, Enugu','notes',note,'created_by',me), null);
  cust := (r->>'id')::uuid; out := out || 'customer ' || (r->>'result') || E'\n';
  r := apply_op(gen_random_uuid(), 'press_jobs', null, 'insert', jsonb_build_object('company_id','press','number','DEMO-Q-001','customer_id',cust,'customer_name','DEMO Example School',
        'title','DEMO School open-day flyers','description','DEMO quote. Not a real job.',
        'items', jsonb_build_array(jsonb_build_object('description','A5 flyer, full colour, one side (DEMO price)','qty',500,'unit','piece','unit_price',60,'total',30000)),
        'subtotal',30000,'total',30000,'stage','quote','quoted_at',t,'valid_days',14,
        'specs', jsonb_build_object('size','A5','paper','150gsm','colours','Full colour, one side','finishing','None'),'notes',note,'created_by',me), null);
  out := out || 'job 1 ' || (r->>'result') || coalesce(' ' || (r->>'message'), '') || E'\n';
  r := apply_op(gen_random_uuid(), 'press_jobs', null, 'insert', jsonb_build_object('company_id','press','number','DEMO-Q-002','customer_id',cust,'customer_name','DEMO Example School',
        'title','DEMO Prize-giving banners','description','DEMO job in production. Not a real job.',
        'items', jsonb_build_array(jsonb_build_object('description','Flex banner 6 x 3 ft (DEMO price)','qty',2,'unit','piece','unit_price',15000,'total',30000)),
        'subtotal',30000,'total',30000,'stage','print','quoted_at',t - interval '3 days','accepted_at',t - interval '2 days','proof_approved_at',t - interval '1 day',
        'due_date','2026-11-06','assigned_to','DEMO Jide Example',
        'specs', jsonb_build_object('size','6 x 3 ft','paper','Flex','colours','Full colour','finishing','Eyelets'),'notes',note,'created_by',me), null);
  out := out || 'job 2 ' || (r->>'result') || coalesce(' ' || (r->>'message'), '') || E'\n';
  r := apply_op(gen_random_uuid(), 'press_materials', null, 'insert', jsonb_build_object('company_id','press','name','DEMO A4 paper 80gsm','unit','ream','quantity',40,'reorder_level',10,'unit_cost',4500,'notes',note), null);
  out := out || 'material 1 ' || (r->>'result') || E'\n';
  r := apply_op(gen_random_uuid(), 'press_materials', null, 'insert', jsonb_build_object('company_id','press','name','DEMO Flex banner roll','unit','roll','quantity',1,'reorder_level',2,'unit_cost',38000,'notes',note), null);
  out := out || 'material 2 ' || (r->>'result') || E'\n';
  raise notice '%', out;
  reset role;
  if out like '%refused%' or out like '%conflict%' then raise exception E'Not all DEMO records were saved; nothing kept:\n%', out; end if;
end $$;
