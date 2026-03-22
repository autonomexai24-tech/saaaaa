-- =============================================================================
--  SALARY & ADVANCE TRACKER — Seed Data
--  Stage 1A | Mirrors the frontend mock data exactly
--  Run AFTER schema.sql:  psql -d salary_tracker -f seed.sql
-- =============================================================================

-- Wrap everything in a transaction so seed is all-or-nothing
BEGIN;

-- =============================================================================
-- 1. Company Settings (singleton)
-- =============================================================================
INSERT INTO company_settings (
    id, company_name, company_address,
    shift_start, shift_end, working_hours_per_day,
    grace_period_minutes, ot_multiplier, penalty_per_minute,
    annual_paid_leaves, monthly_leave_accrual, unused_leave_action,
    working_days_per_month
) VALUES (
    1, 'PrintWorks Pvt. Ltd.', E'42 Industrial Area, Sector 7\nNew Delhi — 110020',
    '09:00', '18:00', 8,
    10, 1.0, 5.0,
    12, 1, 'carry_forward',
    26
)
ON CONFLICT (id) DO UPDATE SET
    company_name           = EXCLUDED.company_name,
    company_address        = EXCLUDED.company_address,
    shift_start            = EXCLUDED.shift_start,
    shift_end              = EXCLUDED.shift_end,
    working_hours_per_day  = EXCLUDED.working_hours_per_day,
    grace_period_minutes   = EXCLUDED.grace_period_minutes,
    ot_multiplier          = EXCLUDED.ot_multiplier,
    penalty_per_minute     = EXCLUDED.penalty_per_minute,
    annual_paid_leaves     = EXCLUDED.annual_paid_leaves,
    monthly_leave_accrual  = EXCLUDED.monthly_leave_accrual,
    unused_leave_action    = EXCLUDED.unused_leave_action,
    working_days_per_month = EXCLUDED.working_days_per_month,
    updated_at             = NOW();

-- =============================================================================
-- 2. Departments  (from PeopleHub.tsx INITIAL_DEPARTMENTS)
-- =============================================================================
INSERT INTO departments (name) VALUES
    ('Printing'),
    ('Binding'),
    ('Design'),
    ('Cutting'),
    ('Admin')
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 3. Designations  (from PeopleHub.tsx INITIAL_DESIGNATIONS)
-- =============================================================================
INSERT INTO designations (name) VALUES
    ('Operator'),
    ('Senior Binder'),
    ('Graphic Designer'),
    ('Lead Operator'),
    ('Office Coordinator'),
    ('Helper'),
    ('Junior Designer'),
    ('Cutting Operator'),    -- used in ReceiptVault / PayrollEngine mock data
    ('Press Operator'),      -- used in PayrollEngine mock data
    ('Admin Executive'),     -- used in PayrollEngine mock data
    ('Binder')               -- used in PayrollEngine mock data
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- 4. Employees  (from mock-employees.ts MOCK_EMPLOYEES)
--    Rates (daily_rate, hourly_rate) are auto-computed by the trigger.
-- =============================================================================
INSERT INTO employees (
    emp_code, name, phone,
    department_id, designation_id,
    monthly_basic, leave_balance, joined_on, is_active
) VALUES
    -- e1 — Rajesh Kumar
    ('e1', 'Rajesh Kumar', NULL,
     (SELECT id FROM departments  WHERE name = 'Printing'),
     (SELECT id FROM designations WHERE name = 'Operator'),
     20800, 10, '2023-01-01', TRUE),

    -- e2 — Priya Sharma
    ('e2', 'Priya Sharma', NULL,
     (SELECT id FROM departments  WHERE name = 'Binding'),
     (SELECT id FROM designations WHERE name = 'Senior Binder'),
     19500, 8, '2023-02-01', TRUE),

    -- e3 — Amit Patel
    ('e3', 'Amit Patel', NULL,
     (SELECT id FROM departments  WHERE name = 'Design'),
     (SELECT id FROM designations WHERE name = 'Graphic Designer'),
     31200, 12, '2022-06-01', TRUE),

    -- e4 — Sunita Devi
    ('e4', 'Sunita Devi', NULL,
     (SELECT id FROM departments  WHERE name = 'Cutting'),
     (SELECT id FROM designations WHERE name = 'Cutting Operator'),
     18200, 6, '2023-03-15', TRUE),

    -- e5 — Vikram Singh
    ('e5', 'Vikram Singh', NULL,
     (SELECT id FROM departments  WHERE name = 'Printing'),
     (SELECT id FROM designations WHERE name = 'Lead Operator'),
     26000, 9, '2022-11-01', TRUE),

    -- e6 — Meera Joshi
    ('e6', 'Meera Joshi', NULL,
     (SELECT id FROM departments  WHERE name = 'Admin'),
     (SELECT id FROM designations WHERE name = 'Office Coordinator'),
     23400, 4, '2023-04-01', TRUE),

    -- e7 — Arjun Reddy
    ('e7', 'Arjun Reddy', NULL,
     (SELECT id FROM departments  WHERE name = 'Binding'),
     (SELECT id FROM designations WHERE name = 'Helper'),
     14300, 11, '2024-01-10', TRUE),

    -- e8 — Kavita Nair
    ('e8', 'Kavita Nair', NULL,
     (SELECT id FROM departments  WHERE name = 'Design'),
     (SELECT id FROM designations WHERE name = 'Junior Designer'),
     22100, 7, '2023-08-01', TRUE)

