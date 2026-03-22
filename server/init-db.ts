// =============================================================================
//  init-db.ts — Remote Database Initializer
//  Usage: npx tsx server/init-db.ts
//
//  This script connects to the DATABASE_URL and executes final_production.sql
//  over the network. This avoids the need for a local 'psql' installation.
// =============================================================================
import pool from "./db";
import fs from "fs";
import path from "path";

async function initializeDatabase() {
  console.log("\n🚀 Initializing Remote PostgreSQL Database...\n");
  console.log(`   Target: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@")}\n`);

  try {
    const client = await pool.connect();
    
    const sqlPath = path.join(process.cwd(), "database", "final_production.sql");
    console.log(`   Reading: ${sqlPath}`);
    const sqlString = fs.readFileSync(sqlPath, "utf-8");

    console.log("   Executing SQL (this may take a few seconds)...");
    
    // Execute the massive SQL string in one go
    await client.query(sqlString);

    console.log("\n✅ Database Schema & Seed Data applied successfully!");
    
    // Verify creation
    const res = await client.query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'");
    console.log(`   Total tables created: ${res.rows[0].count}`);

    client.release();
  } catch (err: any) {
    console.error("\n❌ Database Initialization Failed!");
    console.error(err.message);
  } finally {
    await pool.end();
  }
}

initializeDatabase();
