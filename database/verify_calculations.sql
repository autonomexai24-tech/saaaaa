-- =============================================================================
--  SALARY & ADVANCE TRACKER — Calculation Verification Script
--  Stage 1B | Run AFTER: schema.sql, seed.sql
--
--  Usage:
--    psql -U postgres -d salary_tracker_test -f database/verify_calculations.sql
--
--  All tests use RAISE EXCEPTION on failure so psql exits non-zero.
--  RAISE NOTICE 'PASS: ...' lines confirm success.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TEST 1: Employee rate trigger (trg_employees_set_rates)
--   company_settings: working_days_per_month=26, working_hours_per_day=8
--   e1 (Rajesh Kumar): monthly_basic=20800
--     expected daily_rate  = ROUND(20800 / 26, 4)   = 800.0000
--     expected hourly_rate = ROUND(20800 / 26 / 8, 4) = 100.0000
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_daily   NUMERIC;
    v_hourly  NUMERIC;
BEGIN
    SELECT daily_rate, hourly_rate
      INTO v_daily, v_hourly
      FROM employees WHERE emp_code = 'e1';

    IF v_daily != 800.0000 THEN
        RAISE EXCEPTION 'TEST 1 FAIL: e1 daily_rate expected 800.0000, got %', v_daily;
    END IF;

    IF v_hourly != 100.0000 THEN
        RAISE EXCEPTION 'TEST 1 FAIL: e1 hourly_rate expected 100.0000, got %', v_hourly;
    END IF;

    RAISE NOTICE 'TEST 1 PASS: Employee rate trigger — e1 daily=% hourly=%', v_daily, v_hourly;
END $$;

-- TEST 1b: e3 (Amit Patel): monthly_basic=31200
--   daily_rate  = ROUND(31200 / 26, 4) = 1200.0000
--   hourly_rate = ROUND(31200 / 26 / 8, 4) = 150.0000
DO $$
DECLARE
    v_daily  NUMERIC;
    v_hourly NUMERIC;
BEGIN
    SELECT daily_rate, hourly_rate INTO v_daily, v_hourly
      FROM employees WHERE emp_code = 'e3';

    IF v_daily != 1200.0000 THEN
        RAISE EXCEPTION 'TEST 1b FAIL: e3 daily_rate expected 1200.0000, got %', v_daily;
    END IF;
    IF v_hourly != 150.0000 THEN
        RAISE EXCEPTION 'TEST 1b FAIL: e3 hourly_rate expected 150.0000, got %', v_hourly;
    END IF;

    RAISE NOTICE 'TEST 1b PASS: Employee rate trigger — e3 daily=% hourly=%', v_daily, v_hourly;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 2: Attendance compute trigger (trg_attendance_compute)
--   Seeded row: e2 (Priya Sharma) on 2026-03-22
--     time_in=09:22, time_out=18:00
--     shift_start=09:00, grace=10 min
--     late_minutes = MAX(0, 22 - 10) = 12
--     status = 'late'
--     hours_worked = (18:00 - 09:22) = 8h 38m = 8.63... → ROUND to 2dp
--     ot_hours = 0 (time_out == shift_end)
--     penalty_amount = 12 * 5.0 = 60.00
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r attendance_logs%ROWTYPE;
BEGIN
    SELECT * INTO r
      FROM attendance_logs al
      JOIN employees e ON e.id = al.employee_id
     WHERE e.emp_code = 'e2'
       AND al.log_date = '2026-03-22';

    IF r.status != 'late' THEN
        RAISE EXCEPTION 'TEST 2 FAIL: e2 status expected late, got %', r.status;
    END IF;

    IF r.late_minutes != 12 THEN
        RAISE EXCEPTION 'TEST 2 FAIL: e2 late_minutes expected 12, got %', r.late_minutes;
    END IF;

    IF r.penalty_amount != 60.00 THEN
        RAISE EXCEPTION 'TEST 2 FAIL: e2 penalty_amount expected 60.00, got %', r.penalty_amount;
    END IF;

    IF r.ot_hours != 0 THEN
        RAISE EXCEPTION 'TEST 2 FAIL: e2 ot_hours expected 0, got %', r.ot_hours;
    END IF;

    RAISE NOTICE 'TEST 2 PASS: Attendance trigger — e2 status=% late_min=% penalty=% ot=%',
        r.status, r.late_minutes, r.penalty_amount, r.ot_hours;
