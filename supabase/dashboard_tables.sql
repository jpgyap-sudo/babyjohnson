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
  created_at  timestamptz default now()
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
