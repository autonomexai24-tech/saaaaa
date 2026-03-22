import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

// GET /api/attendance?date=YYYY-MM-DD
// Returns all employees with their attendance log for the given date (or today)
router.get("/", async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const { rows } = await pool.query(
      `SELECT
         e.id          AS employee_id,
         e.emp_code,
         e.name,
         UPPER(SUBSTRING(e.name FROM 1 FOR 1) || COALESCE(SUBSTRING(e.name FROM POSITION(' ' IN e.name) + 1 FOR 1), '')) AS avatar,
         d.name        AS department,
         des.name      AS designation,
         e.daily_rate,
         e.hourly_rate,
         e.monthly_basic,
         al.id         AS log_id,
         al.time_in::TEXT    AS time_in,
         al.time_out::TEXT   AS time_out,
         al.status,
         al.hours_worked,
         al.ot_hours,
         al.late_minutes,
         al.penalty_amount,
         al.advance_given
       FROM employees e
       LEFT JOIN departments  d   ON d.id   = e.department_id
       LEFT JOIN designations des ON des.id = e.designation_id
       LEFT JOIN attendance_logs al ON al.employee_id = e.id AND al.log_date = $1
       WHERE e.is_active = TRUE
       ORDER BY e.name`,
      [date]
    );
    // Trim time strings and normalise nulls
    const result = rows.map((r) => ({
      ...r,
      time_in:  r.time_in  ? r.time_in.slice(0, 5)  : "",
      time_out: r.time_out ? r.time_out.slice(0, 5) : "",
      advance_given: r.advance_given ?? 0,
    }));
    return res.json(result);
  } catch (err: any) {
    console.error("[attendance] GET error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance — upsert one attendance log row
// Body: { employee_id, date, time_in, time_out, advance_given?, notes? }
router.post("/", async (req: Request, res: Response) => {
  try {
    const { employee_id, date, time_in, time_out, advance_given = 0, notes } = req.body;
    if (!employee_id || !date) {
      return res.status(400).json({ error: "employee_id and date are required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO attendance_logs (employee_id, log_date, time_in, time_out, advance_given, notes)
       VALUES ($1, $2, $3::TIME, $4::TIME, $5, $6)
       ON CONFLICT (employee_id, log_date) DO UPDATE SET
         time_in      = EXCLUDED.time_in,
         time_out     = EXCLUDED.time_out,
         advance_given = EXCLUDED.advance_given,
         notes        = EXCLUDED.notes
       RETURNING
         id, employee_id, log_date,
         time_in::TEXT AS time_in,
         time_out::TEXT AS time_out,
         status, hours_worked, ot_hours, late_minutes, penalty_amount, advance_given`,
      [employee_id, date, time_in || null, time_out || null, advance_given, notes || null]
    );

    const row = rows[0];
    return res.json({
      ...row,
      time_in:  row.time_in  ? row.time_in.slice(0, 5)  : "",
      time_out: row.time_out ? row.time_out.slice(0, 5) : "",
    });
  } catch (err: any) {
    console.error("[attendance] POST error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/monthly-summary?year=YYYY&month=MM
router.get("/monthly-summary", async (req: Request, res: Response) => {
  try {
    const year  = parseInt(req.query.year  as string || "2026", 10);
    const month = parseInt(req.query.month as string || "3",    10);
    const { rows } = await pool.query(
      "SELECT * FROM get_monthly_attendance_summary($1, $2)",
      [year, month]
    );
    return res.json(rows);
  } catch (err: any) {
    console.error("[attendance] monthly-summary error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
