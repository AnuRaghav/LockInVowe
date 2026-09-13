-- Development seed: one realistic company's semantic state.
--
-- Loaded automatically by `supabase db reset` (see [db.seed] in config.toml),
-- so a fresh local database comes up with a company Sam can actually have a
-- conversation with - before the semantic updater has ever run.
--
-- Written through `semantic_block_revise()` rather than as inserts, for two
-- reasons: it is the only supported way to write this state, and it means the
-- seed produces a *real* history rather than a fabricated one. Hiring is seeded
-- as three revisions on purpose - the worked example from the design, "two
-- engineers in Q4" becoming "maybe one" becoming "frozen until the raise" - so
-- the difference between current state and history is demonstrable immediately.
--
-- Kept in step with lib/semantic/seed.ts, which seeds the same story for tests
-- through the TypeScript store.

do $$
declare
  -- The fixed development company. See lib/company/context.ts.
  c constant uuid := '00000000-0000-4000-8000-000000000001';
begin
  -- Idempotent: re-running the seed rebuilds the story rather than appending a
  -- second copy of it to every block's history.
  delete from public.semantic_blocks where company_id = c;
  delete from public.company_briefs where company_id = c;
  delete from public.semantic_interactions where company_id = c;

  perform public.semantic_block_revise(
    c, 'financial-posture', 'Financial posture',
    'We hold roughly $1.8M in cash across operating and reserve accounts. MRR is about $170K and has grown 6-8% month over month for the last two quarters. Net burn is around $210K/month, most of it payroll. Gross margin sits near 76% and is stable. Management treats 12 months of runway as a floor, not a target - dropping below it triggers a plan, not a discussion.',
    p_summary := '~$1.8M in the bank, ~$170K MRR, burning ~$210K/month.',
    p_labels := array['cash', 'burn', 'runway', 'revenue', 'policy'],
    p_salience := 0.95,
    p_context_policy := 'always',
    p_confidence := 0.80,
    p_as_of := date '2026-09-01',
    p_provenance := '{"kind":"onboarding","actor":"founder"}'::jsonb,
    p_change_note := 'Established during onboarding.',
    p_recorded_at := timestamptz '2026-09-01T09:00:00Z'
  );

  perform public.semantic_block_revise(
    c, 'hiring', 'Hiring',
    'We plan to hire two engineers in Q4, both for the platform team, at roughly $205K fully loaded each. The intent is to unblock the enterprise roadmap rather than to add general capacity.',
    p_summary := 'Two engineering hires planned for Q4.',
    p_labels := array['hiring', 'headcount', 'engineering'],
    p_salience := 0.75,
    p_as_of := date '2026-09-03',
    p_provenance := '{"kind":"conversation","actor":"founder"}'::jsonb,
    p_change_note := 'Founder set out the Q4 hiring plan.',
    p_recorded_at := timestamptz '2026-09-03T14:30:00Z'
  );

  perform public.semantic_block_revise(
    c, 'fundraising', 'Fundraising',
    'We intend to raise a Series A of about $8M, opening conversations in Q1 and aiming to close by mid-year. The story is enterprise traction, so the raise timeline is coupled to the enterprise launch landing well. We have not engaged a banker and do not intend to.',
    p_summary := 'Targeting a $8M Series A, first conversations in Q1.',
    p_labels := array['fundraising', 'series-a', 'runway'],
    p_salience := 0.90,
    p_context_policy := 'always',
    p_confidence := 0.60,
    p_as_of := date '2026-09-10',
    p_provenance := '{"kind":"conversation","actor":"founder"}'::jsonb,
    p_recorded_at := timestamptz '2026-09-10T11:00:00Z'
  );

  perform public.semantic_block_revise(
    c, 'enterprise-launch', 'Enterprise launch',
    'The enterprise tier ships in Q4: SSO, audit logging, and a completed SOC 2 Type I. Two deals in the pipeline are explicitly waiting on it. Slipping past Q4 would push the associated revenue into the next fiscal year and weaken the Series A story.',
    p_summary := 'SSO, audit logs, and a security review, targeted at Q4.',
    p_labels := array['product', 'enterprise', 'revenue', 'roadmap'],
    p_salience := 0.80,
    p_as_of := date '2026-09-10',
    p_provenance := '{"kind":"conversation","actor":"founder"}'::jsonb,
    p_recorded_at := timestamptz '2026-09-10T11:20:00Z'
  );

  perform public.semantic_block_revise(
    c, 'infrastructure-migration', 'Infrastructure migration',
    'We are midway through moving from the legacy Kubernetes cluster to managed infrastructure. Until the cutover completes we are paying for both, roughly $18K/month of duplicate spend. The team expects to finish in Q4, which would take monthly infrastructure cost from about $46K to about $28K.',
    p_summary := 'Moving off the legacy cluster; ~$18K/month of duplicate spend until done.',
    p_labels := array['infrastructure', 'costs', 'engineering'],
    p_salience := 0.55,
    p_as_of := date '2026-09-18',
    p_provenance := '{"kind":"conversation","actor":"cto"}'::jsonb,
    p_recorded_at := timestamptz '2026-09-18T16:00:00Z'
  );

  perform public.semantic_block_revise(
    c, 'customer-acme', 'Customer concentration: Acme',
    'Acme accounts for roughly 18% of MRR, renewing in January. Their champion left in August and the new owner has not re-engaged. Losing them would cut MRR by about $31K/month and take roughly a month off runway. Nobody has yet been assigned to the relationship.',
    p_summary := 'Acme is ~18% of MRR and renews in January.',
    p_labels := array['customers', 'revenue', 'risk', 'concentration'],
    p_salience := 0.85,
    p_as_of := date '2026-09-22',
    p_provenance := '{"kind":"conversation","actor":"founder"}'::jsonb,
    p_recorded_at := timestamptz '2026-09-22T10:15:00Z'
  );

  -- The worked example: one topic, three understandings, in sequence.

  perform public.semantic_block_revise(
    c, 'hiring', 'Hiring',
    'We are reconsidering the two Q4 engineering hires and may only make one. The second is being weighed against how much runway we want to carry into the Series A conversations.',
    p_summary := 'Possibly one engineering hire in Q4, not two.',
    p_labels := array['hiring', 'headcount', 'engineering', 'runway'],
    p_salience := 0.80,
    p_as_of := date '2026-10-11',
    p_provenance := '{"kind":"conversation","actor":"founder"}'::jsonb,
    p_change_note := 'Narrowed from two hires to possibly one, pending runway.',
    p_recorded_at := timestamptz '2026-10-11T15:45:00Z'
  );

  perform public.semantic_block_revise(
    c, 'hiring', 'Hiring',
    'Engineering hiring is frozen until the Series A closes. Neither of the two Q4 platform hires will be made before then. The freeze is a deliberate runway decision, not a signal about the roadmap - the enterprise work is expected to ship with the current team. Backfills for departures are handled case by case and are not covered by the freeze.',
    p_summary := 'Engineering hiring is frozen until the Series A closes.',
    p_labels := array['hiring', 'headcount', 'engineering', 'runway', 'fundraising'],
    p_salience := 0.90,
    p_context_policy := 'always',
    p_as_of := date '2026-11-04',
    p_provenance := '{"kind":"conversation","actor":"founder"}'::jsonb,
    p_change_note := 'Hiring frozen until after the raise.',
    p_recorded_at := timestamptz '2026-11-04T09:30:00Z'
  );
end
$$;
