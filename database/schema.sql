-- =============================================================================
--  SALARY & ADVANCE TRACKER — PostgreSQL Schema
--  Stage 1B | Revised: 2026-03-22
-- =============================================================================
--
--  Table creation order (respects FK dependencies):
--    1. company_settings
--    2. departments
--    3. designations
--    4. employees
--    5. holidays
--    6. attendance_logs
--    7. advance_transactions
--    8. payroll_runs
--    9. payroll_line_items
--
--  Triggers:
--    trg_employees_set_rates      — auto-computes daily_rate / hourly_rate on employee upsert
--    trg_company_settings_rates   — propagates rate changes to all employees on settings update
--    trg_attendance_compute       — auto-computes hours_worked, ot_hours, late_minutes, penalty on insert/update
--    trg_attendance_updated_at    — refreshes updated_at on all other column changes (Bug #4 fix)
--
--  Functions:
--    calculate_payroll_for_employee(run_id, employee_id, bonus, fines, professional_tax)
--    approve_payroll_run(run_id)
--    get_monthly_attendance_summary(year, month)
--
--  Security:
--    app_user role — least-privilege role for the API layer
--    Row-Level Security is NOT enabled by default (single-tenant app); GRANT-based security used.
--
--  Views:
--    payroll_ledger_view    — powers PayrollEngine.tsx
--    payslip_view           — powers ReceiptVault.tsx (approved/locked runs only)
--    pending_advances_view  — powers advance dashboard
-- =============================================================================

-- Enable the pgcrypto extension (for gen_random_uuid if needed later)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. COMPANY_SETTINGS  (singleton — id is always 1)
-- =============================================================================
CREATE TABLE IF NOT EXISTS company_settings (
    id                      INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    company_name            TEXT        NOT NULL DEFAULT 'PrintWorks Pvt. Ltd.',
    company_address         TEXT        NOT NULL DEFAULT E'42 Industrial Area, Sector 7\nNew Delhi — 110020',
    logo_path               TEXT,                               -- relative URL / file path after upload
    shift_start             TIME        NOT NULL DEFAULT '09:00',
    shift_end               TIME        NOT NULL DEFAULT '18:00',
    working_hours_per_day   NUMERIC(4,2) NOT NULL DEFAULT 8,
    grace_period_minutes    INT         NOT NULL DEFAULT 10,
    ot_multiplier           NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    penalty_per_minute      NUMERIC(8,2) NOT NULL DEFAULT 5.0,  -- ₹ per late minute
    annual_paid_leaves      INT         NOT NULL DEFAULT 12,
    monthly_leave_accrual   INT         NOT NULL DEFAULT 1,     -- leaves earned per month
    unused_leave_action     TEXT        NOT NULL DEFAULT 'carry_forward'
                                CHECK (unused_leave_action IN ('carry_forward','encash','expire')),
    working_days_per_month  INT         NOT NULL DEFAULT 26,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 2. DEPARTMENTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS departments (
    id          SERIAL      PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 3. DESIGNATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS designations (
    id          SERIAL      PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 4. EMPLOYEES
-- =============================================================================
CREATE TABLE IF NOT EXISTS employees (
    id              SERIAL      PRIMARY KEY,
    emp_code        TEXT        UNIQUE,          -- e.g. 'EMP001', maps to old 'e1' etc.
    name            TEXT        NOT NULL,
    phone           TEXT,
    department_id   INT         REFERENCES departments(id) ON DELETE SET NULL,
    designation_id  INT         REFERENCES designations(id) ON DELETE SET NULL,
    monthly_basic   NUMERIC(12,2) NOT NULL CHECK (monthly_basic > 0),
    -- Derived rates — maintained by trigger trg_employees_set_rates
    daily_rate      NUMERIC(12,4) NOT NULL DEFAULT 0,
    hourly_rate     NUMERIC(12,4) NOT NULL DEFAULT 0,
    leave_balance   NUMERIC(6,2)  NOT NULL DEFAULT 0,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    joined_on       DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 5. HOLIDAYS
-- =============================================================================
CREATE TABLE IF NOT EXISTS holidays (
    id          SERIAL      PRIMARY KEY,
    date        DATE        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 6. ATTENDANCE_LOGS
-- =============================================================================
CREATE TABLE IF NOT EXISTS attendance_logs (
    id              SERIAL      PRIMARY KEY,
    employee_id     INT         NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    log_date        DATE        NOT NULL,
    time_in         TIME,
    time_out        TIME,
    status          TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('present','late','absent','holiday','paid_leave','pending')),
    -- Computed fields — filled by trigger trg_attendance_compute
    hours_worked    NUMERIC(6,2) NOT NULL DEFAULT 0,
    ot_hours        NUMERIC(6,2) NOT NULL DEFAULT 0,
    late_minutes    INT          NOT NULL DEFAULT 0,
    penalty_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- Advance can be given at the same time as logging attendance
    advance_given   NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, log_date)
);

-- =============================================================================
-- 7. ADVANCE_TRANSACTIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS advance_transactions (
    id              SERIAL      PRIMARY KEY,
    employee_id     INT         NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    txn_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    purpose         TEXT,
    is_recovered    BOOLEAN     NOT NULL DEFAULT FALSE,
    payroll_run_id  INT,        -- set when the advance is recovered in a payroll run (FK added below)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 8. PAYROLL_RUNS  (one per calendar month)
-- =============================================================================
CREATE TABLE IF NOT EXISTS payroll_runs (
    id              SERIAL      PRIMARY KEY,
    period_year     INT         NOT NULL,
    period_month    INT         NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    status          TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','locked')),
    approved_by     TEXT,
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (period_year, period_month)
);

-- Now we can add the FK from advance_transactions → payroll_runs
ALTER TABLE advance_transactions
    ADD CONSTRAINT fk_advance_payroll_run
    FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL;

-- =============================================================================
-- 9. PAYROLL_LINE_ITEMS  (one row per employee per payroll run)
-- =============================================================================
CREATE TABLE IF NOT EXISTS payroll_line_items (
    id                  SERIAL      PRIMARY KEY,
    payroll_run_id      INT         NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id         INT         NOT NULL REFERENCES employees(id),
    -- Snapshot of employee data at time of payroll (prevents drift)
    base_salary         NUMERIC(12,2) NOT NULL,
    standard_hours      NUMERIC(8,2)  NOT NULL,
    hours_logged        NUMERIC(8,2)  NOT NULL DEFAULT 0,
    hourly_rate         NUMERIC(12,4) NOT NULL,
    paid_leaves         INT           NOT NULL DEFAULT 0,
    -- Earnings
    ot_hours            NUMERIC(8,2)  NOT NULL DEFAULT 0,
    ot_pay              NUMERIC(12,2) NOT NULL DEFAULT 0,
    bonus               NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Deductions
    short_hours         NUMERIC(8,2)  NOT NULL DEFAULT 0,
    short_deduction     NUMERIC(12,2) NOT NULL DEFAULT 0,
    late_penalty        NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Bug #2 fix: sum of penalty_amount from attendance_logs
    advances_taken      NUMERIC(12,2) NOT NULL DEFAULT 0,
    professional_tax    NUMERIC(12,2) NOT NULL DEFAULT 0,
    fines               NUMERIC(12,2) NOT NULL DEFAULT 0,  -- manual fines added by manager
    -- Computed totals (generated columns — no trigger needed)
    gross_earnings      NUMERIC(12,2) GENERATED ALWAYS AS (base_salary + ot_pay + bonus) STORED,
    total_deductions    NUMERIC(12,2) GENERATED ALWAYS AS (
                            short_deduction + late_penalty + advances_taken + professional_tax + fines
                        ) STORED,
    net_payable         NUMERIC(12,2) GENERATED ALWAYS AS (
                            base_salary + ot_pay + bonus
                            - short_deduction - late_penalty - advances_taken - professional_tax - fines
                        ) STORED,
    -- Leave snapshot
    leave_balance_snap  NUMERIC(6,2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payroll_run_id, employee_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_logs (employee_id, log_date);
CREATE INDEX IF NOT EXISTS idx_attendance_log_date      ON attendance_logs (log_date);
CREATE INDEX IF NOT EXISTS idx_advance_employee         ON advance_transactions (employee_id);
CREATE INDEX IF NOT EXISTS idx_advance_run              ON advance_transactions (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run        ON payroll_line_items (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_employee   ON payroll_line_items (employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_active         ON employees (is_active) WHERE is_active = TRUE;

-- =============================================================================
-- TRIGGER FUNCTION: compute_employee_rates()
--   Recalculates daily_rate and hourly_rate for one employee from company_settings.
-- =============================================================================
CREATE OR REPLACE FUNCTION compute_employee_rates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_wpd  NUMERIC;
    v_hpd  NUMERIC;
BEGIN
    SELECT working_days_per_month, working_hours_per_day
      INTO v_wpd, v_hpd
      FROM company_settings WHERE id = 1;

    NEW.daily_rate  := ROUND(NEW.monthly_basic / v_wpd, 4);
    NEW.hourly_rate := ROUND(NEW.monthly_basic / v_wpd / v_hpd, 4);
    NEW.updated_at  := NOW();
    RETURN NEW;
END;
$$;

-- Fire before INSERT or UPDATE on employees
DROP TRIGGER IF EXISTS trg_employees_set_rates ON employees;
CREATE TRIGGER trg_employees_set_rates
    BEFORE INSERT OR UPDATE OF monthly_basic
    ON employees
    FOR EACH ROW EXECUTE FUNCTION compute_employee_rates();

-- =============================================================================
-- TRIGGER FUNCTION: propagate_rate_change_to_employees()
--   When working_days_per_month or working_hours_per_day changes in
--   company_settings, recalculate rates for all active employees.
-- =============================================================================
CREATE OR REPLACE FUNCTION propagate_rate_change_to_employees()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Only propagate if the relevant columns actually changed
    IF (NEW.working_days_per_month IS DISTINCT FROM OLD.working_days_per_month) OR
       (NEW.working_hours_per_day  IS DISTINCT FROM OLD.working_hours_per_day) THEN

        UPDATE employees
           SET daily_rate  = ROUND(monthly_basic / NEW.working_days_per_month, 4),
               hourly_rate = ROUND(monthly_basic / NEW.working_days_per_month / NEW.working_hours_per_day, 4),
               updated_at  = NOW()
         WHERE is_active = TRUE;
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_settings_rates ON company_settings;
CREATE TRIGGER trg_company_settings_rates
    BEFORE UPDATE ON company_settings
    FOR EACH ROW EXECUTE FUNCTION propagate_rate_change_to_employees();

-- =============================================================================
-- TRIGGER FUNCTION: compute_attendance_fields()
--   Auto-fills hours_worked, ot_hours, late_minutes, penalty_amount, and status
--   whenever an attendance_log row is inserted or its times are updated.
-- =============================================================================
CREATE OR REPLACE FUNCTION compute_attendance_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_shift_start   TIME;
    v_shift_end     TIME;
    v_grace         INT;
    v_penalty_rate  NUMERIC;
    v_ot_multi      NUMERIC;
    v_wpd           NUMERIC;  -- working hours per day (standard)

    v_in_min        NUMERIC;
    v_out_min       NUMERIC;
    v_shift_start_m NUMERIC;
    v_shift_end_m   NUMERIC;

    v_total_worked  NUMERIC;
    v_late_min      INT;
    v_ot_min        NUMERIC;
    v_is_holiday    BOOLEAN;
BEGIN
    -- Load settings
    SELECT shift_start, shift_end, grace_period_minutes,
           penalty_per_minute, ot_multiplier, working_hours_per_day
      INTO v_shift_start, v_shift_end, v_grace,
           v_penalty_rate, v_ot_multi, v_wpd
      FROM company_settings WHERE id = 1;

    -- Check if log_date is a holiday
    SELECT EXISTS(SELECT 1 FROM holidays WHERE date = NEW.log_date) INTO v_is_holiday;

    IF v_is_holiday THEN
        NEW.status          := 'holiday';
        NEW.hours_worked    := 0;
        NEW.ot_hours        := 0;
        NEW.late_minutes    := 0;
        NEW.penalty_amount  := 0;
        NEW.updated_at      := NOW();
        RETURN NEW;
    END IF;

    -- No time_in recorded → absent/pending
    IF NEW.time_in IS NULL THEN
        NEW.status          := 'absent';
        NEW.hours_worked    := 0;
        NEW.ot_hours        := 0;
        NEW.late_minutes    := 0;
        NEW.penalty_amount  := 0;
        NEW.updated_at      := NOW();
        RETURN NEW;
    END IF;

    -- Convert times to minutes since midnight for arithmetic
    v_in_min        := EXTRACT(EPOCH FROM NEW.time_in) / 60;
    v_shift_start_m := EXTRACT(EPOCH FROM v_shift_start) / 60;
    v_shift_end_m   := EXTRACT(EPOCH FROM v_shift_end) / 60;

    -- Late calculation (after grace period)
    v_late_min := GREATEST(0, (v_in_min - v_shift_start_m - v_grace)::INT);

    -- Status
    IF v_late_min > 0 THEN
        NEW.status := 'late';
    ELSE
        NEW.status := 'present';
    END IF;

    -- Hours worked and OT (only if time_out is available)
    IF NEW.time_out IS NOT NULL THEN
        v_out_min      := EXTRACT(EPOCH FROM NEW.time_out) / 60;
        v_total_worked := GREATEST(0, v_out_min - v_in_min) / 60;  -- in hours
        v_ot_min       := GREATEST(0, v_out_min - v_shift_end_m);

        NEW.hours_worked   := ROUND(v_total_worked::NUMERIC, 2);
        NEW.ot_hours       := ROUND((v_ot_min / 60)::NUMERIC, 2);
    ELSE
        NEW.hours_worked   := 0;
        NEW.ot_hours       := 0;
    END IF;

    NEW.late_minutes    := v_late_min;
    NEW.penalty_amount  := ROUND((v_late_min * v_penalty_rate)::NUMERIC, 2);
    NEW.updated_at      := NOW();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_compute ON attendance_logs;
CREATE TRIGGER trg_attendance_compute
    BEFORE INSERT OR UPDATE OF time_in, time_out, log_date
    ON attendance_logs
    FOR EACH ROW EXECUTE FUNCTION compute_attendance_fields();

-- =============================================================================
-- STORED FUNCTION: calculate_payroll_for_employee
--   Aggregates attendance for the payroll run's month and UPSERTs a
--   payroll_line_items row. Call once per employee from the API.
--
--   Bug #2 Fix: now also aggregates SUM(penalty_amount) from attendance_logs
--   and stores it in the new late_penalty column.
-- =============================================================================
CREATE OR REPLACE FUNCTION calculate_payroll_for_employee(
    p_run_id         INT,
    p_employee_id    INT,
    p_bonus          NUMERIC DEFAULT 0,
    p_fines          NUMERIC DEFAULT 0,
    p_prof_tax       NUMERIC DEFAULT 0
) RETURNS payroll_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_year           INT;
    v_month          INT;
    v_emp            employees%ROWTYPE;
    v_settings       company_settings%ROWTYPE;

    v_hours_logged   NUMERIC := 0;
    v_ot_hours       NUMERIC := 0;
    v_total_penalty  NUMERIC := 0;  -- Bug #2: sum of per-minute late penalties
    v_paid_leaves    INT     := 0;

    v_standard_hrs   NUMERIC;
    v_ot_pay         NUMERIC;
    v_short_hours    NUMERIC;
    v_short_ded      NUMERIC;
    v_advances       NUMERIC := 0;
    v_leave_snap     NUMERIC;

    v_result         payroll_line_items%ROWTYPE;
BEGIN
    -- Fetch payroll run period
    SELECT period_year, period_month INTO v_year, v_month
      FROM payroll_runs WHERE id = p_run_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_run_id;
    END IF;

    -- Fetch employee
    SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee % not found', p_employee_id;
    END IF;

    -- Fetch settings
    SELECT * INTO v_settings FROM company_settings WHERE id = 1;

    -- Aggregate attendance for the month
    -- Bug #2 Fix: include SUM(penalty_amount) for late deductions
    SELECT
        COALESCE(SUM(hours_worked),   0),
        COALESCE(SUM(ot_hours),       0),
        COALESCE(SUM(penalty_amount), 0),
        COUNT(*) FILTER (WHERE status = 'paid_leave')
      INTO v_hours_logged, v_ot_hours, v_total_penalty, v_paid_leaves
      FROM attendance_logs
     WHERE employee_id = p_employee_id
       AND EXTRACT(YEAR  FROM log_date) = v_year
       AND EXTRACT(MONTH FROM log_date) = v_month;

    -- Standard hours for the month
    v_standard_hrs := v_settings.working_hours_per_day * v_settings.working_days_per_month;

    -- OT pay  (ot_multiplier applied — e.g. 1.5× for overtime premium)
    v_ot_pay := ROUND(v_ot_hours * v_emp.hourly_rate * v_settings.ot_multiplier, 2);

    -- Short hours (adjusted for paid leaves)
    v_short_hours := GREATEST(
        0,
        v_standard_hrs - v_hours_logged - (v_paid_leaves * v_settings.working_hours_per_day)
    );
    v_short_ded := ROUND(v_short_hours * v_emp.hourly_rate, 2);

    -- All unrecovered advances (regardless of month — carry-forward supported)
    SELECT COALESCE(SUM(amount), 0) INTO v_advances
      FROM advance_transactions
     WHERE employee_id  = p_employee_id
       AND is_recovered = FALSE;

    v_leave_snap := v_emp.leave_balance;

    -- UPSERT into payroll_line_items
    INSERT INTO payroll_line_items (
        payroll_run_id, employee_id,
        base_salary, standard_hours, hours_logged, hourly_rate, paid_leaves,
        ot_hours, ot_pay, bonus,
        short_hours, short_deduction, late_penalty, advances_taken, professional_tax, fines,
        leave_balance_snap
    ) VALUES (
        p_run_id, p_employee_id,
        v_emp.monthly_basic, v_standard_hrs, v_hours_logged, v_emp.hourly_rate, v_paid_leaves,
        v_ot_hours, v_ot_pay, p_bonus,
        v_short_hours, v_short_ded, v_total_penalty, v_advances, p_prof_tax, p_fines,
        v_leave_snap
    )
    ON CONFLICT (payroll_run_id, employee_id) DO UPDATE SET
        hours_logged       = EXCLUDED.hours_logged,
        paid_leaves        = EXCLUDED.paid_leaves,
        ot_hours           = EXCLUDED.ot_hours,
        ot_pay             = EXCLUDED.ot_pay,
        bonus              = EXCLUDED.bonus,
        short_hours        = EXCLUDED.short_hours,
        short_deduction    = EXCLUDED.short_deduction,
        late_penalty       = EXCLUDED.late_penalty,
        advances_taken     = EXCLUDED.advances_taken,
        professional_tax   = EXCLUDED.professional_tax,
        fines              = EXCLUDED.fines,
        leave_balance_snap = EXCLUDED.leave_balance_snap
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- STORED FUNCTION: approve_payroll_run
--   Locks a payroll run, marks all unrecovered advances as recovered,
--   and updates employee leave balances (adds monthly accrual).
-- =============================================================================
CREATE OR REPLACE FUNCTION approve_payroll_run(p_run_id INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_year   INT;
    v_month  INT;
    v_accrual INT;
    rec      RECORD;
BEGIN
    SELECT period_year, period_month INTO v_year, v_month
      FROM payroll_runs WHERE id = p_run_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_run_id;
    END IF;

    -- Lock the run
    UPDATE payroll_runs
       SET status = 'locked', approved_at = NOW()
     WHERE id = p_run_id;

    -- Mark advances in this run as recovered
    UPDATE advance_transactions
       SET is_recovered = TRUE,
           payroll_run_id = p_run_id
     WHERE is_recovered = FALSE
       AND EXTRACT(YEAR  FROM txn_date) = v_year
       AND EXTRACT(MONTH FROM txn_date) = v_month;

    -- Add monthly leave accrual to each employee in this payroll run
    SELECT monthly_leave_accrual INTO v_accrual FROM company_settings WHERE id = 1;

    FOR rec IN
        SELECT DISTINCT employee_id FROM payroll_line_items WHERE payroll_run_id = p_run_id
    LOOP
        UPDATE employees
           SET leave_balance = leave_balance + v_accrual,
               updated_at    = NOW()
         WHERE id = rec.employee_id;
    END LOOP;
END;
$$;

-- =============================================================================
-- STORED FUNCTION: get_monthly_attendance_summary
--   Returns attendance counts per employee for a given year/month.
--   Used by the Monthly Attendance Report dialog (DailyLog.tsx).
-- =============================================================================
CREATE OR REPLACE FUNCTION get_monthly_attendance_summary(
    p_year  INT,
    p_month INT
)
RETURNS TABLE (
    employee_id    INT,
    employee_name  TEXT,
    department     TEXT,
    working_days   INT,
    present_days   BIGINT,
    absent_days    BIGINT,
    late_days      BIGINT,
    total_hours    NUMERIC,
    total_ot_hours NUMERIC
) LANGUAGE plpgsql AS $$
DECLARE
    v_wpd INT;
BEGIN
    SELECT working_days_per_month INTO v_wpd FROM company_settings WHERE id = 1;

    RETURN QUERY
    SELECT
        e.id                                        AS employee_id,
        e.name                                      AS employee_name,
        d.name                                      AS department,
        v_wpd                                       AS working_days,
        COUNT(*) FILTER (WHERE al.status IN ('present', 'late'))  AS present_days,
        COUNT(*) FILTER (WHERE al.status = 'absent')              AS absent_days,
        COUNT(*) FILTER (WHERE al.status = 'late')                AS late_days,
        COALESCE(SUM(al.hours_worked), 0)           AS total_hours,
        COALESCE(SUM(al.ot_hours), 0)               AS total_ot_hours
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN attendance_logs al
           ON al.employee_id = e.id
          AND EXTRACT(YEAR  FROM al.log_date) = p_year
          AND EXTRACT(MONTH FROM al.log_date) = p_month
    WHERE e.is_active = TRUE
    GROUP BY e.id, e.name, d.name
    ORDER BY e.name;
END;
$$;

-- =============================================================================
-- updated_at auto-refresh helper
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

-- Bug #4 Fix: wire updated_at trigger to attendance_logs for non-computed columns
-- (advance_given, notes, status overrides — trg_attendance_compute covers time_in/time_out/log_date)
DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance_logs;
CREATE TRIGGER trg_attendance_updated_at
    BEFORE UPDATE ON attendance_logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Also wire it to company_settings (already covered by propagate_rate_change_to_employees,
-- but set_updated_at handles updates that don't touch rate columns)
DROP TRIGGER IF EXISTS trg_company_settings_updated_at ON company_settings;
CREATE TRIGGER trg_company_settings_updated_at
    BEFORE UPDATE ON company_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- SECURITY: app_user role + least-privilege GRANTs
--   The API layer should connect as a role that inherits app_user.
--   It cannot DROP, TRUNCATE, or alter schema — only use the defined interface.
-- =============================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
    END IF;
END $$;

-- Read access to all tables
GRANT SELECT ON
    company_settings,
    departments,
    designations,
    employees,
    holidays,
    attendance_logs,
    advance_transactions,
    payroll_runs,
    payroll_line_items
TO app_user;

-- Write access only where the API legitimately needs it
GRANT INSERT, UPDATE ON attendance_logs      TO app_user;
GRANT INSERT, UPDATE ON advance_transactions TO app_user;
GRANT INSERT         ON payroll_runs         TO app_user;
GRANT UPDATE         ON company_settings     TO app_user;
GRANT UPDATE         ON employees            TO app_user;
GRANT INSERT, UPDATE, DELETE ON departments  TO app_user;
GRANT INSERT, UPDATE, DELETE ON designations TO app_user;
GRANT INSERT, UPDATE, DELETE ON holidays     TO app_user;

-- Sequence access (needed for SERIAL columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Stored function access
GRANT EXECUTE ON FUNCTION calculate_payroll_for_employee(INT, INT, NUMERIC, NUMERIC, NUMERIC) TO app_user;
GRANT EXECUTE ON FUNCTION approve_payroll_run(INT)                                            TO app_user;
GRANT EXECUTE ON FUNCTION get_monthly_attendance_summary(INT, INT)                           TO app_user;

-- =============================================================================
-- VIEWS
--   Three convenience views that map directly to the frontend page data shapes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- payroll_ledger_view — powers PayrollEngine.tsx master ledger table
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW payroll_ledger_view AS
SELECT
    pli.id                  AS line_item_id,
    pr.id                   AS payroll_run_id,
    pr.period_year,
    pr.period_month,
    pr.status               AS run_status,
    e.id                    AS employee_id,
    e.emp_code,
    e.name                  AS employee_name,
    d.name                  AS department,
    des.name                AS designation,
    pli.base_salary,
    pli.standard_hours,
    pli.hours_logged,
    pli.hourly_rate,
    pli.paid_leaves,
    pli.ot_hours,
    pli.ot_pay,
    pli.bonus,
    pli.short_hours,
    pli.short_deduction,
    pli.late_penalty,
    pli.advances_taken,
    pli.professional_tax,
    pli.fines,
    pli.gross_earnings,
    pli.total_deductions,
    pli.net_payable,
    pli.leave_balance_snap,
    pli.created_at
FROM payroll_line_items pli
JOIN payroll_runs  pr  ON pr.id  = pli.payroll_run_id
JOIN employees     e   ON e.id   = pli.employee_id
LEFT JOIN departments  d   ON d.id   = e.department_id
LEFT JOIN designations des ON des.id = e.designation_id;

GRANT SELECT ON payroll_ledger_view TO app_user;

-- ---------------------------------------------------------------------------
-- payslip_view — powers ReceiptVault.tsx
--   Only exposes rows from approved/locked runs (private payroll data).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW payslip_view AS
SELECT
    pli.id                  AS line_item_id,
    pr.period_year,
    pr.period_month,
    pr.status               AS run_status,
    e.emp_code,
    e.name                  AS employee_name,
    e.phone,
    d.name                  AS department,
    des.name                AS designation,
    pli.base_salary,
    pli.standard_hours,
    pli.hours_logged,
    pli.hourly_rate,
    pli.paid_leaves,
    pli.leave_balance_snap,
    pli.ot_hours,
    pli.ot_pay,
    pli.bonus,
    pli.short_hours,
    pli.short_deduction,
    pli.late_penalty,
    pli.advances_taken,
    pli.professional_tax,
    pli.fines,
    pli.gross_earnings,
    pli.total_deductions,
    pli.net_payable
FROM payroll_line_items pli
JOIN payroll_runs  pr  ON pr.id  = pli.payroll_run_id
JOIN employees     e   ON e.id   = pli.employee_id
LEFT JOIN departments  d   ON d.id   = e.department_id
LEFT JOIN designations des ON des.id = e.designation_id
WHERE pr.status IN ('approved', 'locked');

GRANT SELECT ON payslip_view TO app_user;

-- ---------------------------------------------------------------------------
-- pending_advances_view — shows each employee's total unrecovered advance debt
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW pending_advances_view AS
SELECT
    e.id                AS employee_id,
    e.emp_code,
    e.name              AS employee_name,
    d.name              AS department,
    COUNT(*)::INT       AS open_advance_count,
    SUM(at.amount)      AS total_pending
FROM advance_transactions at
JOIN employees     e ON e.id  = at.employee_id
LEFT JOIN departments d ON d.id  = e.department_id
WHERE at.is_recovered = FALSE
GROUP BY e.id, e.emp_code, e.name, d.name
ORDER BY total_pending DESC;

GRANT SELECT ON pending_advances_view TO app_user;
