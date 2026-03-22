// =============================================================================
//  test-db.ts — Quick database connection tester
//  Usage: npx tsx server/test-db.ts
// =============================================================================
import pool from "./db";

async function testConnection() {
  console.log("\n🔍 Testing database connection...\n");
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@") || "NOT SET"}\n`);

  try {
    const client = await pool.connect();

    // Basic connectivity
    const timeResult = await client.query("SELECT NOW() AS server_time, version() AS pg_version");
    const { server_time, pg_version } = timeResult.rows[0];
    console.log("✅ Connected to Easypanel DB");
    console.log(`   Server Time : ${server_time}`);
    console.log(`   PG Version  : ${pg_version.split(",")[0]}`);

    // Check if our tables exist
    const tablesResult = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = tablesResult.rows.map((r: any) => r.table_name);
    console.log(`\n   Tables found : ${tables.length}`);
    tables.forEach((t: string) => console.log(`     • ${t}`));

    // Check profiles (login table)
    const profilesResult = await client.query("SELECT COUNT(*) AS cnt FROM profiles");
    console.log(`\n   Profiles     : ${profilesResult.rows[0].cnt} user(s) seeded`);

    client.release();
    console.log("\n🎉 All checks passed — database is ready!\n");
  } catch (err: any) {
    console.error("❌ Connection Failed");
    console.error(`   Error: ${err.message}`);
    if (err.code === "ECONNREFUSED") {
      console.error("   Hint: Is PostgreSQL running? Check your DATABASE_URL in .env");
    }
    if (err.code === "3D000") {
      console.error("   Hint: Database does not exist. Create it first.");
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
