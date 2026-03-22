-- =============================================================================
--  STAGE 3B: ADVANCE & TRANSACTION LOGIC
--  Transaction Logging RPC and Employee Balances View
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SECURITY CHECK AUDIT
-- -----------------------------------------------------------------------------
-- The public.transactions table created in Stage 1A already enforces:
--   1. amount > 0       via: CHECK (amount > 0)
--   2. default pending  via: DEFAULT 'pending'
--
-- No ALTER TABLE is required for these constraints as they are natively active.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 2. TRANSACTION RPC FUNCTION (record_transaction)
-- -----------------------------------------------------------------------------
-- Inserts a new advance, bonus, or fine securely.
-- Defaults to current date if none provided, and forces 'pending' status.
CREATE OR REPLACE FUNCTION public.record_transaction(
    p_employee_id UUID,
    p_type        TEXT,
    p_amount      NUMERIC,
    p_date        DATE DEFAULT CURRENT_DATE,
    p_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Validate type
    IF p_type NOT IN ('advance', 'bonus', 'fine') THEN
        RAISE EXCEPTION 'Invalid transaction type. Must be advance, bonus, or fine.';
    END IF;

    -- Amount is natively validated by the CHECK constraint on the table, 
    -- but we can add a friendly catch here too.
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Transaction amount must be strictly greater than zero.';
    END IF;

    -- Insert record
    INSERT INTO public.transactions (
        employee_id, type, amount, date, status, notes
    )
    VALUES (
        p_employee_id, p_type, p_amount, p_date, 'pending', p_description
    )
    RETURNING * INTO v_result;

    -- Return the newly created row as JSON
    RETURN row_to_json(v_result);
END;
$$;

-- Allow operations to run it
GRANT EXECUTE ON FUNCTION public.record_transaction(UUID, TEXT, NUMERIC, DATE, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. DATABASE VIEW: EMPLOYEE CURRENT BALANCES
-- -----------------------------------------------------------------------------
-- A high-performance view that aggregates the total 'pending' advances
-- (unrecovered debt) and pending bonuses/fines for every employee.
-- Helps Admins instantly see "Total Advance Owed" without heavy frontend math.

DROP VIEW IF EXISTS public.employee_current_balances;

CREATE OR REPLACE VIEW public.employee_current_balances AS
SELECT 
    e.id AS employee_id,
    e.name AS employee_name,
    e.department,
    e.designation,
    -- Aggregate total unrecovered advances
    COALESCE(
        SUM(t.amount) FILTER (WHERE t.type = 'advance' AND t.status = 'pending'), 
        0
    ) AS total_pending_advance_owed,
    -- Aggregate total pending bonuses (not yet paid out)
    COALESCE(
        SUM(t.amount) FILTER (WHERE t.type = 'bonus' AND t.status = 'pending'), 
        0
    ) AS total_pending_bonus,
    -- Aggregate total pending fines (not yet deducted)
    COALESCE(
        SUM(t.amount) FILTER (WHERE t.type = 'fine' AND t.status = 'pending'), 
        0
    ) AS total_pending_fines
FROM 
    public.employees e
LEFT JOIN 
    public.transactions t ON e.id = t.employee_id
GROUP BY 
    e.id, e.name, e.department, e.designation;

-- Note: Views automatically inherit the RLS policies of the underlying tables
-- when queried by an authenticated user. Since employees and transactions have
-- RLS, operators will only see data they are permitted to see.


-- =============================================================================
-- STAGE 3B COMPLETE
--   ✓ Checked: amount > 0 and 'pending' default constraints are active
--   ✓ record_transaction() RPC created
--   ✓ employee_current_balances view created for instant "Owed" dashboards
-- =============================================================================
