# Dimension Education – Verbal Communication Test App
### Build guide: Google AI Studio (builder) + Supabase (database, login, recordings)

**Plan in one line:** AI Studio writes the app. Supabase stores everything. You host it on Vercel (or AI Studio's Cloud Run deploy).
**Security principle:** the app is protected by **database rules (Row Level Security)**, not by hiding pages. The SQL in Part 3 creates those rules. Without it, anyone with a link can read data.

---

## Part 1. What you are building

A simple Versant-style spoken English test for **Dimension Education**.

- Candidate hears an audio prompt (**played once**), then speaks. The answer is recorded and saved.
- Tab switch or fullscreen exit gives a **warning**. After 2 warnings the test **auto-submits**.
- Admin can **listen, score, and download** recordings (ZIP) and a report (CSV).
- Built for roughly 2-5 candidates a month. Simple and robust.

### Who can access what

| Person | Sign-in | Access |
|---|---|---|
| Admin | Email + password (created by you in Supabase) | Everything |
| Candidate | Name + one-time test code (anonymous session) | Only their own test |
| Anyone with a copied link | None | Only the public start page. Everything else redirects. |

### Pages

| Route | Who | Purpose |
|---|---|---|
| `/` | Public | Start page: name + test code |
| `/instructions` | Candidate | Rules + microphone check |
| `/test` | Candidate | The test |
| `/done` | Candidate | Thank-you |
| `/admin/login` | Public | Admin login |
| `/admin` | Admin | Candidate list, filters, CSV report |
| `/admin/candidates/:id` | Admin | Recordings, scoring, ZIP download |
| `/admin/codes` | Admin | Create and manage test codes |
| `/admin/questions` | Admin | Manage questions and audio prompts |

---

## Part 2. Set up Supabase (about 15 minutes)

1. Create a free project at **supabase.com** (choose a region close to your candidates). Save the database password.
2. **Authentication → Sign In / Providers**
   - Turn **Anonymous sign-ins ON** (used for candidates).
   - Keep **Email** provider on (used for the admin).
   - Optional: turn off "Allow new users to sign up". **Test candidate start afterwards**; if anonymous sign-in stops working, turn it back on. The app has no sign-up page, and the rules in Part 3 make any stray account powerless anyway.
3. **Authentication → Users → Add user**: create your admin (email + password, tick auto-confirm).
4. **SQL Editor → New query**: paste the whole script from **Part 3**, then click **Run**.
5. Run the **admin role** line at the end of Part 3 with your email.
6. **Project Settings → API**: copy the **Project URL** and the **anon public key**. Keep the `service_role` key secret. It never goes in the app.
7. Check that **Storage** shows two private buckets: `recordings` and `question-audio`.

---

## Part 3. Supabase SQL script (paste and run once)

> Review it, then run it. If an error appears, copy the error text and send it to AI Studio or to me. Do not run it twice without checking, because some statements will error on duplicates.

```sql
-- =====================================================
-- Dimension Education Verbal Test – database setup
-- =====================================================

-- ---------- TABLES ----------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin',
  unique (user_id, role)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  section text not null,
  order_number int not null unique,
  type text not null,
  display_text text,
  audio_path text,
  time_limit_seconds int not null default 20,
  active boolean not null default true
);

-- Answer scripts (admin only, so candidates never see the correct answers)
create table public.question_scripts (
  question_id uuid primary key references public.questions(id) on delete cascade,
  script_text text not null
);

create table public.test_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  candidate_name text,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  test_code text not null,
  status text not null default 'in_progress',
  warning_count int not null default 0,
  current_question int not null default 0,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  total_score numeric,
  overall_notes text
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  audio_path text not null,
  duration_seconds numeric,
  recorded_at timestamptz not null default now(),
  unique (candidate_id, question_id)
);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null unique references public.responses(id) on delete cascade,
  pronunciation int check (pronunciation between 1 and 5),
  fluency int check (fluency between 1 and 5),
  accuracy int check (accuracy between 1 and 5),
  content int check (content between 1 and 5),
  notes text
);

create table public.proctor_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  event_type text not null,
  question_id uuid,
  created_at timestamptz not null default now()
);

-- ---------- ADMIN CHECK ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- SECURE FUNCTIONS (candidates use ONLY these to change data) ----------
create or replace function public.start_test(p_code text, p_full_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_code_id uuid;
  v_candidate uuid;
  v_code text := upper(trim(p_code));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Name required'; end if;

  select id into v_code_id from public.test_codes
   where code = v_code and used = false for update;

  if v_code_id is null then
    perform pg_sleep(1.5);  -- slows down guessing
    raise exception 'Invalid or already used code';
  end if;

  update public.test_codes set used = true where id = v_code_id;

  insert into public.candidates (user_id, full_name, test_code)
  values (auth.uid(), trim(p_full_name), v_code)
  returning id into v_candidate;

  return v_candidate;
end;
$$;

create or replace function public.set_progress(p_current int)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.candidates set current_question = p_current
   where user_id = auth.uid() and status = 'in_progress';
end;
$$;

create or replace function public.record_warning(p_event_type text, p_question_id uuid)
returns int
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid; v_count int;
begin
  if p_event_type not in ('tab_switch', 'fullscreen_exit') then
    raise exception 'Invalid event';
  end if;

  update public.candidates set warning_count = warning_count + 1
   where user_id = auth.uid() and status = 'in_progress'
   returning id, warning_count into v_id, v_count;

  if v_id is null then raise exception 'No active test'; end if;

  insert into public.proctor_events (candidate_id, event_type, question_id)
  values (v_id, p_event_type, p_question_id);

  return v_count;
end;
$$;

create or replace function public.finish_test(p_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_status not in ('submitted', 'auto_submitted') then
    raise exception 'Invalid status';
  end if;

  update public.candidates set status = p_status, submitted_at = now()
   where user_id = auth.uid() and status = 'in_progress'
   returning id into v_id;

  if v_id is not null and p_status = 'auto_submitted' then
    insert into public.proctor_events (candidate_id, event_type)
    values (v_id, 'auto_submit');
  end if;
end;
$$;

-- Admin only: let a candidate start again (keeps old recordings)
create or replace function public.reset_code(p_candidate_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  select test_code into v_code from public.candidates where id = p_candidate_id;
  update public.candidates set user_id = null, status = 'reset' where id = p_candidate_id;
  update public.test_codes set used = false where code = v_code;
end;
$$;

-- ---------- TURN ON ROW LEVEL SECURITY ----------
alter table public.user_roles       enable row level security;
alter table public.questions        enable row level security;
alter table public.question_scripts enable row level security;
alter table public.test_codes       enable row level security;
alter table public.candidates       enable row level security;
alter table public.responses        enable row level security;
alter table public.scores           enable row level security;
alter table public.proctor_events   enable row level security;

-- ---------- POLICIES ----------
-- Admin: full access
create policy "admin all user_roles"       on public.user_roles       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all questions"        on public.questions        for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all question_scripts" on public.question_scripts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all test_codes"       on public.test_codes       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all candidates"       on public.candidates       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all responses"        on public.responses        for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all scores"           on public.scores           for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all proctor_events"   on public.proctor_events   for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Candidates: read active questions only while their test is in progress
create policy "candidate read questions" on public.questions
  for select to authenticated
  using (
    active and exists (
      select 1 from public.candidates c
      where c.user_id = auth.uid() and c.status = 'in_progress'
    )
  );

-- Candidates: read ONLY their own candidate row (all changes go through the functions above)
create policy "candidate read own" on public.candidates
  for select to authenticated
  using (user_id = auth.uid());

-- Candidates: add and read their OWN responses
create policy "candidate insert own responses" on public.responses
  for insert to authenticated
  with check (
    exists (
      select 1 from public.candidates c
      where c.id = candidate_id and c.user_id = auth.uid() and c.status = 'in_progress'
    )
  );

create policy "candidate read own responses" on public.responses
  for select to authenticated
  using (
    exists (
      select 1 from public.candidates c
      where c.id = candidate_id and c.user_id = auth.uid()
    )
  );

-- No candidate access to: user_roles, question_scripts, test_codes, scores, proctor_events

-- ---------- STORAGE (private buckets) ----------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false), ('question-audio', 'question-audio', false)
on conflict (id) do nothing;

create policy "admin all recordings" on storage.objects
  for all to authenticated
  using (bucket_id = 'recordings' and public.is_admin())
  with check (bucket_id = 'recordings' and public.is_admin());

create policy "admin all question audio" on storage.objects
  for all to authenticated
  using (bucket_id = 'question-audio' and public.is_admin())
  with check (bucket_id = 'question-audio' and public.is_admin());

-- Candidates may upload/read/replace ONLY inside their own folder: {candidate_id}/...
create policy "candidate insert own recordings" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recordings' and exists (
      select 1 from public.candidates c
      where c.user_id = auth.uid() and c.status = 'in_progress'
        and c.id::text = (storage.foldername(name))[1]
    )
  );

create policy "candidate update own recordings" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recordings' and exists (
      select 1 from public.candidates c
      where c.user_id = auth.uid() and c.status = 'in_progress'
        and c.id::text = (storage.foldername(name))[1]
    )
  );

create policy "candidate read own recordings" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recordings' and exists (
      select 1 from public.candidates c
      where c.user_id = auth.uid()
        and c.id::text = (storage.foldername(name))[1]
    )
  );

-- Candidates may play question audio only during an active test
create policy "candidate read question audio" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'question-audio' and exists (
      select 1 from public.candidates c
      where c.user_id = auth.uid() and c.status = 'in_progress'
    )
  );

-- ---------- LOCK DOWN SIGNED-OUT ACCESS ----------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function
  public.is_admin(),
  public.start_test(text, text),
  public.set_progress(int),
  public.record_warning(text, uuid),
  public.finish_test(text),
  public.reset_code(uuid)
to authenticated;

-- ---------- SAMPLE QUESTIONS ----------
with seed(section, order_number, qtype, display_text, script_text, secs) as (
  values
  ('A',  1, 'read_aloud',     'The new library opens at nine o''clock every morning.', null::text, 20),
  ('A',  2, 'read_aloud',     'Please submit your assignment before the end of the week.', null, 20),
  ('A',  3, 'read_aloud',     'Communication skills are important in every profession.', null, 20),
  ('B',  4, 'repeat',         null, 'I usually walk to work.', 15),
  ('B',  5, 'repeat',         null, 'The meeting has been moved to Thursday afternoon.', 15),
  ('B',  6, 'repeat',         null, 'Could you please send me the updated schedule?', 15),
  ('B',  7, 'repeat',         null, 'She has been learning English for three years.', 15),
  ('C',  8, 'short_answer',   null, 'What do you use to write on paper? (pen / pencil)', 15),
  ('C',  9, 'short_answer',   null, 'How many days are there in a week? (seven)', 15),
  ('C', 10, 'short_answer',   null, 'Which is bigger, an elephant or a cat? (an elephant)', 15),
  ('C', 11, 'short_answer',   null, 'Where do people usually go to buy medicine? (pharmacy / chemist)', 15),
  ('D', 12, 'sentence_build', null, 'to the market / went / yesterday / she  =>  She went to the market yesterday.', 20),
  ('D', 13, 'sentence_build', null, 'is very important / for everyone / good health  =>  Good health is very important for everyone.', 20),
  ('D', 14, 'sentence_build', null, 'the report / by Friday / must be submitted  =>  The report must be submitted by Friday.', 20),
  ('E', 15, 'retell',         null, 'Rahul missed his bus on Monday morning. He decided to take an auto-rickshaw instead. On the way, the auto broke down. Rahul walked the last kilometre and reached the office ten minutes late.', 60),
  ('F', 16, 'open',           'Describe your daily routine.', null, 45),
  ('F', 17, 'open',           'Talk about a person who has influenced you and why.', null, 45)
),
ins as (
  insert into public.questions (section, order_number, type, display_text, time_limit_seconds)
  select section, order_number, qtype, display_text, secs from seed
  returning id, order_number
)
insert into public.question_scripts (question_id, script_text)
select ins.id, seed.script_text
from ins join seed on seed.order_number = ins.order_number
where seed.script_text is not null;

-- =====================================================
-- RUN THIS LAST, with YOUR admin email:
-- =====================================================
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'YOUR_ADMIN_EMAIL_HERE';
```

**After running it, check:**
- **Table Editor:** every table shows "RLS enabled".
- **Storage:** both buckets are private.
- **`user_roles`** has exactly one row (you).
- **`questions`** has 17 rows.

---

## Part 4. Start in Google AI Studio

1. Open **aistudio.google.com**, go to **Build** (apps), and start a new app.
2. Choose **React** (Vite style) if asked for a framework.
3. **If AI Studio offers to "Enable Firebase", decline.** You are using Supabase.
4. Put the Supabase **Project URL** and **anon key** in the app's environment settings/secrets (ask AI Studio, "Where do I set environment variables?"). These two values are designed to be public, so a config file also works. **Never** use the `service_role` key.
5. Send the prompts in Part 5 **one at a time**, testing after each.

> **Preview caution:** AI Studio's preview runs inside a frame, and microphone, fullscreen and tab detection may behave differently there. **Do the real testing on the deployed site** (Part 6).

---

## Part 5. Prompts for AI Studio

### Reference block (paste at the start of Prompt 1; it defines the database contract)

```
SUPABASE CONTRACT (do not invent other tables, functions or columns):

Client: @supabase/supabase-js, created once in src/lib/supabase.ts using VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Use ONLY the anon key. No Firebase code anywhere.

Tables: user_roles, questions(id, section, order_number, type, display_text, audio_path, time_limit_seconds, active), question_scripts(question_id, script_text) [admin only], test_codes(id, code, candidate_name, used, created_at) [admin only], candidates(id, user_id, full_name, test_code, status, warning_count, current_question, started_at, submitted_at, total_score, overall_notes), responses(id, candidate_id, question_id, audio_path, duration_seconds, recorded_at), scores(id, response_id, pronunciation, fluency, accuracy, content, notes), proctor_events(id, candidate_id, event_type, question_id, created_at).

Candidates sign in with supabase.auth.signInAnonymously(). They can SELECT only their own candidates row, can INSERT into responses for themselves, and may change data ONLY through these RPC functions: start_test(p_code, p_full_name) returns candidate id; set_progress(p_current); record_warning(p_event_type, p_question_id) returns the new warning count (event types: tab_switch, fullscreen_exit); finish_test(p_status) with 'submitted' or 'auto_submitted'. Candidates never update the candidates table directly.

Admins sign in with email + password. The RPC is_admin() returns true for admins. Admin RPC: reset_code(p_candidate_id).

Storage (both buckets private, use signed URLs): bucket "recordings", path {candidate_id}/{order_number}.webm; bucket "question-audio", paths stored in questions.audio_path.

Test codes: 8 characters from ABCDEFGHJKLMNPQRSTUVWXYZ23456789, generated in the browser with crypto.getRandomValues, stored UPPERCASE in test_codes.

Routing: use React Router with HashRouter so links work on any host.
```

### Prompt 1: Foundation and branding
```
[paste the SUPABASE CONTRACT above]

Build a web app "Dimension Education Verbal Test" for a company named Dimension Education. Clean, professional, blue and white. Show "Dimension Education" as a text logo in every header and "© Dimension Education" in the footer. Use React, TypeScript, HashRouter, and install @supabase/supabase-js and jszip. Create src/lib/supabase.ts and a simple auth helper that exposes: current session, isAdmin (via the is_admin RPC) and a candidate lookup (the candidates row where user_id = auth.uid()). Do not enable Firebase. Create placeholder pages for all routes: /, /instructions, /test, /done, /admin/login, /admin, /admin/candidates/:id, /admin/codes, /admin/questions, plus a 404 page.
```

### Prompt 2: Start page and route guards (fixes the "link opens without sign-in" problem)
```
Build the public start page "/": the candidate enters full name and test code. On submit: if there is no session, call signInAnonymously(); then call the start_test RPC; show clear errors for invalid or used codes; on success go to /instructions. If the same browser already has an in_progress candidate, show "Resume test" instead of the form.

Add route guards:
- /admin/* (except /admin/login): require a signed-in user for whom is_admin() is true, otherwise redirect to /admin/login. Anonymous candidate sessions must NOT open admin pages.
- /instructions, /test, /done: require a candidates row for the current user, otherwise redirect to "/". /test requires status in_progress. /done requires a submitted or auto_submitted status. If a finished test opens /test, redirect to /done.
- Never flash protected content while the check is loading; show a spinner.
- Unknown URLs show the 404 page.
There must be no public sign-up page.
```

### Prompt 3: Instructions and test screen
```
Create /instructions listing these rules: use Chrome on a laptop or desktop, quiet room, each audio prompt plays only once, do not switch tabs or leave fullscreen, 2 warnings then automatic submission, no going back. Add a 3-second microphone check with playback; enable "Start Test" only after it works. Starting enters fullscreen. Add a notice that voice recordings are stored by Dimension Education for assessment.

Create /test: load active questions ordered by order_number. Start at candidates.current_question. Show the section name, "Question X of Y" and a progress bar. For each question:
1. If audio_path exists, create a short-lived signed URL from the question-audio bucket and play it exactly once automatically, with no replay, pause or seek controls; show "Listening...". If display_text exists, show it.
2. Then a 3-second "Get ready" countdown.
3. Record with MediaRecorder (audio/webm, about 64 kbps), with a visible countdown from time_limit_seconds and a Stop button.
4. On stop or time up: upload to recordings at {candidate_id}/{order_number}.webm, insert the responses row (candidate_id, question_id, audio_path, duration_seconds), call set_progress with the next index, and move on automatically.
No going back. If the page refreshes, resume at current_question and never replay audio already played in this session. If microphone permission is denied or an upload fails, show a clear message and a Retry button (never skip the question silently). After the last question call finish_test('submitted') and go to /done with: "Thank you. Your test has been submitted. Dimension Education will contact you with next steps."
```

### Prompt 4: Tab-switch warnings
```
Add proctoring on /test. Detect tab switch or minimise (visibilitychange and window blur) and fullscreen exit. Each time call record_warning(event_type, current question id) and show a full-screen warning: "Warning X of 2: Please do not leave the test screen. Leaving again will submit your test." with a button to return and re-enter fullscreen. When the returned warning count reaches 2: stop recording, upload what exists if possible, call finish_test('auto_submitted') and go to /done. Disable right-click, copy, paste and text selection on /test. Count each event once even if several browser events fire together.
```

### Prompt 5: Admin login, dashboard, codes
```
Create /admin/login (email + password via supabase.auth.signInWithPassword). After login, call is_admin(); if false, sign out and show "Not authorised". Add a logout button.

Create /admin: a table of candidates (name, code, started date, status, warning count, total score, View) with search by name and filters for status and date range.

Create /admin/codes: generate a unique 8-character code (optionally with a candidate name) and insert into test_codes; list codes with used/unused status; delete unused codes. In the candidate detail page add a "Reset code" button that calls the reset_code RPC after confirmation.
```

### Prompt 6: Candidate detail and scoring
```
Create /admin/candidates/:id showing name, code, dates, status, warning count and a timeline of proctor_events. List every response grouped by section with the question text, the admin-only script from question_scripts, an audio player using signed URLs from the recordings bucket, the duration, 1-5 score inputs for pronunciation, fluency, accuracy and content, and a notes box. Save to scores (upsert on response_id). Show each section's average and the overall total score as a percentage; save it to candidates.total_score. Add an overall notes box.
```

### Prompt 7: Downloads
```
Add admin downloads:
1. On the candidate page, "Download all recordings (ZIP)", built in the browser with JSZip. Name files CandidateName_Q01_Section.webm and include a scores.csv. Show a progress indicator.
2. A download button beside each audio player.
3. On the dashboard, "Download report (CSV)": one row per candidate with name, test code, date, status, warning count, each section average and total score, respecting current filters.
4. On the dashboard, checkboxes plus "Download recordings for selected candidates (ZIP)".
```

### Prompt 8: Questions manager and polish
```
Create /admin/questions: list questions grouped by section; add, edit, reorder, activate or deactivate; edit time limit, display text and the admin-only script (question_scripts); upload an MP3 to the question-audio bucket and save the path in audio_path, with a preview player.

Polish: make admin pages mobile-friendly; on phones and tablets the candidate pages show "Please use a laptop or desktop with Chrome"; add loading and error states; add a "Delete candidate data" button with confirmation on the candidate page that deletes the candidate's recordings from storage and then the candidate row (related rows are removed automatically).
```

### Prompt 9: Security audit
```
Audit the app. List every route and who can open it, and every Supabase call the candidate pages make. Confirm: candidate pages never read test_codes, scores, user_roles or question_scripts; no candidate code updates the candidates table directly; no service_role key or Firebase code exists anywhere; every admin route redirects non-admins. Fix anything that fails.
```

---

## Part 6. Deploy

### Option A: Vercel (recommended)
1. Export the project from AI Studio (download the code or use its GitHub option) and put it in a GitHub repository.
2. In **vercel.com**, **Add New → Project**, import the repository. Framework: **Vite**. Build command `npm run build`, output directory `dist`.
3. Add environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public anon key only).
4. Deploy. Vercel gives an HTTPS address, which the microphone requires.
5. If you used HashRouter, no rewrite file is needed. Otherwise add this `vercel.json`:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```
6. In **Supabase → Authentication → URL Configuration**, set the **Site URL** to your Vercel address and add it to the **Redirect URLs**.

### Option B: AI Studio's own deploy
AI Studio can deploy to Google Cloud Run. This may need a Google Cloud account, and free limits change, so check current terms. The Supabase variables must be set there too.

---

## Part 7. Test before using with candidates

Use a private window or a second computer.

**Access and security (most important)**
- [ ] `/#/admin`, `/#/admin/codes` and `/#/admin/candidates/x` while logged out redirect to the admin login
- [ ] `/#/test`, `/#/instructions` and `/#/done` while logged out redirect to `/`
- [ ] A candidate session cannot open admin pages
- [ ] Pasting a candidate's `/test` link into another browser redirects to `/`
- [ ] In Supabase every table shows RLS enabled, both buckets are private
- [ ] In the browser console, a logged-out request to `rest/v1/candidates` returns nothing or an error

