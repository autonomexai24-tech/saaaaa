import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Sensible defaults for local dev
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 4000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

export default pool;
