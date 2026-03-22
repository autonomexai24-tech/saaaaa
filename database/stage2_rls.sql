-- =============================================================================
--  STAGE 2: AUTHENTICATION & SECURITY SETUP
--  Role-Based Access Control (RBAC) & Row-Level Security (RLS)
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PROFILES TABLE (Linked to Supabase Auth)
-- -----------------------------------------------------------------------------
-- Type definition from src/types/database.types.ts: UserRole = "admin" | "operator"
CREATE TYPE user_role AS ENUM ('admin', 'operator');

CREATE TABLE IF NOT EXISTS public.profiles (
    id          UUID      PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT      NOT NULL,
    full_name   TEXT,
    role        TEXT      NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
    company_id  INT       NOT NULL DEFAULT 1 CHECK (company_id = 1), -- Single tenant
    is_active   BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Turn on RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Profiles are viewable by all authenticated users"
    ON public.profiles FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own non-role fields"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));


-- -----------------------------------------------------------------------------
-- 2. is_admin() HELPER FUNCTION
-- -----------------------------------------------------------------------------
-- A secure, fast way to check if the current user is an admin without
-- writing sub-queries in every single policy.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles
         WHERE id = auth.uid()
           AND role = 'admin'
           AND is_active = TRUE
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. ENABLE ROW LEVEL SECURITY ON SENSITIVE TABLES
-- -----------------------------------------------------------------------------
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 4. READ POLICIES (All authenticated users can read data)
-- -----------------------------------------------------------------------------
CREATE POLICY "Authenticated users can view employees"
    ON public.employees FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view attendance_logs"
    ON public.attendance_logs FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view advance_transactions"
    ON public.advance_transactions FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view payroll_runs"
    ON public.payroll_runs FOR SELECT USING (auth.role() = 'authenticated');


-- -----------------------------------------------------------------------------
-- 5. WRITE POLICIES (Admin Only for specific tables)
-- -----------------------------------------------------------------------------

-- EMPLOYEES: Only Admins can INSERT, UPDATE, DELETE
CREATE POLICY "Admins can insert employees"
    ON public.employees FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update employees"
    ON public.employees FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete employees"
    ON public.employees FOR DELETE USING (public.is_admin());


-- PAYROLL_RUNS: Only Admins can INSERT, UPDATE, DELETE
CREATE POLICY "Admins can insert payroll_runs"
    ON public.payroll_runs FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update payroll_runs"
    ON public.payroll_runs FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete payroll_runs"
    ON public.payroll_runs FOR DELETE USING (public.is_admin());


-- Note: attendance_logs and advance_transactions insert/update policies 
-- are left to standard operators (since daily operators log attendance).
-- If you want ONLY admins to write to attendance/advances, copy the admin policies above.


-- -----------------------------------------------------------------------------
-- 6. MANUAL ADMIN PROMOTION SCRIPT (TESTING)
-- -----------------------------------------------------------------------------
/*
  HOW TO USE:
  1. Sign up a new user via the app frontend or Supabase Auth UI.
  2. A new row will normally be created in `auth.users`, but you must ensure it
     also synced to `public.profiles`. (Usually done via an Auth Trigger).
  3. Replace 'your-email@example.com' below with the actual email you used.
  4. Run the code snippet below in the SQL Editor.
*/

/*
UPDATE public.profiles
   SET role = 'admin'
 WHERE email = 'your-email@example.com';
*/
