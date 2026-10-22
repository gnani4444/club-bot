-- Multi-choice polls: a player can vote for several time windows.
alter table votes drop constraint votes_pkey;
alter table votes add primary key (session_id, player_id, idx);
