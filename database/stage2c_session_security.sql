-- =============================================================================
--  STAGE 2C: SESSION SECURITY & USER PROVISIONING
--  User creation procedure, active sessions, and strict payroll privacy
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. USER SESSIONS TABLE
-- -----------------------------------------------------------------------------
-- Tracks active logins and session metadata
CREATE TABLE IF NOT EXISTS public.user_sessions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT,
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE
);

-- RLS for user_sessions
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Admins can see all sessions, users can see their own
CREATE POLICY "Sessions viewable by owner or admin"
    ON public.user_sessions FOR SELECT
    USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "System can insert sessions"
    ON public.user_sessions FOR INSERT
    WITH CHECK (auth.role() = 'authenticated' AND auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- 2. CREATE SYSTEM USER (PROVISIONING LOGIC)
-- -----------------------------------------------------------------------------
-- A PostgreSQL stored procedure allowing Admins to securely provision new staff
-- logins without leaving the database layer. Note: In Supabase, creating users
-- directly in auth.users via SQL is restricted for non-superusers. This function 
-- is configured with SECURITY DEFINER to run with elevated privileges.
CREATE OR REPLACE FUNCTION public.create_system_user(
    p_email     TEXT,
    p_password  TEXT,
    p_full_name TEXT,
    p_role      TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    new_user_id UUID;
    encrypted_pw TEXT;
BEGIN
    -- Only active Admins can provision new users
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only administrators can provision users.';
    END IF;

    -- Enforce Role strictly
    IF p_role NOT IN ('admin', 'operator') THEN
        RAISE EXCEPTION 'Invalid role. Must be admin or operator.';
    END IF;

    -- Enforce Password Complexity (Minimum 8 chars)
    IF length(p_password) < 8 THEN
        RAISE EXCEPTION 'Password must be at least 8 characters long.';
    END IF;

    -- In a raw Postgres environment, we'd use crypt(). 
    -- Supabase auth.users handles its own hashing and salt, making raw SQL inserts 
    -- into auth.users complex. The standard Supabase way to create a user server-side 
    -- is via the Admin API.
    -- However, for the sake of completely database-hosted logic as requested, we
    -- simulate the underlying auth.users insert if running on a compatible PG setup:
    
    new_user_id := gen_random_uuid();
    encrypted_pw := crypt(p_password, gen_salt('bf'));

    INSERT INTO auth.users (
        id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data
    ) VALUES (
        new_user_id, '00000000-0000-0000-0000-000000000000', p_email, encrypted_pw, NOW(), 
        jsonb_build_object('full_name', p_full_name)
    );

    -- Notice: We do NOT need to manually insert into public.profiles here, 
    -- because the `handle_new_user()` trigger from Stage 2B will fire automatically 
    -- and create the profile! We just need to upgrade their role if they are an admin.
    
    IF p_role = 'admin' THEN
        UPDATE public.profiles 
           SET role = 'admin' 
         WHERE id = new_user_id;
    END IF;

    RETURN new_user_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. STRICT OPERATOR PRIVACY ON PAYROLL LINE ITEMS
-- -----------------------------------------------------------------------------
-- The original Stage 2 policies allowed all authenticated users to read `payroll_runs`
-- but we must strictly BLOCK operators from reading `payroll_line_items` to protect 
-- sensitive salary totals and deductions of their peers.

ALTER TABLE IF EXISTS public.payroll_line_items ENABLE ROW LEVEL SECURITY;

-- Drop any existing permissive select policies if they exist from prior tests
DROP POLICY IF EXISTS "Authenticated users can view payroll_line_items" ON public.payroll_line_items;

-- Re-create strict policy: ONLY Admins can see payroll mathematically line items
CREATE POLICY "Strict Admin Privacy: Read payroll_line_items"
    ON public.payroll_line_items FOR SELECT
    USING (public.is_admin());

CREATE POLICY "Strict Admin Privacy: Insert payroll_line_items"
    ON public.payroll_line_items FOR INSERT
    WITH CHECK (public.is_admin());

CREATE POLICY "Strict Admin Privacy: Update payroll_line_items"
    ON public.payroll_line_items FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Strict Admin Privacy: Delete payroll_line_items"
    ON public.payroll_line_items FOR DELETE
    USING (public.is_admin());

-- =============================================================================
-- STAGE 2C COMPLETE
--   ✓ user_sessions table active
--   ✓ create_system_user() procedure implements DB-tier provisioning + password checks
--   ✓ payroll_line_items strictly isolated to Admins via RLS
-- =============================================================================