ON CONFLICT (emp_code) DO UPDATE SET
    name           = EXCLUDED.name,
    department_id  = EXCLUDED.department_id,
    designation_id = EXCLUDED.designation_id,
    monthly_basic  = EXCLUDED.monthly_basic,
    leave_balance  = EXCLUDED.leave_balance,
    is_active      = EXCLUDED.is_active,
    updated_at     = NOW();

-- =============================================================================
-- 5. Holidays  (from CompanySettings.tsx INITIAL_HOLIDAYS)
-- =============================================================================
INSERT INTO holidays (date, name) VALUES
    ('2026-01-26', 'Republic Day'),
    ('2026-08-15', 'Independence Day'),
    ('2026-11-12', 'Diwali')
ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name;

-- =============================================================================
-- 6. Attendance Logs — seed for today (2026-03-22)
--    Mirrors SEED_ATTENDANCE from mock-employees.ts
-- =============================================================================
INSERT INTO attendance_logs (employee_id, log_date, time_in, time_out, advance_given)
SELECT e.id, '2026-03-22', seed.time_in, seed.time_out, seed.advance
FROM (VALUES
    ('e1', '09:00'::TIME, '18:00'::TIME, 0.0),
    ('e2', '09:22'::TIME, '18:00'::TIME, 500.0),
    ('e3', '08:55'::TIME, '19:30'::TIME, 0.0),
    ('e5', '09:05'::TIME, '18:00'::TIME, 0.0),
    ('e6', '09:45'::TIME, '18:00'::TIME, 8000.0)
) AS seed(emp_code, time_in, time_out, advance)
JOIN employees e ON e.emp_code = seed.emp_code
ON CONFLICT (employee_id, log_date) DO NOTHING;

-- =============================================================================
-- 7. Advance Transactions — seed from ReceiptVault / PayrollEngine mock data
--    These represent advances "taken this month" for March 2026
-- =============================================================================
INSERT INTO advance_transactions (employee_id, txn_date, amount, purpose, is_recovered)
SELECT e.id, '2026-03-15', adv.amount, 'Monthly advance', FALSE
FROM (VALUES
    ('e1', 2000.0),
    ('e2',  500.0),   -- also in SEED_ATTENDANCE advance field
    ('e3', 5000.0),
    ('e4', 1500.0),
    ('e5', 3000.0),
    ('e6', 8000.0),   -- also in SEED_ATTENDANCE advance field
    ('e7', 1000.0)
) AS adv(emp_code, amount)
JOIN employees e ON e.emp_code = adv.emp_code;

-- =============================================================================
-- 8. Payroll Run — March 2026 (draft, ready for Payroll Engine)
-- =============================================================================
INSERT INTO payroll_runs (period_year, period_month, status)
VALUES (2026, 3, 'draft')
ON CONFLICT (period_year, period_month) DO NOTHING;

COMMIT;
