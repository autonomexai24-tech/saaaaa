// =============================================================================
//  src/utils/calculations.ts
//  Payroll calculation utilities — client-side helpers that mirror the
//  PostgreSQL trigger & stored-function logic for live UI previews.
//
//  NOTE: These functions are intentionally re-implemented here so the UI
//  can show real-time estimates (e.g. in the Daily Log card) WITHOUT making
//  a round-trip to the server. The authoritative calculations always come from
//  the database triggers and calculate_payroll_for_employee().
// =============================================================================

import type { AttendanceLog, Employee, CompanySettings } from "@/types/database.types";

// ─────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────

/** Convert "HH:MM" or "HH:MM:SS" to total minutes since midnight */
function timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/** Round to 2 decimal places */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────
//  Shift Detail Calculation
// ─────────────────────────────────────────────

export interface ShiftDetails {
  /** Total clock-in → clock-out minutes ÷ 60 */
  hoursWorked: number;
  /** Minutes beyond shift_end ÷ 60 (0 if not exceeded) */
  otHours: number;
  /** Whether the employee arrived after the grace window */
  isLate: boolean;
  /** Minutes late beyond the grace period (0 if on time) */
  lateMinutes: number;
  /** Rupee penalty for lateness: lateMinutes × penalty_per_minute */
  penaltyAmount: number;
  /** Derived status string */
  status: "present" | "late" | "pending";
}

/**
 * Mirrors `trg_attendance_compute` in schema.sql.
 * Call this whenever time_in / time_out change in the UI to show
 * a live preview of hours, OT, and penalties.
 *
 * @param timeIn  "HH:MM" (or empty string → returns zeroed result)
 * @param timeOut "HH:MM" (or empty string → returns zeroed result)
 * @param settings Company-wide shift configuration from company_settings row
 */
export function calculateShiftDetails(
  timeIn: string,
  timeOut: string,
  settings: Pick<
    CompanySettings,
    "shift_start" | "shift_end" | "grace_period_minutes" | "penalty_per_minute"
  >
): ShiftDetails {
  const zero: ShiftDetails = { hoursWorked: 0, otHours: 0, isLate: false, lateMinutes: 0, penaltyAmount: 0, status: "pending" };
  if (!timeIn || !timeOut) return zero;

  const inMin      = timeToMinutes(timeIn);
  const outMin     = timeToMinutes(timeOut);
  const startMin   = timeToMinutes(settings.shift_start);
  const endMin     = timeToMinutes(settings.shift_end);
  const graceMin   = settings.grace_period_minutes;

  if (outMin <= inMin) return zero;  // Not yet clocked out / invalid

  const totalWorked  = outMin - inMin;
  const hoursWorked  = round2(totalWorked / 60);

  const lateMinutes  = Math.max(0, inMin - startMin - graceMin);
  const isLate       = lateMinutes > 0;
  const penaltyAmount= round2(lateMinutes * settings.penalty_per_minute);

  const otMinutes    = Math.max(0, outMin - endMin);
  const otHours      = round2(otMinutes / 60);

  const status: ShiftDetails["status"] = !timeIn ? "pending" : isLate ? "late" : "present";

  return { hoursWorked, otHours, isLate, lateMinutes, penaltyAmount, status };
}

// ─────────────────────────────────────────────
//  Net Pay Calculation  (placeholder for Stage 5)
// ─────────────────────────────────────────────

export interface NetPayInput {
  employee:    Pick<Employee, "monthly_basic" | "daily_rate" | "hourly_rate">;
  attendance:  Pick<AttendanceLog, "hours_worked" | "ot_hours" | "penalty_amount" | "advance_given">[];
  settings:    Pick<CompanySettings, "working_hours_per_day" | "ot_multiplier" | "working_days_per_month">;
  bonus?:      number;
  fines?:      number;
  professionalTax?: number;
  paidLeaves?: number;
}

