-- Caregiver Dashboard Tables
-- Run these in Supabase SQL editor

-- Tracks every button tap from the caregiver dashboard
create table if not exists caregiver_actions (
  id          uuid primary key default gen_random_uuid(),
  caregiver_name text,
  action_type text        not null,  -- 'eating','sleeping','playing','reading','bath','poop','vitamin','note'
  clicked_at  timestamptz not null,  -- exact moment the button was tapped (PHT)
  date        text        not null,  -- YYYY-MM-DD in PHT, for easy day queries
  details     jsonb       default '{}',
  status      text        default 'pending',  -- 'pending','complete','sleeping'
  created_at         timestamptz   default now()
);

-- Tracks daily food, drink, and snack entries
-- (also used by the assistant, Telegram passive parsing, and dashboard eating flow)
create table if not exists food_logs (
  id          uuid primary key default gen_random_uuid(),
  date        text        not null,  -- YYYY-MM-DD in PHT
  time        text,                   -- HH:MM in PHT
  name        text        not null,  -- e.g. "banana rice chicken"
  food_type   text        default 'food',  -- 'food' | 'drink' | 'snack'
  portion     text        default '',      -- 'All' | 'Half' | 'Few bites' | 'Refused'
  notes       text        default '',
  source      text        default 'telegram', -- 'telegram' | 'app' | 'dashboard'
  created_at  timestamptz default now()
);

create index if not exists idx_food_logs_date on food_logs(date);

create table if not exists vitamins (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null unique,
  created_at  timestamptz default now()
);

create table if not exists vitamin_logs (
  id           uuid primary key default gen_random_uuid(),
  date         text        not null,
  vitamin_name text        not null,
  taken        boolean     default true,
  time_taken   text,
  source       text        default 'telegram',
  created_at   timestamptz default now(),
  unique(date, vitamin_name)
);

create table if not exists activity_logs (
  id          uuid primary key default gen_random_uuid(),
  date        text        not null,
  time        text,
  activity    text        not null,
  notes       text        default '',
  source      text        default 'telegram',
  created_at  timestamptz default now()
);

create index if not exists idx_activity_logs_date on activity_logs(date);

create table if not exists schedule (
  id          uuid primary key default gen_random_uuid(),
  date        text        not null,
  time        text        not null,
  activity    text        not null,
  color       text        default '#7F77DD',
  source      text        default 'telegram',
  created_at  timestamptz default now()
);

create index if not exists idx_schedule_date on schedule(date);

create table if not exists master_schedule (
  id          uuid primary key default gen_random_uuid(),
  time        text        not null,
  activity    text        not null,
  color       text        default '#7F77DD',
  active      boolean     default true,
  created_at  timestamptz default now()
);

create table if not exists master_schedule_log (
  id                uuid primary key default gen_random_uuid(),
  master_schedule_id uuid     not null references master_schedule(id) on delete cascade,
  date              text     not null,
  activity          text,
  completed         boolean  default false,
  responded_at      timestamptz,
  created_at        timestamptz default now(),
  unique(master_schedule_id, date)
);

alter table master_schedule_log
  add column if not exists activity text;

create table if not exists reminders (
  id          uuid primary key default gen_random_uuid(),
  time        text        not null,
  message     text        not null,
  active      boolean     default true,
  created_at  timestamptz default now()
);

create table if not exists context_reminders (
  id          uuid primary key default gen_random_uuid(),
  trigger     text        not null,  -- 'food', 'Nap', 'Bath', etc.
  message     text        not null,
  active      boolean     default false,
  created_at  timestamptz default now()
);

create table if not exists johnson_preferences (
  id          uuid primary key default gen_random_uuid(),
  pref_type   text        not null,  -- 'like' | 'dislike'
  category    text        default 'food',  -- 'food' | 'drink' | 'activity' | 'place' | 'other'
  item        text        not null,
  status      text        default 'pending',  -- 'pending' | 'confirmed' | 'rejected'
  created_at  timestamptz default now()
);

create table if not exists app_suggestions (
  id          uuid primary key default gen_random_uuid(),
  priority    text        default 'medium',  -- 'low' | 'medium' | 'high'
  category    text        default 'new_feature',
  title       text        not null,
  description text,
  reason      text,
  status      text        default 'draft',  -- 'draft' | 'pending' | 'done' | 'rejected'
  created_at  timestamptz default now()
);

create table if not exists johnson_profile (
  id          uuid primary key default gen_random_uuid(),
  category    text        not null,  -- 'food_preference' | 'sleep_pattern' | 'behavior' | 'health' | 'routine' | 'development'
  fact        text        not null,
  confidence  text        default 'medium',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique(category, fact)
);

create table if not exists meal_plans (
  id          uuid primary key default gen_random_uuid(),
  week_start  text        not null unique,  -- YYYY-MM-DD (Monday)
  plan        text        not null,         -- JSON string
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Holds the pending conversation step for each Telegram user
-- One row per user — upserted on every new state, deleted when resolved
create table if not exists conversation_state (
  id                 uuid primary key default gen_random_uuid(),
  telegram_user_id   text        not null unique,
  action_type        text,         -- matches caregiver_actions.action_type
  step               text,         -- 'food_name','sleep_type','play_activity','book_name','poop_type','vit_type','vit_name','note_text'
  clicked_at         timestamptz,  -- preserved from original button tap
  caregiver_name     text,
  extra              jsonb         default '{}',
  created_at         timestamptz   default now()
);