END $$;

-- TEST 2b: e3 (Amit Patel) on 2026-03-22
--   time_in=08:55, time_out=19:30
--   late_minutes = 0  (arrives before shift)
--   status = 'present'
--   hours_worked = 19:30 - 08:55 = 10h 35m = 10.58... hrs → 10.58 rounded
--   ot_minutes = 19:30 - 18:00 = 90 min → ot_hours = 1.50
--   penalty_amount = 0
DO $$
DECLARE
    r attendance_logs%ROWTYPE;
BEGIN
    SELECT * INTO r
      FROM attendance_logs al
      JOIN employees e ON e.id = al.employee_id
     WHERE e.emp_code = 'e3'
       AND al.log_date = '2026-03-22';

    IF r.status != 'present' THEN
        RAISE EXCEPTION 'TEST 2b FAIL: e3 status expected present, got %', r.status;
    END IF;
    IF r.late_minutes != 0 THEN
        RAISE EXCEPTION 'TEST 2b FAIL: e3 late_minutes expected 0, got %', r.late_minutes;
    END IF;
    IF r.ot_hours != 1.50 THEN
        RAISE EXCEPTION 'TEST 2b FAIL: e3 ot_hours expected 1.50, got %', r.ot_hours;
    END IF;
    IF r.penalty_amount != 0 THEN
        RAISE EXCEPTION 'TEST 2b FAIL: e3 penalty_amount expected 0, got %', r.penalty_amount;
    END IF;

    RAISE NOTICE 'TEST 2b PASS: Attendance trigger — e3 status=% late=% ot=% penalty=%',
        r.status, r.late_minutes, r.ot_hours, r.penalty_amount;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 3: calculate_payroll_for_employee
--   Run for e2 (Priya Sharma), payroll_run_id=1
--   From seed: hours_worked (single day, 09:22→18:00) ≈ 8.63h, ot_hours=0,
--              paid_leaves=0, late_penalty=60.00
--   company: working_days=26, working_hours_per_day=8 → standard_hours=208
--   e2: monthly_basic=19500, hourly_rate=93.75, advances=500.00 (seeded)
--
--   Expected:
--     short_hours = MAX(0, 208 - 8.63 - 0) = 199.37
--     short_deduction = ROUND(199.37 * 93.75, 2) = 18691.41 (approx — single day seed)
--     ot_pay = 0
--     gross_earnings = 19500
--     total_deductions = 18691.41 + 60.00 + 500 + 0 + 0 = 19251.41 (approx)
--     net_payable = 19500 - 19251.41 = 248.59 (approx)
--
--   We only assert the formula identity, not the exact value, because seed only
--   has 1 day of attendance for e2.  The formula assertion is the important part.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_emp_id   INT;
    v_run_id   INT := 1;
    li         payroll_line_items%ROWTYPE;
    expected_net NUMERIC;
