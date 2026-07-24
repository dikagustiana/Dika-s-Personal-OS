-- Starter data. Habits and projects have no creation UI (they exist only in
-- src/data/seed.ts), so an empty database would leave the Habits card and the
-- whole Projects view permanently blank. This seeds the same five habits and
-- four projects, with the same fixed UUIDs as the mock, and nothing else —
-- tasks, braindumps, timeblocks, logs and plans all start empty and accrue
-- from real use. Idempotent: re-running never duplicates or overwrites.

insert into public.os_entries (id, type, tags, payload) values
  ('20000000-0000-4000-8000-000000000001', 'habit', '{study}',
   '{"title": "Study IELTS 1h", "active": true, "order": 1}'),
  ('20000000-0000-4000-8000-000000000002', 'habit', '{health}',
   '{"title": "Move for 30 min", "active": true, "order": 2}'),
  ('20000000-0000-4000-8000-000000000003', 'habit', '{learning}',
   '{"title": "Read 20 pages", "active": true, "order": 3}'),
  ('20000000-0000-4000-8000-000000000004', 'habit', '{craft}',
   '{"title": "Write 300 words", "active": true, "order": 4}'),
  ('20000000-0000-4000-8000-000000000005', 'habit', '{mindset}',
   '{"title": "Evening reflection", "active": true, "order": 5}')
on conflict (id) do nothing;

insert into public.os_projects (id, title, type, status, deadline, target_metric, sort_order, milestones) values
  ('10000000-0000-4000-8000-000000000001', 'Chevening / LPDP', 'scholarship', 'active',
   '2026-11-01', 'Submit a distinctive, evidence-led application', 1,
   '[
     {"id": "11000000-0000-4000-8000-000000000001", "text": "Leadership essay", "done": true},
     {"id": "11000000-0000-4000-8000-000000000002", "text": "Networking essay", "done": false},
     {"id": "11000000-0000-4000-8000-000000000003", "text": "Study in the UK essay", "done": false},
     {"id": "11000000-0000-4000-8000-000000000004", "text": "Career plan essay", "done": false},
     {"id": "11000000-0000-4000-8000-000000000005", "text": "Choose UK course 1", "done": true},
     {"id": "11000000-0000-4000-8000-000000000006", "text": "Choose UK course 2", "done": false},
     {"id": "11000000-0000-4000-8000-000000000007", "text": "Choose UK course 3", "done": false}
   ]'),
  ('10000000-0000-4000-8000-000000000002', 'IELTS', 'study', 'active',
   '2026-10-16', 'IELTS Overall 7.0', 2,
   '[
     {"id": "12000000-0000-4000-8000-000000000001", "text": "Complete diagnostic test", "done": true},
     {"id": "12000000-0000-4000-8000-000000000002", "text": "Reach Writing band 6.5", "done": false},
     {"id": "12000000-0000-4000-8000-000000000003", "text": "Book official test", "done": false}
   ]'),
  ('10000000-0000-4000-8000-000000000003', 'Research', 'research', 'active',
   null, 'Complete a defensible working paper', 3,
   '[
     {"id": "13000000-0000-4000-8000-000000000001", "text": "Lock research question", "done": true},
     {"id": "13000000-0000-4000-8000-000000000002", "text": "Literature map", "done": false},
     {"id": "13000000-0000-4000-8000-000000000003", "text": "Methods outline", "done": false}
   ]'),
  ('10000000-0000-4000-8000-000000000004', 'Website (writing)', 'build', 'active',
   null, 'Publish consistently in my own voice', 4,
   '[
     {"id": "14000000-0000-4000-8000-000000000001", "text": "Define three writing pillars", "done": true},
     {"id": "14000000-0000-4000-8000-000000000002", "text": "Draft cornerstone essay", "done": false},
     {"id": "14000000-0000-4000-8000-000000000003", "text": "Manual publish checklist", "done": false}
   ]')
on conflict (id) do nothing;
