-- =============================================================================
--  STAGE 5C: BULK DATA FETCHING
--  Optimized indexes and nested JSON bulk retrieval for ZIP generation.
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PERFORMANCE INDEXES
-- -----------------------------------------------------------------------------
-- These indexes accelerate the payslip_master_view and bulk queries that
-- filter by run_id, month/year, or employee. Crucial for 100+ employee scale.

-- Fast lookup of line items by run
CREATE INDEX IF NOT EXISTS idx_line_items_run_id
    ON public.payroll_line_items (run_id);

-- Fast lookup of line items by employee (useful for individual payslip history)
CREATE INDEX IF NOT EXISTS idx_line_items_employee_id
    ON public.payroll_line_items (employee_id);

-- Composite index for the most common query pattern: all items in a specific run
CREATE INDEX IF NOT EXISTS idx_line_items_run_employee
    ON public.payroll_line_items (run_id, employee_id);

-- Fast lookup of runs by month/year (the gatekeeper function uses this)
CREATE INDEX IF NOT EXISTS idx_payroll_runs_month_year
    ON public.payroll_runs (month, year);


-- -----------------------------------------------------------------------------
-- 2. BULK PAYSLIP DATA FUNCTION (get_bulk_payslip_data)
-- -----------------------------------------------------------------------------
-- Returns a nested JSON object grouped by employee for a specific locked month.
-- Only serves locked runs to maintain financial audit integrity.
--
-- Response shape:
-- {
--   "run_id": "...",
--   "run_month": 3,
--   "run_year": 2026,
--   "locked_at": "...",
--   "company": {
--     "name": "PrintWorks Pvt. Ltd.",
--     "address": "...",
--     "logo_url": "..."
--   },
--   "employee_count": 8,
--   "payslips": [
--     {
--       "employee_id": "...",
--       "employee_name": "...",
--       "department": "...",
--       "designation": "...",
--       "time_metrics": { "expected_minutes": ..., "actual_minutes": ..., ... },
--       "financials": { "base_salary": ..., "ot_amount": ..., "net_payable": ... }
--     },
--     ...
--   ]
-- }
--
CREATE OR REPLACE FUNCTION public.get_bulk_payslip_data(p_month INT, p_year INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_run_id       UUID;
    v_locked_at    TIMESTAMPTZ;
    v_company      JSON;
    v_payslips     JSON;
    v_emp_count    INT;
    v_result       JSON;
BEGIN
    -- Step 1: Find the locked run for this month/year
    SELECT id, processed_at
      INTO v_run_id, v_locked_at
      FROM public.payroll_runs
     WHERE month  = p_month
       AND year   = p_year
       AND status = 'locked'
     LIMIT 1;

    -- Guard: If no locked run exists, return a clear error payload
    IF v_run_id IS NULL THEN
        RETURN json_build_object(
            'error',   TRUE,
            'message', format('No locked payroll run found for %s/%s. Lock the payroll first.', p_month, p_year)
        );
    END IF;

    -- Step 2: Fetch company branding (singleton)
    SELECT json_build_object(
        'name',    cs.company_name,
        'address', cs.address,
        'logo_url', cs.logo_url
    ) INTO v_company
    FROM public.company_settings cs
    WHERE cs.id = 1;

    -- Step 3: Build nested payslip array grouped by employee
    SELECT json_agg(
        json_build_object(
            'employee_id',   li.employee_id,
            'employee_name', li.employee_name,
            'department',    COALESCE(li.department, e.department),
            'designation',   COALESCE(li.designation, e.designation),
            'time_metrics',  json_build_object(
                'expected_minutes',  li.expected_minutes,
                'actual_minutes',    li.actual_minutes,
                'ot_minutes',        li.ot_minutes,
                'shortfall_minutes', li.shortfall_minutes
            ),
            'financials',    json_build_object(
                'base_salary',       li.base_salary,
                'ot_amount',         li.ot_amount,
                'shortfall_amount',  li.shortfall_amount,
                'advance_deducted',  li.advance_deducted,
                'gross_pay',         li.gross_pay,
                'net_payable',       li.net_payable
            )
        )
    ), COUNT(*)
    INTO v_payslips, v_emp_count
    FROM public.payroll_line_items li
    LEFT JOIN public.employees e ON li.employee_id = e.id
    WHERE li.run_id = v_run_id;

    -- Step 4: Assemble the final envelope
    v_result := json_build_object(
        'error',          FALSE,
        'run_id',         v_run_id,
        'run_month',      p_month,
        'run_year',       p_year,
        'locked_at',      v_locked_at,
        'company',        v_company,
        'employee_count', v_emp_count,
        'payslips',       COALESCE(v_payslips, '[]'::JSON)
    );

    RETURN v_result;
END;
$$;

-- Allow the frontend/API to call this via Supabase RPC
GRANT EXECUTE ON FUNCTION public.get_bulk_payslip_data(INT, INT) TO authenticated;

-- =============================================================================
-- STAGE 5C COMPLETE
--   ✓ Performance indexes created on payroll_line_items and payroll_runs
--   ✓ get_bulk_payslip_data(month, year) returns nested JSON envelope
--   ✓ Only locked runs are served (audit integrity enforced)
--   ✓ Company branding embedded for each bulk payload
--   ✓ Scales to 100+ employees in a single query (indexed lookups)
-- =============================================================================
