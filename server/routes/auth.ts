import { Router } from "express";
import pool from "../db";

const router = Router();

// Fallback credentials (mirrors seed.sql) — used when PostgreSQL is unavailable
const FALLBACK_USERS = [
  { id: 1, name: "Admin User",  email: "admin@printworks.com",     role: "admin",    password: "password123" },
  { id: 2, name: "Front Desk",  email: "frontdesk@printworks.com", role: "operator", password: "password123" },
];

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // Try database first
    const result = await pool.query(
      `SELECT id, name, email, role, is_active FROM profiles 
       WHERE email = $1 AND dummy_password = $2 AND is_active = true`,
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials or inactive account" });
    }

    const user = result.rows[0];
    return res.json({ user });
  } catch (dbError: any) {
    console.warn("[auth] Database unavailable, using fallback credentials:", dbError.code || dbError.message);

    // Fallback: match against hardcoded seed users
    const match = FALLBACK_USERS.find(u => u.email === email && u.password === password);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { password: _pw, ...user } = match;
    return res.json({ user });
  }
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  // In a real app, verify JWT or Session cookie here
  // For this integration task, we assume the frontend holds the user state
  // This endpoint can be used if session cookies are implemented later
  res.status(401).json({ error: "Not authenticated" }); 
});

export default router;
