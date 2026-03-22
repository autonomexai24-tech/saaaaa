-- =============================================================================
--  STAGE 3C: ATTENDANCE STATUS & VALIDATION
--  Daily Status View and Advance Safety Trigger
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DATABASE VIEW: DAILY ATTENDANCE STATUS
-- -----------------------------------------------------------------------------
-- This view allows the frontend to easily query the attendance status of ALL 
-- active employees for any given date. If an employee hasn't clocked in, 
-- they still appear in the list with is_logged = false.
-- 
-- Usage on frontend: SELECT * FROM daily_attendance_status WHERE date = 'YYYY-MM-DD'
-- Note: A Postgres VIEW itself does not take parameters. To ensure we get a row 
-- for every active employee on the queried date, we need a slightly different approach:
-- an RPC (function returning a table) is the standard Postgres way to achieve this 
-- "left join against a specific parameter" dynamically. 
-- However, since the prompt specifies a "View" that handles dates dynamically, 
-- the standard technique is to CROSS JOIN a distinct list of dates with employees, 
-- THEN LEFT JOIN the logs.

DROP VIEW IF EXISTS public.daily_attendance_status;

CREATE OR REPLACE VIEW public.daily_attendance_status AS
WITH all_logged_dates AS (
    -- Get all unique dates that have at least one attendance log
    SELECT DISTINCT date FROM public.attendance_logs
)
SELECT 
    e.id AS employee_id,
    e.name AS employee_name,
    e.department,
    e.designation,
    d.date,
    -- If a log exists for this employee on this date, is_logged is true
    CASE WHEN a.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_logged,
    -- Fallback to 'absent' if no log exists
    COALESCE(a.status, 'absent') AS status,
    a.time_in,
    a.time_out,
    COALESCE(a.total_minutes, 0) AS total_minutes,
    COALESCE(a.late_minutes, 0) AS late_minutes
FROM 
    public.employees e
CROSS JOIN 
    all_logged_dates d
LEFT JOIN 
    public.attendance_logs a ON e.id = a.employee_id AND d.date = a.date
WHERE 
    e.is_active = TRUE;

-- -----------------------------------------------------------------------------
-- 2. ALTERNATIVE: RPC FUNCTION FOR EXACT DATE QUERYING (Highly Recommended)
-- -----------------------------------------------------------------------------
-- While the View above satisfies the requirement by cross-joining all known dates,
-- querying exactly ONE date (especially today, before anyone has logged anything)
-- is best handled by an RPC function. This guarantees the frontend gets a full list of
-- employees even if the date isn't in `attendance_logs` yet.

CREATE OR REPLACE FUNCTION public.get_daily_status(p_date DATE)
RETURNS TABLE (
    employee_id UUID,
    employee_name TEXT,
    department TEXT,
    designation TEXT,
    log_date    DATE,
    is_logged   BOOLEAN,
    status      TEXT,
    time_in     TIME,
    time_out    TIME,
    total_minutes INT
) 
LANGUAGE sql
STABLE
AS $$
    SELECT 
        e.id,
        e.name,
        e.department,
        e.designation,
        p_date AS log_date,
        CASE WHEN a.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_logged,
        COALESCE(a.status, 'absent') AS status,
        a.time_in,
        a.time_out,
        COALESCE(a.total_minutes, 0) AS total_minutes
    FROM 
        public.employees e
    LEFT JOIN 
        public.attendance_logs a ON e.id = a.employee_id AND a.date = p_date
    WHERE 
        e.is_active = TRUE
    ORDER BY 
        e.name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_status(DATE) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. SAFETY TRIGGER: PREVENT FUTURE-DATED ADVANCES
-- -----------------------------------------------------------------------------
-- Ensures advances cannot be post-dated to bypass immediate payroll recovery.
CREATE OR REPLACE FUNCTION public.validate_advance_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.type = 'advance' THEN
        IF NEW.date > CURRENT_DATE THEN
            RAISE EXCEPTION 'Advance transactions cannot be future-dated. Given date: %, Current date: %', NEW.date, CURRENT_DATE;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_future_advances ON public.transactions;
CREATE TRIGGER trg_prevent_future_advances
    BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.validate_advance_date();

-- =============================================================================
-- STAGE 3C COMPLETE
--   ✓ daily_attendance_status VIEW constructed (cross-join strategy)
--   ✓ get_daily_status(DATE) RPC added for optimal single-date querying
--   ✓ Future-dated advance prevention trigger active on transactions table
-- =============================================================================