**Test function**
- [ ] Wrong and used codes are rejected
- [ ] Mic check passes before Start is enabled
- [ ] Each audio plays once, no replay
- [ ] Recording starts automatically and stops at the time limit
- [ ] Recordings appear in the admin player
- [ ] Tab switch gives Warning 1; the second auto-submits
- [ ] Refresh mid-test resumes at the correct question
- [ ] Reset code lets a candidate start again

**Admin**
- [ ] Scores save, totals correct
- [ ] ZIP opens, every audio file plays
- [ ] CSV opens in Excel or Google Sheets

---

## Part 8. Running a test session
1. Admin: **Codes → Generate**, send the link and code to the candidate.
2. Candidate: laptop with Chrome, quiet room, no other tabs open.
3. Optional: join a Google Meet with the camera on and screen shared.
4. After submission: score it, then download the ZIP and CSV.

---

## Part 9. Audio prompts
Record on a phone or Audacity (or use free text-to-speech such as ElevenLabs or Natural Readers). Export as MP3, under 15 seconds each (the story about 30). Upload via **/admin/questions**. The answer scripts for each question are already stored for you as admin-only references.

---

## Part 10. Known limits
- A web app can detect and warn about tab switching but cannot physically lock the computer or see a second device.
- Chrome and Edge work best.
- Scoring is manual.
- Free Supabase projects may pause after inactivity. Open the dashboard before a test day. Check current free-tier limits.
- Tell candidates their voice is recorded and stored, and check the privacy rules for your region.
- **Monthly backup:** download the CSV and the ZIP of recordings into a folder named `Dimension Education – Verbal Test Records / YYYY-MM`.

---

## Part 11. If something breaks
Fix one thing per message and test after each. Use specific wording:
```
After your last change /#/admin opens without login. Restore the admin route guard using the is_admin() RPC and list the access rule for every route.
```
```
Recordings upload but the admin player is silent. Use createSignedUrl on the private "recordings" bucket and show a clear error if the file is missing.
```
