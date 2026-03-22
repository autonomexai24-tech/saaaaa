import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

import companyRouter    from "./routes/company";
import employeesRouter  from "./routes/employees";
import attendanceRouter from "./routes/attendance";
import payrollRouter    from "./routes/payroll";
import payslipsRouter   from "./routes/payslips";
import authRouter       from "./routes/auth";
import usersRouter      from "./routes/users";
import transactionsRouter from "./routes/transactions";

const app  = express();
const PORT = Number(process.env.PORT || 5000);

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files (logos) as static assets
app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/api/auth",        authRouter);
app.use("/api/users",       usersRouter);
app.use("/api/settings",    companyRouter);
app.use("/api/employees",   employeesRouter);
app.use("/api/attendance",  attendanceRouter);
app.use("/api/transactions",transactionsRouter);
app.use("/api/payroll",     payrollRouter);
app.use("/api/payslips",    payslipsRouter);

// Health check
app.get("/api/health", (_req, res) => res.json({ status: "ok", time: new Date() }));

// ── API 404 catch-all (only for /api/* routes) ────────────────────────────
app.all("/api/*", (_req, res) => res.status(404).json({ error: "API route not found" }));

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Production: serve Vite-built frontend ──────────────────────────────────
const distPath = path.join(__dirname, '../../dist'); 
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Salary Tracker API ready → http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Static: serving ./dist\n`);
});

export default app;

