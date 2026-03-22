// =============================================================================
//  src/types/database.types.ts
//  TypeScript interfaces that mirror Agent 1's PostgreSQL schema exactly.
//  Generated from:  database/schema.sql  (Salary & Advance Tracker · Stage 1B)
//
//  Column types follow this mapping:
//    SQL TEXT            → string
//    SQL INT / SERIAL    → number
//    SQL NUMERIC(p,s)    → number
//    SQL BOOLEAN         → boolean
//    SQL DATE            → string   (ISO "YYYY-MM-DD")
//    SQL TIME            → string   (ISO "HH:MM:SS")
//    SQL TIMESTAMPTZ     → string   (ISO 8601)
//    NULL-able columns   → T | null
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
//  1. COMPANY_SETTINGS  (singleton — row id is always 1)
// ─────────────────────────────────────────────────────────────────────────────
export interface CompanySettings {
  /** Always 1 — this table has exactly one row */
  id: 1;
  company_name: string;
  company_address: string;
  /** Relative URL / file path of the uploaded logo, e.g. "/uploads/logo-123.png" */
  logo_path: string | null;
  /** "HH:MM" 24-hour format */
  shift_start: string;
  /** "HH:MM" 24-hour format */
  shift_end: string;
  /** e.g. 8 — billable hours per working day */
  working_hours_per_day: number;
  /** Minutes of tolerance before lateness penalty kicks in */
  grace_period_minutes: number;
  /** OT pay multiplier — 1.0 = same hourly rate, 1.5 = time-and-a-half */
  ot_multiplier: number;
  /** Rupees deducted per minute of lateness beyond the grace window */
  penalty_per_minute: number;
  /** Total paid leave days per calendar year */
  annual_paid_leaves: number;
  /** Leaves accrued per calendar month */
  monthly_leave_accrual: number;
  /** What happens to unused leave at year-end */
  unused_leave_action: "carry_forward" | "encash" | "expire";
  /** Days considered a full working month for rate calculations */
  working_days_per_month: number;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  2. DEPARTMENTS
// ─────────────────────────────────────────────────────────────────────────────
export interface Department {
  id: number;
  name: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  3. DESIGNATIONS
// ─────────────────────────────────────────────────────────────────────────────
export interface Designation {
  id: number;
  name: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  4. EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────────
export interface Employee {
  id: number;
  /** Human-readable code, e.g. "EMP001". May be NULL for legacy rows */
  emp_code: string | null;
  name: string;
  phone: string | null;
  /** FK → departments.id */
  department_id: number | null;
  /** FK → designations.id */
  designation_id: number | null;
  monthly_basic: number;
  /** Auto-computed by trigger: monthly_basic / working_days_per_month */
  daily_rate: number;
  /** Auto-computed by trigger: daily_rate / working_hours_per_day */
  hourly_rate: number;
  /** Running leave balance (days) */
  leave_balance: number;
  is_active: boolean;
  /** "YYYY-MM-DD" */
  joined_on: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  4b. EMPLOYEE (with resolved JOIN fields) — returned by most API routes
// ─────────────────────────────────────────────────────────────────────────────
export interface EmployeeWithDetails extends Employee {
  /** Resolved from departments.name */
  department: string | null;
  /** Resolved from designations.name */
  designation: string | null;
  /** Two-letter initials for avatar placeholder */
  avatar: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  5. HOLIDAYS
// ─────────────────────────────────────────────────────────────────────────────
export interface Holiday {
  id: number;
  /** "YYYY-MM-DD" */
  date: string;
  name: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  6. ATTENDANCE_LOGS
// ─────────────────────────────────────────────────────────────────────────────
export type AttendanceStatus =
  | "present"
  | "late"
  | "absent"
  | "holiday"
  | "paid_leave"
  | "pending";

export interface AttendanceLog {
  id: number;
  /** FK → employees.id */
  employee_id: number;
  /** "YYYY-MM-DD" */
  log_date: string;
  /** "HH:MM" — null means not clocked in yet */
  time_in: string | null;
  /** "HH:MM" — null means not clocked out yet */
  time_out: string | null;
  status: AttendanceStatus;
  /** Auto-computed by trigger: total minutes worked ÷ 60, capped at shift length */
  hours_worked: number;
  /** Auto-computed by trigger: minutes beyond shift_end ÷ 60 */
  ot_hours: number;
  /** Auto-computed by trigger: max(0, time_in_minutes − shift_start_minutes − grace) */
  late_minutes: number;
  /** Auto-computed by trigger: late_minutes × penalty_per_minute */
  penalty_amount: number;
  /** Cash advance given to this employee on this day */
  advance_given: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  6b. ATTENDANCE LOG with employee details (API-joined response)
// ─────────────────────────────────────────────────────────────────────────────
export interface AttendanceLogWithEmployee extends AttendanceLog {
  emp_code: string | null;
  name: string;
  avatar: string;
  department: string | null;
  designation: string | null;
  daily_rate: number;
  hourly_rate: number;
  monthly_basic: number;
  /** log_id is the attendance_logs.id — null when no log exists for this date */
  log_id: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  7. ADVANCE_TRANSACTIONS  (alias: Transaction)
// ─────────────────────────────────────────────────────────────────────────────
export interface AdvanceTransaction {
  id: number;
  /** FK → employees.id */
  employee_id: number;
  /** "YYYY-MM-DD" */
  txn_date: string;
  amount: number;
  purpose: string | null;
  is_recovered: boolean;
  /** FK → payroll_runs.id — set when this advance is deducted in a payroll run */
  payroll_run_id: number | null;
  created_at: string;
}

/** Alias for AdvanceTransaction (as requested by Stage 1A spec) */
export type Transaction = AdvanceTransaction;

// ─────────────────────────────────────────────────────────────────────────────
//  8. PAYROLL_RUNS
// ─────────────────────────────────────────────────────────────────────────────
export type PayrollRunStatus = "draft" | "approved" | "locked";

export interface PayrollRun {
  id: number;
  period_year: number;
  /** 1–12 */
  period_month: number;
  status: PayrollRunStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  9. PAYROLL_LINE_ITEMS
// ─────────────────────────────────────────────────────────────────────────────
export interface PayrollLineItem {
  id: number;
  /** FK → payroll_runs.id */
  payroll_run_id: number;
  /** FK → employees.id */
  employee_id: number;
  // ── Snapshot columns ──────────────────────────────────────────────────────
  base_salary: number;
  standard_hours: number;
  hours_logged: number;
  hourly_rate: number;
  paid_leaves: number;
  // ── Earnings ─────────────────────────────────────────────────────────────
  ot_hours: number;
  ot_pay: number;
  bonus: number;
  // ── Deductions ────────────────────────────────────────────────────────────
  short_hours: number;
  short_deduction: number;
  /** Sum of penalty_amount from all attendance_logs for this period */
  late_penalty: number;
  advances_taken: number;
  professional_tax: number;
  /** Manual fine added by the manager */
  fines: number;
  // ── Generated (STORED) columns — read-only ────────────────────────────────
  /** base_salary + ot_pay + bonus */
  gross_earnings: number;
  /** short_deduction + late_penalty + advances_taken + professional_tax + fines */
  total_deductions: number;
  /** gross_earnings − total_deductions */
  net_payable: number;
  // ── Snapshot ──────────────────────────────────────────────────────────────
  leave_balance_snap: number | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  9b. PAYROLL LINE ITEM with employee details (used by PayrollEngine & ReceiptVault)
// ─────────────────────────────────────────────────────────────────────────────
export interface PayrollLineItemWithEmployee extends PayrollLineItem {
  emp_code: string | null;
  name: string;
  avatar: string;
  department: string | null;
  designation: string | null;
  run_status: PayrollRunStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
//  10. PROFILE  (system user — maps to authenticated users / operators)
//  Not a DB table in schema.sql; represents the authenticated session / role.
// ─────────────────────────────────────────────────────────────────────────────
export type UserRole = "admin" | "operator";

export interface Profile {
  /** UUID from Supabase Auth or local session identifier */
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  /** FK → company_settings.id — always 1 in single-tenant mode */
  company_id: 1;
  is_active: boolean;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATABASE  (Supabase helper type — tables section used by createClient<Database>)
// ─────────────────────────────────────────────────────────────────────────────
export interface Database {
  public: {
    Tables: {
      company_settings:     { Row: CompanySettings;     Insert: Partial<CompanySettings>;     Update: Partial<CompanySettings> };
      departments:          { Row: Department;           Insert: Omit<Department, "id" | "created_at">;    Update: Pick<Department, "name"> };
      designations:         { Row: Designation;          Insert: Omit<Designation, "id" | "created_at">;   Update: Pick<Designation, "name"> };
      employees:            { Row: Employee;             Insert: Omit<Employee, "id" | "daily_rate" | "hourly_rate" | "created_at" | "updated_at">;   Update: Partial<Omit<Employee, "id" | "created_at">> };
      holidays:             { Row: Holiday;              Insert: Omit<Holiday, "id" | "created_at">;       Update: Partial<Omit<Holiday, "id" | "created_at">> };
      attendance_logs:      { Row: AttendanceLog;        Insert: Omit<AttendanceLog, "id" | "status" | "hours_worked" | "ot_hours" | "late_minutes" | "penalty_amount" | "created_at" | "updated_at">; Update: Partial<Pick<AttendanceLog, "time_in" | "time_out" | "advance_given" | "notes">> };
      advance_transactions: { Row: AdvanceTransaction;   Insert: Omit<AdvanceTransaction, "id" | "created_at">;  Update: Partial<Pick<AdvanceTransaction, "is_recovered" | "payroll_run_id">> };
      payroll_runs:         { Row: PayrollRun;           Insert: Omit<PayrollRun, "id" | "created_at">;    Update: Partial<Omit<PayrollRun, "id" | "created_at">> };
      payroll_line_items:   { Row: PayrollLineItem;      Insert: Omit<PayrollLineItem, "id" | "gross_earnings" | "total_deductions" | "net_payable" | "created_at">; Update: Partial<Pick<PayrollLineItem, "bonus" | "fines" | "professional_tax">> };
    };
    Views:  Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      attendance_status: AttendanceStatus;
      payroll_run_status: PayrollRunStatus;
      user_role: UserRole;
      unused_leave_action: "carry_forward" | "encash" | "expire";
    };
  };
}
