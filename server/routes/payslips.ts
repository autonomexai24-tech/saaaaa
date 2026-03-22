import { Router, Request, Response } from "express";
import pool from "../db";
import { generatePayslipPdf } from "../pdf/generatePayslip";
import { generateBulkZip } from "../pdf/generateBulkZip";

const router = Router();

const monthName = (m: number) =>
  ["January","February","March","April","May","June",
   "July","August","September","October","November","December"][m - 1];

// GET /api/payslips/download-bulk?year=YYYY&month=MM
// Streams a ZIP containing individual PDF payslips for every employee
router.get("/download-bulk", async (req: Request, res: Response) => {
  try {
    const year  = parseInt(req.query.year  as string || "2026", 10);
    const month = parseInt(req.query.month as string || "3",    10);

    const zipBuffer = await generateBulkZip(year, month);

    const mName = monthName(month);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="Salary_Tracker_Export_${mName}_${year}.zip"`);
    res.setHeader("Content-Length", zipBuffer.length);
    return res.end(zipBuffer);
  } catch (err: any) {
    console.error("[payslips] bulk ZIP error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});
// GET /api/payslips?year=YYYY&month=MM
// Returns all approved payslip line items for the month
router.get("/", async (req: Request, res: Response) => {
  try {
    const year  = parseInt(req.query.year  as string || "2026", 10);
    const month = parseInt(req.query.month as string || "3",    10);

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
       WHERE pr.period_year = $1 AND pr.period_month = $2
       ORDER BY e.name`,
      [year, month]
    );

    return res.json(rows);
  } catch (err: any) {
    console.error("[payslips] GET error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/payslips/:employeeId/pdf?year=YYYY&month=MM
// Streams a generated PDF payslip for the employee
router.get("/:employeeId/pdf", async (req: Request, res: Response) => {
  try {
    const year  = parseInt(req.query.year  as string || "2026", 10);
    const month = parseInt(req.query.month as string || "3",    10);
    const employeeId = req.params.employeeId;

    // Fetch payslip data
    const { rows } = await pool.query(
      `SELECT
         pli.*,
         e.id AS emp_id, e.emp_code, e.name AS emp_name, e.phone,
         d.name AS department, des.name AS designation,
         e.leave_balance
       FROM payroll_line_items pli
       JOIN employees    e   ON e.id   = pli.employee_id
       LEFT JOIN departments  d   ON d.id   = e.department_id
       LEFT JOIN designations des ON des.id = e.designation_id
       JOIN payroll_runs pr  ON pr.id = pli.payroll_run_id
       WHERE pr.period_year = $1 AND pr.period_month = $2 AND e.id = $3`,
      [year, month, employeeId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Payslip not found. Run payroll calculation first." });
    }

    // Fetch company settings (for header + logo)
    const { rows: settingsRows } = await pool.query(
      "SELECT company_name, company_address, logo_path FROM company_settings WHERE id = 1"
    );
    const settings = settingsRows[0] || { company_name: "Your Company", company_address: "", logo_path: null };

    const pdfBuffer = await generatePayslipPdf(rows[0], settings, year, month);

    const empName = rows[0].emp_name.replace(/\s+/g, "_");
    const monthStr = String(month).padStart(2, "0");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Payslip_${empName}_${year}-${monthStr}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err: any) {
    console.error("[payslips] PDF error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