export interface NetPayResult {
  /** Monthly basic as snapshot at time of calculation */
  baseSalary: number;
  /** Total hours clocked across all attendance entries */
  hoursLogged: number;
  /** Total OT hours */
  otHours: number;
  /** OT pay: otHours × hourly_rate × ot_multiplier */
  otPay: number;
  /** Manual discretionary bonus */
  bonus: number;
  /** Gross = baseSalary + otPay + bonus */
  grossEarnings: number;
  /** Sum of all penalty_amount values */
  latePenalty: number;
  /** Sum of advance_given across all attendance entries */
  advancesTaken: number;
  /** Professional tax (fixed monthly) */
  professionalTax: number;
  /** Manual fines */
  fines: number;
  /** Total deductions */
  totalDeductions: number;
  /** net = grossEarnings − totalDeductions */
  netPayable: number;
}

/**
 * `calculateNetPay` — client-side payroll calculation.
 *
 * @deprecated Use the authoritative PostgreSQL function `calculate_payroll_for_employee`
 * via POST `/api/payroll/calculate` instead. This is only kept for legacy tests.
 */
export function calculateNetPay(input: NetPayInput): NetPayResult {
  const { employee, attendance, settings, bonus = 0, fines = 0, professionalTax = 0, paidLeaves = 0 } = input;

  const hourlyRate  = Number(employee.hourly_rate);
  const baseSalary  = round2(Number(employee.monthly_basic));

  // Aggregate attendance data
  const hoursLogged  = round2(attendance.reduce((acc, a) => acc + Number(a.hours_worked), 0));
  const otHours      = round2(attendance.reduce((acc, a) => acc + Number(a.ot_hours),     0));
  const latePenalty  = round2(attendance.reduce((acc, a) => acc + Number(a.penalty_amount), 0));
  const advancesTaken= round2(attendance.reduce((acc, a) => acc + Number(a.advance_given),  0));

  // Earnings
  const otPay        = round2(otHours * hourlyRate * settings.ot_multiplier);
  const grossEarnings= round2(baseSalary + otPay + bonus);

  // Deductions
  const totalDeductions = round2(latePenalty + advancesTaken + professionalTax + fines);
  const netPayable      = round2(grossEarnings - totalDeductions);

  // Suppress unused 'paidLeaves' warning — it will be used in Stage 5
  void paidLeaves;

  return {
    baseSalary,
    hoursLogged,
    otHours,
    otPay,
    bonus: round2(bonus),
    grossEarnings,
    latePenalty,
    advancesTaken,
    professionalTax: round2(professionalTax),
    fines: round2(fines),
    totalDeductions,
    netPayable,
  };
}

// ─────────────────────────────────────────────
//  Currency Helpers (used across all pages)
// ─────────────────────────────────────────────

/** Format a number as Indian Rupees: ₹1,23,456.00 */
export function formatINR(amount: number): string {
  return (
    "₹" +
    Number(amount ?? 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Convert an amount to Indian words: 32500 → "Rupees Thirty-Two Thousand Five Hundred Only" */
export function amountToWords(n: number): string {
  if (n <= 0) return "Zero";
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function convert(num: number): string {
    if (num < 20)      return ones[num];
    if (num < 100)     return tens[Math.floor(num / 10)] + (num % 10 ? "-" + ones[num % 10] : "");
    if (num < 1000)    return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " and " + convert(num % 100) : "");
    if (num < 100000)  return convert(Math.floor(num / 1000)) + " Thousand" + (num % 1000 ? " " + convert(num % 1000) : "");
    if (num < 10000000) return convert(Math.floor(num / 100000)) + " Lakh" + (num % 100000 ? " " + convert(num % 100000) : "");
    return convert(Math.floor(num / 10000000)) + " Crore" + (num % 10000000 ? " " + convert(num % 10000000) : "");
  }
  return "Rupees " + convert(Math.abs(Math.round(n))) + " Only";
}
