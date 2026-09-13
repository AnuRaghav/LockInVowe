-- What the company is, in the founder's words.
--
-- `name` was written as a placeholder ("Development company") by the onboarding
-- save, because the column was required and nothing asked for a real one. The
-- onboarding interview now does, so the column stops pretending: null means the
-- founder has not told us yet.
alter table public.companies
  alter column name drop not null;

-- One or two sentences: what the company sells, and to whom. The fuller account
-- lives in the `company-overview` semantic block; this is for display.
alter table public.companies
  add column description text;

update public.companies
set name = null
where name = 'Development company';
