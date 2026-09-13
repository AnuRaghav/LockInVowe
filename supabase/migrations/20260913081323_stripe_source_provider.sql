-- Adds Stripe as a Source Layer provider.
--
-- `ALTER TYPE ... ADD VALUE` cannot run in the same transaction as a statement
-- that uses the new value, so this stays its own migration rather than folding
-- into 20260913071500_source_layer.sql.
alter type public.source_provider add value 'stripe';
