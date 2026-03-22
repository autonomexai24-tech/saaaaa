import JSZip from "jszip";
import pool from "../db";
import { generatePayslipPdf } from "./generatePayslip";

const monthName = (m: number) =>
  ["January","February","March","April","May","June",
   "July","August","September","October","November","December"][m - 1];

/**
 * Generate a ZIP containing individual PDF payslips for every employee
 * in the given payroll period.
 */
export async function generateBulkZip(year: number, month: number): Promise<Buffer> {
  // Fetch all payslip rows for the period
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
     WHERE pr.period_year = $1 AND pr.period_month = $2
     ORDER BY e.name`,
    [year, month]
  );

  if (rows.length === 0) {
    throw new Error("No payslip data found for this period. Run payroll first.");
  }

  // Fetch company settings once
  const { rows: settingsRows } = await pool.query(
    "SELECT company_name, company_address, logo_path FROM company_settings WHERE id = 1"
  );
  const settings = settingsRows[0] || { company_name: "Your Company", company_address: "", logo_path: null };

  const zip = new JSZip();
  const mName = monthName(month);

  // Generate each PDF and add to ZIP — clear buffer references for GC
  for (const row of rows) {
    const pdfBuffer = await generatePayslipPdf(row, settings, year, month);
    const empName = (row.emp_name || "Employee").replace(/[^a-zA-Z0-9_ ]/g, "").replace(/\s+/g, "_");
    const fileName = `${empName}_Payslip_${mName}_${year}.pdf`;
    zip.file(fileName, pdfBuffer);
  }

  // Generate the ZIP buffer
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return zipBuffer;
}
