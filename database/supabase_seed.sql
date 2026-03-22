-- =============================================================================
--  SALARY & ADVANCE TRACKER — Supabase Seed Data (Stage 1B)
--  Stage 1B | Generated: 2026-03-22
--
--  Run this in the Supabase SQL Editor or via Supabase CLI after running
--  the migration script.
--
--  Action:
--    Ensures the default company\_settings row (id = 1) exists and is seeded
--    with the initial branding data (PrintWorks Pvt. Ltd.) so the app
--    doesn't crash on first load.
-- =============================================================================

BEGIN;

-- Insert or update the singleton company_settings row (id = 1)
INSERT INTO public.company_settings (
    id,
    company_name,
    shift_start,
    shift_end
) VALUES (
    1,
    'PrintWorks Pvt. Ltd.',
    '09:00'::TIME,
    '18:00'::TIME
)
ON CONFLICT (id) DO UPDATE SET
    company_name = EXCLUDED.company_name,
    shift_start  = EXCLUDED.shift_start,
    shift_end    = EXCLUDED.shift_end,
    updated_at   = NOW();

COMMIT;

-- Note on logo_url:
-- The logo_url column allows NULL by design. It will remain NULL until
-- a user uploads a logo to the Supabase Storage bucket and the app updates
-- this row with the resulting public URL.
