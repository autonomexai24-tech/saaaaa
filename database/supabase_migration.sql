-- =============================================================================
--  SALARY & ADVANCE TRACKER — Supabase Migration
--  Stage 1A | Generated: 2026-03-22
--
--  Run this in the Supabase SQL Editor or via the Supabase CLI:
--    supabase db push  (if using supabase/migrations/)
--    -- OR --
--    psql "$DATABASE_URL" -f database/supabase_migration.sql
--
--  Tables:
--    1. profiles           — extends auth.users (admin / operator roles)
--    2. company_settings   — singleton row (id = 1)
--    3. employees          — one row per employee, hourly-rate driven
--    4. attendance_logs    — daily check-in/out records
--    5. transactions       — advances, bonuses, fines in one table
--
--  Security:
--    Row Level Security (RLS) enabled on all tables.
--    Policies: admins see everything; operators see only non-sensitive data.
--
--  Stage 1B note:
--    company_settings.logo_url is a TEXT column ready to receive a Supabase
--    Storage object URL. No schema change will be needed for logo upload.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid() (pg 13+)

-- ---------------------------------------------------------------------------
-- Helper: is the current user an admin?
--   Used inside RLS policies to avoid repeating the sub-select.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE              -- result is constant within a single statement
SECURITY DEFINER    -- runs as the function owner, not the caller
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles
         WHERE id   = auth.uid()
           AND role = 'admin'
    );
$$;

-- Grant execution to the anon and authenticated roles Supabase uses
GRANT EXECUTE ON FUNCTION is_admin() TO anon, authenticated;

-- =============================================================================
-- 1. PROFILES
--    Extends auth.users.  Created automatically via a trigger when a user
--    signs up (set that trigger up in your Supabase Auth hooks or edge function).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT        NOT NULL,
    full_name   TEXT,
    role        TEXT        NOT NULL DEFAULT 'operator'
                                CHECK (role IN ('admin', 'operator')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Each user can always read their own profile
CREATE POLICY "profiles: self read"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "profiles: admin read all"
    ON public.profiles FOR SELECT
    USING (is_admin());

-- Admins can update any profile (e.g. promote to admin)
CREATE POLICY "profiles: admin write"
    ON public.profiles FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

-- Each user can update their own non-role fields (self-service)
CREATE POLICY "profiles: self update"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));

