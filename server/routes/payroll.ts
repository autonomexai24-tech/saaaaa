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
// Calls get_unified_payroll() — the database handles lock-vs-draft routing
router.get("/ledger", async (req: Request, res: Response) => {
  try {
    const year  = parseInt(req.query.year  as string || "2026", 10);
    const month = parseInt(req.query.month as string || "3",    10);

    const { rows } = await pool.query(
      "SELECT get_unified_payroll($1, $2) AS result",
      [month, year]
    );

    const envelope = rows[0].result;
    // envelope = { is_locked: bool, run_id: int|null, data: [...] }

    return res.json({
      run_id:    envelope.run_id,
      year,
      month,
      status:    envelope.is_locked ? "locked" : "draft",
      employees: envelope.data ?? [],
    });
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
