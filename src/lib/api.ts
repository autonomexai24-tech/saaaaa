// ─────────────────────────────────────────────────────────────────────
//  src/lib/api.ts  — typed API client (uses Vite proxy → /api → :3001)
// ─────────────────────────────────────────────────────────────────────

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* empty */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string)                  => request<T>(path),
  post:   <T>(path: string, body: unknown)   => request<T>(path, { method: "POST",  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)   => request<T>(path, { method: "PUT",   body: JSON.stringify(body) }),
  delete: <T>(path: string)                  => request<T>(path, { method: "DELETE" }),
};

// ── Typed helpers ──────────────────────────────────────────────────────────

export interface ApiEmployee {
  id: number;
  emp_code: string;
  name: string;
  phone: string | null;
  department: string;
  designation: string;
  department_id: number;
  designation_id: number;
  monthly_basic: number;
  daily_rate: number;
  hourly_rate: number;
  leave_balance: number;
  is_active: boolean;
  joined_on: string | null;
  avatar: string;
}

export interface ApiAttendanceRow {
  employee_id: number;
  emp_code: string;
  name: string;
  avatar: string;
  department: string;
  designation: string;
  daily_rate: number;
  hourly_rate: number;
  monthly_basic: number;
  log_id: number | null;
  time_in: string;
  time_out: string;
  status: string | null;
  hours_worked: number;
  ot_hours: number;
  late_minutes: number;
  penalty_amount: number;
  advance_given: number;
}

export interface ApiCompanySettings {
  company_name: string;
  company_address: string;
  logo_path: string | null;
  shift_start: string;
  shift_end: string;
  working_hours_per_day: number;
  grace_period_minutes: number;
  ot_multiplier: number;
  penalty_per_minute: number;
  annual_paid_leaves: number;
  monthly_leave_accrual: number;
  unused_leave_action: string;
  working_days_per_month: number;
}

export interface ApiPayrollRow {
  id: number;
  payroll_run_id: number;
  employee_id: number;
  emp_code: string;
  name: string;
  avatar: string;
  department: string;
  designation: string;
  base_salary: number;
  standard_hours: number;
  hours_logged: number;
  hourly_rate: number;
  paid_leaves: number;
  ot_hours: number;
  ot_pay: number;
  bonus: number;
  short_hours: number;
  short_deduction: number;
  advances_taken: number;
  professional_tax: number;
  fines: number;
  gross_earnings: number;
  total_deductions: number;
  net_payable: number;
  leave_balance_snap: number;
  run_status: string;
}

export interface ApiPayrollLedger {
  run_id: number;
  year: number;
  month: number;
  status: string;
  employees: ApiPayrollRow[];
}

export interface ApiDepartment  { id: number; name: string }
export interface ApiDesignation { id: number; name: string }
export interface ApiHoliday     { id: number; date: string; name: string }