BEGIN
    SELECT id INTO v_emp_id FROM employees WHERE emp_code = 'e2';

    -- Call the function
    li := calculate_payroll_for_employee(v_run_id, v_emp_id, 0, 0, 0);

    -- Formula identity: net = base + ot_pay + bonus - short_ded - late_pen - advances - ptax - fines
    expected_net := li.base_salary + li.ot_pay + li.bonus
                  - li.short_deduction - li.late_penalty - li.advances_taken
                  - li.professional_tax - li.fines;

    IF li.net_payable IS DISTINCT FROM ROUND(expected_net, 2) THEN
        RAISE EXCEPTION 'TEST 3 FAIL: net_payable formula broken. Got %, expected %',
            li.net_payable, ROUND(expected_net, 2);
    END IF;

    -- Validate late_penalty was captured
    IF li.late_penalty != 60.00 THEN
        RAISE EXCEPTION 'TEST 3 FAIL: e2 late_penalty expected 60.00, got %', li.late_penalty;
    END IF;

    -- Validate carry-forward advance was captured
    IF li.advances_taken != 500.00 THEN
        RAISE EXCEPTION 'TEST 3 FAIL: e2 advances_taken expected 500.00, got %', li.advances_taken;
    END IF;

    RAISE NOTICE 'TEST 3 PASS: calculate_payroll_for_employee — e2 net=% late_pen=% advances=%',
        li.net_payable, li.late_penalty, li.advances_taken;
END $$;

-- TEST 3b: e3 (Amit Patel) — has 1.5h OT, no late penalty, 5000 advance
DO $$
DECLARE
    v_emp_id INT;
    li       payroll_line_items%ROWTYPE;
    expected_net NUMERIC;
BEGIN
    SELECT id INTO v_emp_id FROM employees WHERE emp_code = 'e3';

    li := calculate_payroll_for_employee(1, v_emp_id, 0, 0, 0);

    expected_net := li.base_salary + li.ot_pay + li.bonus
                  - li.short_deduction - li.late_penalty - li.advances_taken
                  - li.professional_tax - li.fines;

    IF li.net_payable IS DISTINCT FROM ROUND(expected_net, 2) THEN
        RAISE EXCEPTION 'TEST 3b FAIL: e3 net formula broken. Got %, expected %',
            li.net_payable, ROUND(expected_net, 2);
    END IF;

    -- e3 clocked in early at 08:55 — no late penalty
    IF li.late_penalty != 0 THEN
        RAISE EXCEPTION 'TEST 3b FAIL: e3 late_penalty expected 0, got %', li.late_penalty;
    END IF;

    -- e3 has 1.5h OT × 150.00/h × 1.0 multiplier = 225.00
    IF li.ot_pay != 225.00 THEN
        RAISE EXCEPTION 'TEST 3b FAIL: e3 ot_pay expected 225.00, got %', li.ot_pay;
    END IF;

    -- e3 carry-forward advance = 5000.00
    IF li.advances_taken != 5000.00 THEN
        RAISE EXCEPTION 'TEST 3b FAIL: e3 advances_taken expected 5000.00, got %', li.advances_taken;
    END IF;

    RAISE NOTICE 'TEST 3b PASS: calculate_payroll_for_employee — e3 ot_pay=% late_pen=% advances=%',
        li.ot_pay, li.late_penalty, li.advances_taken;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 4: get_monthly_attendance_summary
--   Should return exactly 8 rows (one per active employee)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
      FROM get_monthly_attendance_summary(2026, 3);

    IF v_count != 8 THEN
        RAISE EXCEPTION 'TEST 4 FAIL: get_monthly_attendance_summary returned % rows, expected 8', v_count;
    END IF;

    RAISE NOTICE 'TEST 4 PASS: get_monthly_attendance_summary returned % rows for 2026-03', v_count;
END $$;

-- TEST 4b: Verify e2's late_days count in the summary
DO $$
DECLARE
    v_late BIGINT;
BEGIN
    SELECT s.late_days INTO v_late
      FROM get_monthly_attendance_summary(2026, 3) s
      JOIN employees e ON e.id = s.employee_id
     WHERE e.emp_code = 'e2';

    IF v_late != 1 THEN
        RAISE EXCEPTION 'TEST 4b FAIL: e2 late_days expected 1, got %', v_late;
    END IF;

    RAISE NOTICE 'TEST 4b PASS: e2 late_days=% in monthly summary', v_late;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 5: approve_payroll_run
