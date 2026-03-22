-- =============================================================================
--  STAGE 4A: MASTER PAYROLL CALCULATION ENGINE
--  Monthly math logic: OT, Shortfalls, Advances, and Net Payable via JSON.
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PAYROLL SUMMARY CALCULATION (get_payroll_summary)
-- -----------------------------------------------------------------------------
-- Takes a month and year, aggregates all logged minutes, computes expected
-- minutes based on company rules, applies explicit per-minute rates for OT 
-- vs Shortfall penalties, deducts pending advances, and outputs the final 
-- ledger for the frontend Payroll Engine as a JSON array.
--
CREATE OR REPLACE FUNCTION public.get_payroll_summary(p_month INT, p_year INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER  -- Allows safely querying across protected tables
AS $$
DECLARE
    v_standard_hours INT;
    v_result JSON;
BEGIN
    -- 1. Fetch global company rules (Assuming single-tenant id=1)
    SELECT standard_hours INTO v_standard_hours
      FROM public.company_settings 
     WHERE id = 1;

    -- If settings are missing, default to 8 standard hours
    IF v_standard_hours IS NULL THEN
        v_standard_hours := 8;
    END IF;

    -- 2. Massive Common Table Expression (CTE) to perform the math
    WITH employee_attendance AS (
        -- Aggregate actual minutes worked in the target month/year
        SELECT 
            employee_id,
            COALESCE(SUM(total_minutes), 0) AS actual_minutes
        FROM public.attendance_logs
        WHERE EXTRACT(MONTH FROM date) = p_month
          AND EXTRACT(YEAR FROM date) = p_year
        GROUP BY employee_id
    ),
    employee_advances AS (
        -- Aggregate pending advances (total debt to be recovered this period)
        SELECT 
            employee_id,
            COALESCE(SUM(amount), 0) AS pending_advance_amount
        FROM public.transactions
        WHERE type = 'advance' AND status = 'pending'
        GROUP BY employee_id
    ),
    payroll_base_math AS (
        -- Calculate the core minute-level thresholds and rates per employee
        SELECT 
            e.id AS employee_id,
            e.name,
            e.department,
            e.designation,
            e.monthly_basic,
            e.working_days_limit,
            
            -- Expected Minutes for the full month
            (v_standard_hours * 60 * e.working_days_limit) AS expected_minutes,
            
            -- Actual Minutes worked
            COALESCE(a.actual_minutes, 0) AS actual_minutes,
            
            -- Per-minute rate: (Monthly Basic) / (Expected Minutes in Month)
            (e.monthly_basic / NULLIF((e.working_days_limit * v_standard_hours * 60.0), 0)) AS per_minute_rate,
            
            -- Advance Debt
            COALESCE(adv.pending_advance_amount, 0) AS advance_deductions
        FROM public.employees e
        LEFT JOIN employee_attendance a ON e.id = a.employee_id
        LEFT JOIN employee_advances adv ON e.id = adv.employee_id
        WHERE e.is_active = TRUE
    ),
    payroll_differentials AS (
        -- Calculate OT and Shortfall Deltas ensuring we don't drop below 0
        SELECT *,
            GREATEST(0, actual_minutes - expected_minutes) AS ot_minutes,
            GREATEST(0, expected_minutes - actual_minutes) AS shortfall_minutes
        FROM payroll_base_math
    ),
    payroll_final AS (
        -- Final financial ledger mapping (Gross Pay and Net Payable)
        SELECT
            employee_id,
            name,
            department,
            designation,
            monthly_basic AS base_salary,
            actual_minutes,
            expected_minutes,
            ot_minutes,
            shortfall_minutes,
            
            -- Financial calculations (Rounded to 2 decimals for currency)
            ROUND((ot_minutes * per_minute_rate), 2) AS ot_amount,
            ROUND((shortfall_minutes * per_minute_rate), 2) AS penalty_amount,
            advance_deductions,
            
            -- Gross Pay = Base + OT - Penalty
            ROUND(
                monthly_basic 
                + (ot_minutes * per_minute_rate) 
                - (shortfall_minutes * per_minute_rate), 
            2) AS gross_pay,
            
            -- Net Payable = Gross Pay - Advance Deductions
            ROUND(
                (monthly_basic 
                + (ot_minutes * per_minute_rate) 
                - (shortfall_minutes * per_minute_rate)) 
                - advance_deductions, 
            2) AS net_payable
        FROM payroll_differentials
    )
    -- Aggregate all rows into a single JSON array to return to the frontend
    SELECT json_agg(row_to_json(payroll_final)) INTO v_result
    FROM payroll_final;

    -- Return the built JSON, or an empty array if there are no active employees
    RETURN COALESCE(v_result, '[]'::JSON);
END;
$$;

-- Grant execution to authenticated users (so the frontend Payroll Engine can call it via Supabase RPC)
GRANT EXECUTE ON FUNCTION public.get_payroll_summary(INT, INT) TO authenticated;

-- =============================================================================
-- STAGE 4A COMPLETE
--   ✓ get_payroll_summary(month, year) function created
--   ✓ Expected, OT, and Shortfall minutes mathematically isolated
--   ✓ Financials cast to NUMERIC mapping Gross and Net Payable accurately
--   ✓ Results properly formatted as a JSON array for easy frontend consumption
-- =============================================================================
