import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("[db] ❌ DATABASE_URL is not set in .env — server cannot start.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  // SSL support for Easypanel / cloud PostgreSQL
  ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 4000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

pool.on("connect", () => {
  console.log("[db] ✅ Pool connected to PostgreSQL");
});

export default pool;
