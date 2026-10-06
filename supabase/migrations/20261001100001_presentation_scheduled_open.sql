-- A curator can schedule a presentation review to open automatically at a
-- future date/time (draft -> review_open) instead of clicking "Open for
-- review" that day. Nullable -- most presentations are opened manually and
-- never set this. review_deadline (existing column) can be set together
-- with this at schedule time; it just sits on the row until the cron job
-- flips status, same as it already does for a manual open.
alter table presentations add column if not exists scheduled_open_at timestamptz;

create index if not exists presentations_scheduled_open_at_idx on presentations(scheduled_open_at) where scheduled_open_at is not null;