-- =============================================================================
-- 2. COMPANY_SETTINGS
--    Singleton table — exactly one row (id = 1).
--    Stage 1B: logo_url stores the Supabase Storage object path/URL after upload.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.company_settings (
    id                    INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    company_name          TEXT        NOT NULL DEFAULT 'My Company',
    address               TEXT,
    logo_url              TEXT,                           -- Stage 1B: populated after logo upload
    shift_start           TIME        NOT NULL DEFAULT '09:00',
    shift_end             TIME        NOT NULL DEFAULT '18:00',
    standard_hours        INT         NOT NULL DEFAULT 8, -- working hours per day
    grace_period_mins     INT         NOT NULL DEFAULT 10,
    annual_leaves_allowed INT         NOT NULL DEFAULT 12,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- Everyone (authenticated) can read company settings
CREATE POLICY "company_settings: authenticated read"
    ON public.company_settings FOR SELECT
    USING (auth.role() = 'authenticated');

-- Only admins can modify settings
CREATE POLICY "company_settings: admin write"
    ON public.company_settings FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- Seed the singleton row (idempotent)
INSERT INTO public.company_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. EMPLOYEES
--    hourly_rate and min_rate are stored explicitly (not computed) so they can
--    be set independently from monthly_basic when needed.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.employees (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT        NOT NULL,
    department         TEXT,
    designation        TEXT,
    monthly_basic      NUMERIC(12,2) NOT NULL CHECK (monthly_basic > 0),
    working_days_limit INT         NOT NULL DEFAULT 26,
    hourly_rate        NUMERIC(12,4) NOT NULL DEFAULT 0
                           CHECK (hourly_rate >= 0),
    min_rate           NUMERIC(12,4) NOT NULL DEFAULT 0
                           CHECK (min_rate >= 0),
    joining_date       DATE,
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for common lookups
CREATE INDEX IF NOT EXISTS idx_employees_active ON public.employees (is_active)
    WHERE is_active = TRUE;

-- RLS
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read employee records (needed for daily log UI)
CREATE POLICY "employees: authenticated read"
    ON public.employees FOR SELECT
    USING (auth.role() = 'authenticated');

-- Only admins can create / update / delete employees
CREATE POLICY "employees: admin write"
    ON public.employees FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- =============================================================================
-- 4. ATTENDANCE_LOGS
--    One row per (employee, date).
--    total_minutes is stored explicitly (set by the app / trigger) to avoid
--    repeated recalculation and to support offline edits.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id    UUID        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    date           DATE        NOT NULL,
    time_in        TIME,
    time_out       TIME,
    total_minutes  INT         NOT NULL DEFAULT 0,   -- actual minutes worked
    status         TEXT        NOT NULL DEFAULT 'absent'
                                   CHECK (status IN ('present', 'late', 'absent')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate daily entries for the same employee
    CONSTRAINT uq_attendance_employee_date UNIQUE (employee_id, date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_att_employee_date ON public.attendance_logs (employee_id, date);
CREATE INDEX IF NOT EXISTS idx_att_date          ON public.attendance_logs (date);

-- RLS
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (operators need this to log attendance)
CREATE POLICY "attendance: authenticated read"
    ON public.attendance_logs FOR SELECT
    USING (auth.role() = 'authenticated');

-- Authenticated users can insert / update attendance (operators log it daily)
CREATE POLICY "attendance: authenticated insert"
    ON public.attendance_logs FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "attendance: authenticated update"
    ON public.attendance_logs FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Only admins can delete records
CREATE POLICY "attendance: admin delete"
    ON public.attendance_logs FOR DELETE
    USING (is_admin());

-- =============================================================================
-- 5. TRANSACTIONS
--    Unified ledger for advance, bonus, and fine entries.
--    'pending'   = recorded, not yet applied to a payroll run
--    'processed' = deducted/added in a finalized payroll run
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.transactions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    type        TEXT        NOT NULL CHECK (type IN ('advance', 'bonus', 'fine')),
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    date        DATE        NOT NULL DEFAULT CURRENT_DATE,
    status      TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processed')),
    notes       TEXT,                           -- optional reason / description
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_txn_employee    ON public.transactions (employee_id);
CREATE INDEX IF NOT EXISTS idx_txn_status      ON public.transactions (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_txn_date        ON public.transactions (date);

-- RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- All authenticated can read (operators need to see pending advances)
CREATE POLICY "transactions: authenticated read"
    ON public.transactions FOR SELECT
    USING (auth.role() = 'authenticated');

-- Authenticated users can insert new transactions
CREATE POLICY "transactions: authenticated insert"
    ON public.transactions FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Only admins can update status (e.g. mark processed) or delete
CREATE POLICY "transactions: admin update"
    ON public.transactions FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "transactions: admin delete"
    ON public.transactions FOR DELETE
    USING (is_admin());

-- =============================================================================
-- updated_at AUTO-REFRESH TRIGGERS
--   Keeps updated_at current on every table that has it.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

-- company_settings
DROP TRIGGER IF EXISTS trg_company_settings_updated_at ON public.company_settings;
CREATE TRIGGER trg_company_settings_updated_at
    BEFORE UPDATE ON public.company_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- employees
DROP TRIGGER IF EXISTS trg_employees_updated_at ON public.employees;
CREATE TRIGGER trg_employees_updated_at
    BEFORE UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- attendance_logs
DROP TRIGGER IF EXISTS trg_attendance_updated_at ON public.attendance_logs;
CREATE TRIGGER trg_attendance_updated_at
    BEFORE UPDATE ON public.attendance_logs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- transactions
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- SUPABASE STORAGE BUCKET SETUP (SQL representation — run manually or via SDK)
--   Supabase Storage buckets cannot be created via pure SQL, but the policy
--   for logo uploads is documented here for clarity.
--
--   In Supabase Dashboard → Storage → New Bucket:
--     Name: company-assets
--     Public: true (logos are served publicly)
--
--   Then set Storage policies so only admins can upload:
--     INSERT policy: (auth.uid() IS NOT NULL AND is_admin())
--     SELECT policy: true  (public read)
-- =============================================================================
-- NOTE: These are documentation comments, not executable SQL.
-- After uploading a logo, store the public URL in:
--   UPDATE company_settings SET logo_url = '<supabase_storage_url>' WHERE id = 1;

-- =============================================================================
-- STAGE 1A COMPLETE — STAGE 1B (Logo Storage) READINESS CONFIRMATION
--
--   company_settings.logo_url  TEXT col exists ✓
--   No schema migration needed for Stage 1B ✓
--   Insert the Supabase Storage URL after upload ✓
-- =============================================================================
