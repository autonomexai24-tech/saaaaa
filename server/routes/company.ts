import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import pool from "../db";

const router = Router();

// multer: save logos to public/uploads/
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/settings/company
router.get("/", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         company_name, company_address, logo_path,
         shift_start, shift_end, working_hours_per_day,
         grace_period_minutes, ot_multiplier, penalty_per_minute,
         annual_paid_leaves, monthly_leave_accrual, unused_leave_action,
         working_days_per_month
       FROM company_settings WHERE id = 1`
    );
    if (!rows[0]) return res.status(404).json({ error: "Settings not found" });
    // Normalise time fields to "HH:MM" strings
    const s = rows[0];
    s.shift_start = String(s.shift_start).slice(0, 5);
    s.shift_end   = String(s.shift_end).slice(0, 5);
    return res.json(s);
  } catch (err: any) {
    console.error("[company] GET error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/company
router.put("/", async (req: Request, res: Response) => {
  try {
    const {
      company_name, company_address,
      shift_start, shift_end, working_hours_per_day,
      grace_period_minutes, ot_multiplier, penalty_per_minute,
      annual_paid_leaves, monthly_leave_accrual, unused_leave_action,
      working_days_per_month,
    } = req.body;

    await pool.query(
      `UPDATE company_settings SET
         company_name           = COALESCE($1, company_name),
         company_address        = COALESCE($2, company_address),
         shift_start            = COALESCE($3::TIME, shift_start),
         shift_end              = COALESCE($4::TIME, shift_end),
         working_hours_per_day  = COALESCE($5, working_hours_per_day),
         grace_period_minutes   = COALESCE($6, grace_period_minutes),
         ot_multiplier          = COALESCE($7, ot_multiplier),
         penalty_per_minute     = COALESCE($8, penalty_per_minute),
         annual_paid_leaves     = COALESCE($9, annual_paid_leaves),
         monthly_leave_accrual  = COALESCE($10, monthly_leave_accrual),
         unused_leave_action    = COALESCE($11, unused_leave_action),
         working_days_per_month = COALESCE($12, working_days_per_month)
       WHERE id = 1`,
      [
        company_name, company_address,
        shift_start, shift_end, working_hours_per_day,
        grace_period_minutes, ot_multiplier, penalty_per_minute,
        annual_paid_leaves, monthly_leave_accrual, unused_leave_action,
        working_days_per_month,
      ]
    );
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[company] PUT error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/logo  (multipart)
router.post("/logo", upload.single("logo"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const logoPath = `/uploads/${req.file.filename}`;
    await pool.query("UPDATE company_settings SET logo_path = $1 WHERE id = 1", [logoPath]);
    return res.json({ ok: true, logo_path: logoPath });
  } catch (err: any) {
    console.error("[company] logo upload error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/departments — list all departments
router.get("/departments", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT id, name FROM departments ORDER BY name");
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/departments
router.post("/departments", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name",
      [name]
    );
    return res.json(rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/settings/departments/:id
router.delete("/departments/:id", async (req: Request, res: Response) => {
  try {
    await pool.query("DELETE FROM departments WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/designations
router.get("/designations", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT id, name FROM designations ORDER BY name");
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/designations
router.post("/designations", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO designations (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name",
      [name]
    );
    return res.json(rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/settings/designations/:id
router.delete("/designations/:id", async (req: Request, res: Response) => {
  try {
    await pool.query("DELETE FROM designations WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/holidays
router.get("/holidays", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT id, date, name FROM holidays ORDER BY date");
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/holidays
router.post("/holidays", async (req: Request, res: Response) => {
  try {
    const { date, name } = req.body;
    const { rows } = await pool.query(
      "INSERT INTO holidays (date, name) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name RETURNING id, date, name",
      [date, name]
    );
    return res.json(rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/settings/holidays/:id
router.delete("/holidays/:id", async (req: Request, res: Response) => {
  try {
    await pool.query("DELETE FROM holidays WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
