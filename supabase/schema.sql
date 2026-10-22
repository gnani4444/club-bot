-- Club Bot schema. Run once in Supabase SQL editor.
create table if not exists players (
  id text primary key,                 -- WhatsApp JID (may be @lid in groups)
  name text,
  outs int not null default 0          -- times dropped out; lower = more reliable
);

create table if not exists sessions (
  id bigint generated always as identity primary key,
  sport text not null,
  group_jid text not null,
  status text not null default 'polling' check (status in ('polling','booked','done')),
  venue_name text, start_at timestamptz, end_at timestamptz,
  court_price_pence int, capacity int,
  booking_url text, maps_url text, pay_link text,
  created_at timestamptz not null default now()
);

create table if not exists slots (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  idx int not null,                    -- 1-based option number shown in WhatsApp
  payload jsonb not null,
  unique (session_id, idx)
);

create table if not exists votes (
  session_id bigint not null references sessions(id) on delete cascade,
  player_id text not null references players(id),
  idx int not null,
  voted_at timestamptz not null default now(),
  primary key (session_id, player_id, idx)  -- multi-choice: one row per chosen option
);

create table if not exists rsvps (
  session_id bigint not null references sessions(id) on delete cascade,
  player_id text not null references players(id),
  status text not null check (status in ('in','out','waitlist','offered')),
  position int not null,               -- order within waitlist / roster
  offered_at timestamptz,
  reminded_2h boolean not null default false,
  reminded_30m boolean not null default false,
  paid boolean not null default false,
  primary key (session_id, player_id)
);

-- Service key bypasses RLS; enable RLS so the anon key reads nothing.
alter table players enable row level security;
alter table sessions enable row level security;
alter table slots enable row level security;
alter table votes enable row level security;
alter table rsvps enable row level security;

-- Live dashboard: stream changes over Supabase Realtime.
alter publication supabase_realtime add table sessions, rsvps;
