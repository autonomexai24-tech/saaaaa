-- =============================================================================
--  STAGE 4C: UNIFIED PAYROLL GATEKEEPER
--  Smart routing: frozen snapshots for locked months, live math for drafts.
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- UNIFIED PAYROLL FUNCTION (get_unified_payroll)
-- -----------------------------------------------------------------------------
-- Returns a JSON object: { is_locked: boolean, data: [ ... ] }
-- 
-- The `data` array has an IDENTICAL schema regardless of source:
--   employee_id, name, department, designation, base_salary,
--   expected_minutes, actual_minutes, ot_minutes, shortfall_minutes,
--   ot_amount, penalty_amount, advance_deductions, gross_pay, net_payable
--
CREATE OR REPLACE FUNCTION public.get_unified_payroll(p_month INT, p_year INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_run_id    UUID;
    v_is_locked BOOLEAN := FALSE;
    v_data      JSON;
    v_result    JSON;
BEGIN
    -- Step 1: Check if a locked run exists for this month/year
    SELECT id INTO v_run_id
      FROM public.payroll_runs
     WHERE month = p_month
       AND year  = p_year
       AND status = 'locked'
     LIMIT 1;

    IF v_run_id IS NOT NULL THEN
        -- =====================================================================
        -- PATH A: LOCKED — Serve frozen data from payroll_line_items
        -- =====================================================================
        v_is_locked := TRUE;

        SELECT json_agg(
            json_build_object(
                'employee_id',       li.employee_id,
                'name',              li.employee_name,
                'department',        li.department,
                'designation',       li.designation,
                'base_salary',       li.base_salary,
                'expected_minutes',  li.expected_minutes,
                'actual_minutes',    li.actual_minutes,
                'ot_minutes',        li.ot_minutes,
                'shortfall_minutes', li.shortfall_minutes,
                'ot_amount',         li.ot_amount,
                'penalty_amount',    li.shortfall_amount,
                'advance_deductions',li.advance_deducted,
                'gross_pay',         li.gross_pay,
                'net_payable',       li.net_payable
            )
        ) INTO v_data
        FROM public.payroll_line_items li
        WHERE li.run_id = v_run_id;

    ELSE
        -- =====================================================================
        -- PATH B: DRAFT — Run live calculations from the engine
        -- =====================================================================
        v_is_locked := FALSE;

        -- get_payroll_summary already returns a JSON array with the exact same
        -- field names (employee_id, name, department, designation, base_salary,
        -- expected_minutes, actual_minutes, ot_minutes, shortfall_minutes,
        -- ot_amount, penalty_amount, advance_deductions, gross_pay, net_payable)
        v_data := public.get_payroll_summary(p_month, p_year);
    END IF;

    -- Step 2: Build the unified response envelope
    v_result := json_build_object(
        'is_locked', v_is_locked,
        'data',      COALESCE(v_data, '[]'::JSON)
    );

    RETURN v_result;
END;
$$;

-- Allow the frontend to call this via Supabase RPC
GRANT EXECUTE ON FUNCTION public.get_unified_payroll(INT, INT) TO authenticated;

-- =============================================================================
-- STAGE 4C COMPLETE
--   ✓ get_unified_payroll(month, year) function created
--   ✓ Locked months → serve frozen payroll_line_items (immutable history)
--   ✓ Draft months → serve live get_payroll_summary() calculations
--   ✓ JSON `data` array shape is IDENTICAL in both paths
--   ✓ Frontend can safely call one single RPC endpoint for all months
-- =============================================================================
