import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

// Helper to ensure a payroll run exists for year/month
async function getOrCreateRun(year: number, month: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO payroll_runs (period_year, period_month, status)
     VALUES ($1, $2, 'draft')
     ON CONFLICT (period_year, period_month) DO UPDATE SET period_year = EXCLUDED.period_year
     RETURNING id`,
    [year, month]
  );
  return rows[0].id;
}

// GET /api/payroll/runs  — list all runs
router.get("/runs", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, period_year, period_month, status, approved_by, approved_at FROM payroll_runs ORDER BY period_year DESC, period_month DESC"
    );
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/payroll/ledger?year=YYYY&month=MM
// Returns a full payroll ledger (calls calculate_payroll_for_employee for each active employee)
router.get("/ledger", async (req: Request, res: Response) => {
  try {
    const year  = parseInt(req.query.year  as string || "2026", 10);
    const month = parseInt(req.query.month as string || "3",    10);

    const runId = await getOrCreateRun(year, month);

    // Get all active employees
    const { rows: emps } = await pool.query(
      "SELECT id FROM employees WHERE is_active = TRUE"
    );

    // Calculate each employee (upserts into payroll_line_items)
    for (const emp of emps) {
      await pool.query(
        "SELECT calculate_payroll_for_employee($1, $2)",
        [runId, emp.id]
      );
    }

    // Return the full ledger joined with employee details
    const { rows } = await pool.query(
      `SELECT
         pli.id,
         pli.payroll_run_id,
         e.id          AS employee_id,
         e.emp_code,
         e.name,
         UPPER(SUBSTRING(e.name FROM 1 FOR 1) || COALESCE(SUBSTRING(e.name FROM POSITION(' ' IN e.name) + 1 FOR 1), '')) AS avatar,
         d.name        AS department,
         des.name      AS designation,
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
         pli.advances_taken,
         pli.professional_tax,
         pli.fines,
         pli.gross_earnings,
         pli.total_deductions,
         pli.net_payable,
         pli.leave_balance_snap,
         pr.status     AS run_status
       FROM payroll_line_items pli
       JOIN employees    e   ON e.id   = pli.employee_id
       LEFT JOIN departments  d   ON d.id   = e.department_id
       LEFT JOIN designations des ON des.id = e.designation_id
       JOIN payroll_runs pr  ON pr.id = pli.payroll_run_id
       WHERE pli.payroll_run_id = $1
       ORDER BY e.name`,
      [runId]
    );

    return res.json({ run_id: runId, year, month, status: rows[0]?.run_status ?? "draft", employees: rows });
  } catch (err: any) {
    console.error("[payroll] ledger error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payroll/calculate — recalculate one employee with overrides
// Body: { run_id, employee_id, bonus, fines, professional_tax }
router.post("/calculate", async (req: Request, res: Response) => {
  try {
    const { run_id, employee_id, bonus = 0, fines = 0, professional_tax = 0 } = req.body;
    if (!run_id || !employee_id) {
      return res.status(400).json({ error: "run_id and employee_id are required" });
    }
    const { rows } = await pool.query(
      "SELECT calculate_payroll_for_employee($1, $2, $3, $4, $5)",
      [run_id, employee_id, bonus, fines, professional_tax]
    );
    return res.json(rows[0].calculate_payroll_for_employee);
  } catch (err: any) {
    console.error("[payroll] calculate error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payroll/approve — lock a run and mark advances as recovered
// Body: { run_id }
router.post("/approve", async (req: Request, res: Response) => {
  try {
    const { run_id } = req.body;
    if (!run_id) return res.status(400).json({ error: "run_id is required" });
    await pool.query("SELECT approve_payroll_run($1)", [run_id]);
    return res.json({ ok: true, run_id });
  } catch (err: any) {
    console.error("[payroll] approve error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
