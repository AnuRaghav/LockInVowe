-- Charts Sam draws during a conversation turn (see lib/agents/sam/tools/charts.ts).
-- Tied to the run that produced them, so a chart only ever appears beside the
-- answer it belongs to. Stored as the series that were drawn, not an image:
-- the chat renders `spec`, so the chart is exactly these numbers and nothing else.
create table public.conversation_charts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  thread_id uuid not null references public.conversation_threads(id) on delete cascade,
  run_id uuid not null references public.conversation_runs(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  chart_type text not null check (chart_type in ('line', 'bar')),
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
create index conversation_charts_run_idx on public.conversation_charts(run_id);
create index conversation_charts_thread_idx on public.conversation_charts(thread_id, created_at);

alter table public.conversation_charts enable row level security;
-- Same server-only access as the rest of the conversation store. No browser policies.
revoke all on public.conversation_charts from public, anon, authenticated;
grant select, insert, delete on public.conversation_charts to service_role;
