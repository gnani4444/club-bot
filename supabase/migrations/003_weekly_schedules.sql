-- Weekly auto-poll: one schedule per group.
create table if not exists schedules (
  group_jid text primary key,
  sport text not null,
  play_day text not null,            -- "sat"
  players int,                       -- null = sport default
  organiser text not null,           -- gets the booking link
  post_dow int not null default 1,   -- 0=Sun..6=Sat, Europe/London
  post_hour int not null default 10,
  close_after_hours int not null default 48,
  last_posted date
);
alter table schedules enable row level security;
alter table sessions add column if not exists auto_close_at timestamptz;
alter table sessions add column if not exists organiser text;
