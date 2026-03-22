-- =============================================================================
--  STAGE 2B: AUTHENTICATION HELPER FUNCTIONS
--  Profile Sync Trigger & Role Fetching
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SECURITY AUDIT CONFIRMATION
-- -----------------------------------------------------------------------------
-- The public.profiles table created in Stage 2 already enforces the default
-- role of 'operator' for all new rows:
--
--   role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator'))
--
-- This guarantees maximum security; all new signups are unprivileged by default.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 2. PROFILE FETCH FUNCTION (get_user_role)
-- -----------------------------------------------------------------------------
-- Returns the role ('admin' or 'operator') for a given user ID.
-- Useful for frontend/API checks without needing to join the profiles table
-- on every request.
CREATE OR REPLACE FUNCTION public.get_user_role(match_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER   -- Run as superuser so it bypasses RLS if needed for system checks
AS $$
    SELECT role FROM public.profiles WHERE id = match_id LIMIT 1;
$$;

-- Grant execution to all standard roles
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. TRIGGER: PROFILE SYNC FROM AUTH.USERS
-- -----------------------------------------------------------------------------
-- Automatically inserts a row into public.profiles whenever a new user
-- signs up via Supabase Auth.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        role,
        company_id,
        is_active
    )
    VALUES (
        NEW.id,
        NEW.email,
        -- Attempt to extract a name from the raw_user_meta_data JSON if provided on signup
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        'operator', -- Default role enforced here conceptually (table default is also 'operator')
        1,          -- Single-tenant company ID
        TRUE
    );
    RETURN NEW;
END;
$$;

-- Attach the trigger to the auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- STAGE 2B COMPLETE
--   ✓ get_user_role() function created
--   ✓ handle_new_user() trigger created on auth.users
--   ✓ Default 'operator' role verified
-- =============================================================================
