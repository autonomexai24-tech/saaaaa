import { Router, Request, Response } from "express";
import pool from "../db";

const router = Router();

// GET /api/transactions/balances - Get pending advances per employee
router.get("/balances", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT employee_id, total_pending as pending_advances 
       FROM pending_advances_view`
    );
    return res.json(rows);
  } catch (err: any) {
    console.error("[transactions] GET balances error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions - Record a new advance
router.post("/", async (req: Request, res: Response) => {
  try {
    const { employee_id, amount, purpose } = req.body;
    
    if (!employee_id || !amount) {
      return res.status(400).json({ error: "employee_id and amount are required" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than 0" });
    }

    const { rows } = await pool.query(
      `INSERT INTO advance_transactions (employee_id, txn_date, amount, purpose, is_recovered)
       VALUES ($1, CURRENT_DATE, $2, $3, FALSE)
       RETURNING *`,
      [employee_id, amount, purpose || "Advance"]
    );

    return res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[transactions] POST advance error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
