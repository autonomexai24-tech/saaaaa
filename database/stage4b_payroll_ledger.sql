-- =============================================================================
--  STAGE 4B: PAYROLL LEDGER & DATA LOCKING
--  Runs table, Line Items snapshot, and the Lock procedure
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PAYROLL RUNS TABLE
-- -----------------------------------------------------------------------------
-- Tracks each payroll processing event. A month/year can only be locked once.
CREATE TABLE IF NOT EXISTS public.payroll_runs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    month        INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
    year         INT         NOT NULL CHECK (year >= 2020),
    status       TEXT        NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'locked')),
    processed_at TIMESTAMPTZ,
    locked_by    UUID        REFERENCES public.profiles(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Critical: Prevent the same month/year from being locked more than once
    CONSTRAINT uq_payroll_run_month_year UNIQUE (month, year)
);

-- RLS
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view payroll_runs"
    ON public.payroll_runs FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage payroll_runs"
    ON public.payroll_runs FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());


-- -----------------------------------------------------------------------------
-- 2. PAYROLL LINE ITEMS TABLE
-- -----------------------------------------------------------------------------
-- Frozen snapshot of each employee's calculated salary for a specific run.
-- Once locked, these numbers never change even if attendance logs are edited.
CREATE TABLE IF NOT EXISTS public.payroll_line_items (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id             UUID        NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    employee_id        UUID        NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    employee_name      TEXT        NOT NULL,       -- Snapshot (name can change later)
    department         TEXT,                        -- Snapshot
    designation        TEXT,                        -- Snapshot
    base_salary        NUMERIC(12,2) NOT NULL,
    expected_minutes   INT           NOT NULL DEFAULT 0,
    actual_minutes     INT           NOT NULL DEFAULT 0,
    ot_minutes         INT           NOT NULL DEFAULT 0,
    shortfall_minutes  INT           NOT NULL DEFAULT 0,
    ot_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    shortfall_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    advance_deducted   NUMERIC(12,2) NOT NULL DEFAULT 0,
    gross_pay          NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_payable        NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One line item per employee per run
    CONSTRAINT uq_line_item_employee_run UNIQUE (run_id, employee_id)
);

-- RLS: Only admins can see payroll details (operator privacy from Stage 2C)
ALTER TABLE public.payroll_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view payroll_line_items"
    ON public.payroll_line_items FOR SELECT
    USING (public.is_admin());

CREATE POLICY "Admins can manage payroll_line_items"
    ON public.payroll_line_items FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());


-- -----------------------------------------------------------------------------
-- 3. LOCK PAYROLL RUN PROCEDURE
-- -----------------------------------------------------------------------------
-- This is the critical "freeze" function. It:
--   1. Creates a payroll_runs entry marked 'locked'
--   2. Runs get_payroll_summary() to get the exact calculations
--   3. Inserts the results as frozen snapshots into payroll_line_items
--   4. Marks all 'pending' advances for those employees as 'processed'
--
CREATE OR REPLACE FUNCTION public.lock_payroll_run(
    p_month   INT,
    p_year    INT,
    p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_run_id       UUID;
    v_summary      JSON;
    v_item         JSON;
    v_standard_hrs INT;
BEGIN
    -- Guard: Only admins can lock payroll
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only administrators can lock payroll runs.';
    END IF;

    -- Guard: Check if this month/year is already locked
    IF EXISTS (SELECT 1 FROM public.payroll_runs WHERE month = p_month AND year = p_year AND status = 'locked') THEN
        RAISE EXCEPTION 'Payroll for %/% is already locked. Cannot lock again.', p_month, p_year;
    END IF;

    -- Step 1: Create the payroll run entry
    INSERT INTO public.payroll_runs (month, year, status, processed_at, locked_by)
    VALUES (p_month, p_year, 'locked', NOW(), p_user_id)
    ON CONFLICT (month, year) DO UPDATE SET
        status       = 'locked',
        processed_at = NOW(),
        locked_by    = p_user_id
    RETURNING id INTO v_run_id;

    -- Step 2: Execute the payroll engine to get current calculations
    v_summary := public.get_payroll_summary(p_month, p_year);

    -- Fetch standard hours for expected_minutes calculation
    SELECT standard_hours INTO v_standard_hrs FROM public.company_settings WHERE id = 1;
    IF v_standard_hrs IS NULL THEN v_standard_hrs := 8; END IF;

    -- Step 3: Insert each employee's result as a frozen line item
    FOR v_item IN SELECT * FROM json_array_elements(v_summary)
    LOOP
        INSERT INTO public.payroll_line_items (
            run_id,
            employee_id,
            employee_name,
            department,
            designation,
            base_salary,
            expected_minutes,
            actual_minutes,
            ot_minutes,
            shortfall_minutes,
            ot_amount,
            shortfall_amount,
            advance_deducted,
            gross_pay,
            net_payable
        ) VALUES (
            v_run_id,
            (v_item->>'employee_id')::UUID,
            v_item->>'name',
            v_item->>'department',
            v_item->>'designation',
            (v_item->>'base_salary')::NUMERIC,
            (v_item->>'expected_minutes')::INT,
            (v_item->>'actual_minutes')::INT,
            (v_item->>'ot_minutes')::INT,
            (v_item->>'shortfall_minutes')::INT,
            (v_item->>'ot_amount')::NUMERIC,
            (v_item->>'penalty_amount')::NUMERIC,
            (v_item->>'advance_deductions')::NUMERIC,
            (v_item->>'gross_pay')::NUMERIC,
            (v_item->>'net_payable')::NUMERIC
        )
        ON CONFLICT (run_id, employee_id) DO UPDATE SET
            employee_name     = EXCLUDED.employee_name,
            base_salary       = EXCLUDED.base_salary,
            expected_minutes  = EXCLUDED.expected_minutes,
            actual_minutes    = EXCLUDED.actual_minutes,
            ot_minutes        = EXCLUDED.ot_minutes,
            shortfall_minutes = EXCLUDED.shortfall_minutes,
            ot_amount         = EXCLUDED.ot_amount,
            shortfall_amount  = EXCLUDED.shortfall_amount,
            advance_deducted  = EXCLUDED.advance_deducted,
            gross_pay         = EXCLUDED.gross_pay,
            net_payable       = EXCLUDED.net_payable;

        -- Step 4: Mark this employee's pending advances as 'processed'
        UPDATE public.transactions
           SET status = 'processed',
               updated_at = NOW()
         WHERE employee_id = (v_item->>'employee_id')::UUID
           AND type = 'advance'
           AND status = 'pending';
    END LOOP;

    RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_payroll_run(INT, INT, UUID) TO authenticated;

-- =============================================================================
-- STAGE 4B COMPLETE
--   ✓ payroll_runs table created (UNIQUE month/year constraint active)
--   ✓ payroll_line_items table created (frozen snapshots)
--   ✓ lock_payroll_run() function chains calculation → snapshot → advance recovery
--   ✓ Advance status correctly transitions from 'pending' → 'processed' on lock
-- =============================================================================