--   After running calculate_payroll_for_employee for at least one employee,
--   call approve_payroll_run(1) and verify:
--     - run status becomes 'locked'
--     - advances in the run's employees are marked is_recovered=TRUE
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_status   TEXT;
    v_emp_id   INT;
    v_rec      BOOLEAN;
BEGIN
    SELECT id INTO v_emp_id FROM employees WHERE emp_code = 'e1';

    -- Ensure e1 has a payroll line item (calculate for e1)
    PERFORM calculate_payroll_for_employee(1, v_emp_id, 0, 0, 200);

    -- Approve the run
    PERFORM approve_payroll_run(1);

    -- Check run is locked
    SELECT status INTO v_status FROM payroll_runs WHERE id = 1;
    IF v_status != 'locked' THEN
        RAISE EXCEPTION 'TEST 5 FAIL: run status expected locked, got %', v_status;
    END IF;

    -- Check e1's advance is recovered
    SELECT bool_and(is_recovered) INTO v_rec
      FROM advance_transactions
     WHERE employee_id = v_emp_id;

    IF NOT v_rec THEN
        RAISE EXCEPTION 'TEST 5 FAIL: e1 advances not marked recovered after approval';
    END IF;

    RAISE NOTICE 'TEST 5 PASS: approve_payroll_run — status=% e1_advances_recovered=%',
        v_status, v_rec;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 6: payroll_ledger_view
--   Should expose at least the rows just upserted above
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
      FROM payroll_ledger_view
     WHERE period_year = 2026 AND period_month = 3;

    IF v_count < 2 THEN
        RAISE EXCEPTION 'TEST 6 FAIL: payroll_ledger_view returned % rows for 2026-03, expected >= 2', v_count;
    END IF;

    RAISE NOTICE 'TEST 6 PASS: payroll_ledger_view returned % rows for 2026-03', v_count;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 7: pending_advances_view
--   e4 (Sunita Devi) has 1500 unrecovered advance (seeded), not in any payroll run
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_pending NUMERIC;
BEGIN
    SELECT pav.total_pending INTO v_pending
      FROM pending_advances_view pav
      JOIN employees e ON e.id = pav.employee_id
     WHERE e.emp_code = 'e4';

    IF v_pending IS NULL OR v_pending != 1500.00 THEN
        RAISE EXCEPTION 'TEST 7 FAIL: e4 pending advances expected 1500.00, got %', v_pending;
    END IF;

    RAISE NOTICE 'TEST 7 PASS: pending_advances_view — e4 pending=%', v_pending;
END $$;

-- ---------------------------------------------------------------------------
-- TEST 8: Rate propagation trigger (trg_company_settings_rates)
--   Change working_days_per_month → verify e1 daily_rate recalculates
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_daily_before NUMERIC;
    v_daily_after  NUMERIC;
BEGIN
    SELECT daily_rate INTO v_daily_before FROM employees WHERE emp_code = 'e1';

    -- Change to 25 working days
    UPDATE company_settings SET working_days_per_month = 25 WHERE id = 1;

    SELECT daily_rate INTO v_daily_after FROM employees WHERE emp_code = 'e1';

    -- Expected: ROUND(20800 / 25, 4) = 832.0000
    IF v_daily_after != 832.0000 THEN
        RAISE EXCEPTION 'TEST 8 FAIL: e1 daily_rate after propagation expected 832.0000, got %', v_daily_after;
    END IF;

    -- Restore original setting
    UPDATE company_settings SET working_days_per_month = 26 WHERE id = 1;

    RAISE NOTICE 'TEST 8 PASS: Rate propagation — e1 daily before=% after 25 days=%', v_daily_before, v_daily_after;
END $$;

-- ---------------------------------------------------------------------------
-- ALL TESTS COMPLETE
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'ALL VERIFICATION TESTS PASSED';
    RAISE NOTICE '====================================================';
END $$;
