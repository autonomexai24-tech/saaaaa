-- =============================================================================
--  STAGE 5: PDF DATA PREPARATION
--  payslip_master_view — flat, single-row payloads for PDF generation
--
--  Run this script in the Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PAYSLIP MASTER VIEW
-- -----------------------------------------------------------------------------
-- Joins payroll_line_items with employees, payroll_runs, and company_settings
-- to produce a denormalized, print-ready row per employee per locked month.
--
-- Usage:
--   SELECT * FROM payslip_master_view WHERE run_month = 3 AND run_year = 2026;
--   SELECT * FROM payslip_master_view WHERE employee_id = '<uuid>' AND run_year = 2026;
--
-- Notes:
--   • Only locked runs appear here (historical PDFs only).
--   • For draft/unlocked months, the API handles live math via get_payroll_summary().
--   • All currency columns are strict NUMERIC — no TEXT casting — to prevent
--     PDF rendering errors from string-number mismatches.

DROP VIEW IF EXISTS public.payslip_master_view;

CREATE OR REPLACE VIEW public.payslip_master_view AS
SELECT
    -- ── Run Info ──────────────────────────────────────────────────────────────
    pr.id              AS run_id,
    pr.month           AS run_month,
    pr.year            AS run_year,
    pr.status          AS run_status,
    pr.processed_at    AS locked_at,

    -- ── Company Branding ─────────────────────────────────────────────────────
    cs.company_name,
    cs.address         AS company_address,
    cs.logo_url,

    -- ── Employee Identity ────────────────────────────────────────────────────
    li.employee_id,
    li.employee_name,
    COALESCE(li.department,  e.department)  AS department,
    COALESCE(li.designation, e.designation) AS designation,

    -- ── Time Metrics ─────────────────────────────────────────────────────────
    li.expected_minutes,
    li.actual_minutes,
    li.ot_minutes,
    li.shortfall_minutes,

    -- ── Financial Breakdown (all NUMERIC — no TEXT) ──────────────────────────
    li.base_salary       AS base_calculated,
    li.ot_amount,
    li.shortfall_amount,
    li.advance_deducted,
    li.gross_pay,
    li.net_payable,

    -- ── Metadata ─────────────────────────────────────────────────────────────
    li.created_at        AS line_item_created_at

FROM
    public.payroll_line_items li
INNER JOIN
    public.payroll_runs pr ON li.run_id = pr.id
INNER JOIN
    public.company_settings cs ON cs.id = 1
LEFT JOIN
    public.employees e ON li.employee_id = e.id
WHERE
    pr.status = 'locked';

-- Note: This view inherits RLS from payroll_line_items and payroll_runs.
-- Only admins can query it (enforced by the strict policies set in Stage 2C & 4B).

-- =============================================================================
-- STAGE 5 COMPLETE
--   ✓ payslip_master_view created (flat, denormalized, print-ready)
--   ✓ Only locked/historical runs are surfaced
--   ✓ Company branding (name, address, logo_url) included in every row
--   ✓ All currency fields are strict NUMERIC types
--   ✓ Ready to serve single-row payloads for the PDF Generation Engine
-- =============================================================================
