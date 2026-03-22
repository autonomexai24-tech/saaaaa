import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

// GET /api/employees  — all active employees with dept & designation names
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         e.id, e.emp_code, e.name, e.phone,
         d.name  AS department,
         des.name AS designation,
         e.monthly_basic, e.daily_rate, e.hourly_rate,
         e.leave_balance, e.is_active, e.joined_on,
         d.id   AS department_id,
         des.id AS designation_id,
         UPPER(SUBSTRING(e.name FROM 1 FOR 1) || COALESCE(SUBSTRING(e.name FROM POSITION(' ' IN e.name) + 1 FOR 1), '')) AS avatar
       FROM employees e
       LEFT JOIN departments  d   ON d.id   = e.department_id
       LEFT JOIN designations des ON des.id = e.designation_id
       WHERE e.is_active = TRUE
       ORDER BY e.name`
    );
    return res.json(rows);
  } catch (err: any) {
    console.error("[employees] GET error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/employees — create new employee (trigger auto-fills daily/hourly rate)
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      name, phone,
      department_id, designation_id,
      monthly_basic, joined_on,
    } = req.body;

    if (!name || !monthly_basic) {
      return res.status(400).json({ error: "name and monthly_basic are required" });
    }

    // Auto-generate emp_code
    const { rows: countRows } = await pool.query("SELECT COUNT(*) FROM employees");
    const count = parseInt(countRows[0].count, 10);
    const emp_code = `EMP${String(count + 1).padStart(3, "0")}`;

    const { rows } = await pool.query(
      `INSERT INTO employees (emp_code, name, phone, department_id, designation_id, monthly_basic, joined_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [emp_code, name, phone || null, department_id || null, designation_id || null, monthly_basic, joined_on || null]
    );
    return res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[employees] POST error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/:id — update employee
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const {
      name, phone,
      department_id, designation_id,
      monthly_basic, leave_balance, is_active,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE employees SET
         name           = COALESCE($1, name),
         phone          = COALESCE($2, phone),
         department_id  = COALESCE($3, department_id),
         designation_id = COALESCE($4, designation_id),
         monthly_basic  = COALESCE($5, monthly_basic),
         leave_balance  = COALESCE($6, leave_balance),
         is_active      = COALESCE($7, is_active)
       WHERE id = $8
       RETURNING *`,
      [name, phone, department_id, designation_id, monthly_basic, leave_balance, is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Employee not found" });
    return res.json(rows[0]);
  } catch (err: any) {
    console.error("[employees] PUT error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
