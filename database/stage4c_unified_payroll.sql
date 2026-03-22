-- =============================================================================
--  STAGE 4C: UNIFIED PAYROLL GATEKEEPER
--  Smart routing: frozen snapshots for locked months, live math for drafts.
--
--  Run this script in the Supabase SQL Editor or psql.
-- =============================================================================

-- Drop existing version to ensure a clean replace
DROP FUNCTION IF EXISTS get_unified_payroll(INT, INT);

-- -----------------------------------------------------------------------------
-- UNIFIED PAYROLL FUNCTION (get_unified_payroll)
-- -----------------------------------------------------------------------------
-- Returns a JSON object: { is_locked: boolean, run_id: int|null, data: [...] }
--
-- The `data` array has an IDENTICAL column schema regardless of source:
--   employee_id, emp_code, name, avatar, department, designation,
--   base_salary, standard_hours, hours_logged, hourly_rate, paid_leaves,
--   ot_hours, ot_pay, bonus, short_hours, short_deduction,
--   late_penalty, advances_taken, professional_tax, fines,
--   gross_earnings, total_deductions, net_payable, leave_balance_snap
--
CREATE OR REPLACE FUNCTION get_unified_payroll(p_month INT, p_year INT)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_run_id    INT;
    v_status    TEXT;
    v_is_locked BOOLEAN := FALSE;
    v_data      JSON;
    v_result    JSON;
BEGIN
    -- Step 1: Check if a payroll run exists for this month/year
    SELECT id, status
      INTO v_run_id, v_status
      FROM payroll_runs
     WHERE period_year  = p_year
       AND period_month = p_month
     LIMIT 1;

    IF v_run_id IS NOT NULL AND v_status IN ('locked', 'approved') THEN
        -- =====================================================================
        -- PATH A: LOCKED — Serve frozen data from payroll_line_items
        --   No recalculation. Data is immutable historical record.
        -- =====================================================================
        v_is_locked := TRUE;

        SELECT COALESCE(json_agg(row_data ORDER BY (row_data->>'name')), '[]'::JSON)
          INTO v_data
          FROM (
            SELECT json_build_object(
                'employee_id',       pli.employee_id,
                'emp_code',          e.emp_code,
                'name',              e.name,
                'avatar',            UPPER(
                                       SUBSTRING(e.name FROM 1 FOR 1) ||
                                       COALESCE(SUBSTRING(e.name FROM POSITION(' ' IN e.name) + 1 FOR 1), '')
                                     ),
                'department',        d.name,
                'designation',       des.name,
                'base_salary',       pli.base_salary,
                'standard_hours',    pli.standard_hours,
                'hours_logged',      pli.hours_logged,
                'hourly_rate',       pli.hourly_rate,
                'paid_leaves',       pli.paid_leaves,
                'ot_hours',          pli.ot_hours,
                'ot_pay',            pli.ot_pay,
                'bonus',             pli.bonus,
                'short_hours',       pli.short_hours,
                'short_deduction',   pli.short_deduction,
                'late_penalty',      pli.late_penalty,
                'advances_taken',    pli.advances_taken,
                'professional_tax',  pli.professional_tax,
                'fines',             pli.fines,
                'gross_earnings',    pli.gross_earnings,
                'total_deductions',  pli.total_deductions,
                'net_payable',       pli.net_payable,
                'leave_balance_snap',pli.leave_balance_snap
            ) AS row_data
            FROM payroll_line_items pli
            JOIN employees     e   ON e.id   = pli.employee_id
            LEFT JOIN departments  d   ON d.id   = e.department_id
            LEFT JOIN designations des ON des.id = e.designation_id
            WHERE pli.payroll_run_id = v_run_id
          ) sub;

    ELSE
        -- =====================================================================
        -- PATH B: DRAFT — Run live calculations via calculate_payroll_for_employee
        --   Creates/updates a draft payroll_run and fills payroll_line_items,
        --   then returns the freshly computed data.
        -- =====================================================================
        v_is_locked := FALSE;

        -- Ensure a draft run exists
        IF v_run_id IS NULL THEN
            INSERT INTO payroll_runs (period_year, period_month, status)
            VALUES (p_year, p_month, 'draft')
            ON CONFLICT (period_year, period_month) DO UPDATE SET period_year = EXCLUDED.period_year
            RETURNING id INTO v_run_id;
        END IF;

        -- Recalculate every active employee
        PERFORM calculate_payroll_for_employee(v_run_id, e.id)
          FROM employees e
         WHERE e.is_active = TRUE;

        -- Fetch the freshly calculated data in the same shape as PATH A
        SELECT COALESCE(json_agg(row_data ORDER BY (row_data->>'name')), '[]'::JSON)
          INTO v_data
          FROM (
            SELECT json_build_object(
                'employee_id',       pli.employee_id,
                'emp_code',          e.emp_code,
                'name',              e.name,
                'avatar',            UPPER(
                                       SUBSTRING(e.name FROM 1 FOR 1) ||
                                       COALESCE(SUBSTRING(e.name FROM POSITION(' ' IN e.name) + 1 FOR 1), '')
                                     ),
                'department',        d.name,
                'designation',       des.name,
                'base_salary',       pli.base_salary,
                'standard_hours',    pli.standard_hours,
                'hours_logged',      pli.hours_logged,
                'hourly_rate',       pli.hourly_rate,
                'paid_leaves',       pli.paid_leaves,
                'ot_hours',          pli.ot_hours,
                'ot_pay',            pli.ot_pay,
                'bonus',             pli.bonus,
                'short_hours',       pli.short_hours,
                'short_deduction',   pli.short_deduction,
                'late_penalty',      pli.late_penalty,
                'advances_taken',    pli.advances_taken,
                'professional_tax',  pli.professional_tax,
                'fines',             pli.fines,
                'gross_earnings',    pli.gross_earnings,
                'total_deductions',  pli.total_deductions,
                'net_payable',       pli.net_payable,
                'leave_balance_snap',pli.leave_balance_snap
            ) AS row_data
            FROM payroll_line_items pli
            JOIN employees     e   ON e.id   = pli.employee_id
            LEFT JOIN departments  d   ON d.id   = e.department_id
            LEFT JOIN designations des ON des.id = e.designation_id
            WHERE pli.payroll_run_id = v_run_id
          ) sub;

    END IF;

    -- Step 2: Build the unified response envelope
    v_result := json_build_object(
        'is_locked', v_is_locked,
        'run_id',    v_run_id,
        'data',      COALESCE(v_data, '[]'::JSON)
    );

    RETURN v_result;
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION get_unified_payroll(INT, INT) TO app_user;

-- =============================================================================
-- STAGE 4C COMPLETE
--   ✓ get_unified_payroll(month, year) function created
--   ✓ Locked months → serve frozen payroll_line_items (immutable history)
--   ✓ Draft months → run calculate_payroll_for_employee() then serve results
--   ✓ JSON `data` array shape is IDENTICAL in both paths
--   ✓ Returns { is_locked, run_id, data[] } envelope
-- =============================================================================
