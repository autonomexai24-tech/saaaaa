import { Router } from "express";
import pool from "../db";

const router = Router();

// GET /api/users - List active users
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email as "userId", role FROM profiles WHERE is_active = true ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Fetch users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// POST /api/users - Create new user
router.post("/", async (req, res) => {
  const { name, userId, role, password } = req.body;
  
  if (!name || !userId || !role || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Check if email already exists
    const existing = await pool.query(`SELECT id FROM profiles WHERE email = $1`, [userId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "User ID / Email is already taken" });
    }

    // Ensure role is exactly 'admin' or 'operator' for database constraint
    const dbRole = role.toLowerCase() === "admin" ? "admin" : "operator";

    const result = await pool.query(
      `INSERT INTO profiles (name, email, role, dummy_password, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, email as "userId", role`,
      [name, userId, dbRole, password]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// PUT /api/users/:id/revoke - Revoke access (soft delete)
router.put("/:id/revoke", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE profiles SET is_active = false WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Revoke user error:", error);
    res.status(500).json({ error: "Failed to revoke user" });
  }
});

export default router;
