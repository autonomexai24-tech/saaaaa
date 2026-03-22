import { Router } from "express";
import pool from "../db";

const router = Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // In a real app we would hash the password, but schema.sql only has plain 'dummy_password'
    const result = await pool.query(
      `SELECT id, name, email, role, is_active FROM profiles 
       WHERE email = $1 AND dummy_password = $2 AND is_active = true`,
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials or inactive account" });
    }

    const user = result.rows[0];
    
    // Simulate setting a session or returning a token. 
    // We'll return the user info directly for the client-side AuthContext.
    res.json({ user });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
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
