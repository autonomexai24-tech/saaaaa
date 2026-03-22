-- =============================================================================
--  STAGE 3A: ATTENDANCE DATA LOGIC
--  High-frequency logging, UPSERTs, and automated status validation
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. VALIDATION TRIGGER: Ensure time_out > time_in
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_attendance_times()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.time_in IS NOT NULL AND NEW.time_out IS NOT NULL THEN
        IF NEW.time_out <= NEW.time_in THEN
            RAISE EXCEPTION 'time_out (%) must be later than time_in (%)', NEW.time_out, NEW.time_in;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_time_check ON public.attendance_logs;
CREATE TRIGGER trg_attendance_time_check
    BEFORE INSERT OR UPDATE ON public.attendance_logs
    FOR EACH ROW EXECUTE FUNCTION public.validate_attendance_times();


-- -----------------------------------------------------------------------------
-- 2. AUTOMATION TRIGGER: Calculate Status ('present' | 'late' | 'absent')
-- -----------------------------------------------------------------------------
-- This re-introduces the server-side late calculation logic you requested.
-- It fetches shift_start and grace_period from company_settings.
CREATE OR REPLACE FUNCTION public.calculate_attendance_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_shift_start TIME;
    v_grace       INT;
    v_total_mins  INT;
BEGIN
    -- If no time_in is logged yet via an upsert (which is rare but possible),
    -- default to absent until recorded.
    IF NEW.time_in IS NULL THEN
        NEW.status := 'absent';
        NEW.total_minutes := 0;
        RETURN NEW;
    END IF;

    -- Fetch global company rules (assuming single tenant id=1)
    SELECT shift_start, grace_period_mins 
      INTO v_shift_start, v_grace
      FROM public.company_settings 
     WHERE id = 1;

    -- 1. Calculate Status
    -- If time_in is after (shift_start + grace_period minutes), mark as late
    IF NEW.time_in > (v_shift_start + (v_grace || ' minutes')::INTERVAL) THEN
        NEW.status := 'late';
    ELSE
        NEW.status := 'present';
    END IF;

    -- 2. Auto-calculate total_minutes if both times are present
    IF NEW.time_out IS NOT NULL THEN
        v_total_mins := EXTRACT(EPOCH FROM (NEW.time_out - NEW.time_in)) / 60;
        NEW.total_minutes := v_total_mins;
    ELSE
        NEW.total_minutes := 0; -- clocked in, but hasn't clocked out yet
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_status_calc ON public.attendance_logs;
CREATE TRIGGER trg_attendance_status_calc
    BEFORE INSERT OR UPDATE ON public.attendance_logs
    FOR EACH ROW EXECUTE FUNCTION public.calculate_attendance_status();


-- -----------------------------------------------------------------------------
-- 3. ATTENDANCE UPSERT FUNCTION (Returns JSON)
-- -----------------------------------------------------------------------------
-- Allows the frontend to make a single RPC call to log attendance. 
-- If an entry for (employee_id, date) already exists, it updates it. 
-- Otherwise, it inserts a new row. Returns the full row as JSON.
CREATE OR REPLACE FUNCTION public.log_attendance(
    p_employee_id UUID,
    p_date        DATE,
    p_time_in     TIME,
    p_time_out    TIME DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER   -- Ensure it can perform the UPSERT safely
AS $$
DECLARE
    v_result RECORD;
BEGIN
    INSERT INTO public.attendance_logs (employee_id, date, time_in, time_out)
    VALUES (p_employee_id, p_date, p_time_in, p_time_out)
    ON CONFLICT (employee_id, date) 
    DO UPDATE SET
        time_in    = COALESCE(EXCLUDED.time_in, public.attendance_logs.time_in),
        time_out   = EXCLUDED.time_out,
        updated_at = NOW()
    RETURNING * INTO v_result;

    -- Convert the raw RECORD into JSON for the frontend
    RETURN row_to_json(v_result);
END;
$$;

-- Note: Because we use row_level_security on attendance_logs, and this function
-- is SECURITY DEFINER, we should optionally restrict who can execute it based on your needs.
-- Normally operators log attendance:
GRANT EXECUTE ON FUNCTION public.log_attendance(UUID, DATE, TIME, TIME) TO authenticated;

-- =============================================================================
-- STAGE 3A COMPLETE
--   ✓ time_out > time_in validation trigger applied
--   ✓ Auto-status ('late', 'present') trigger applied + total_minutes calculated
--   ✓ log_attendance() UPSERT RPC created returning JSON
-- =============================================================================
