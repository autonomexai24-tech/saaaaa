import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CalendarIcon, CheckCircle2, Clock, IndianRupee,
  TrendingDown, TrendingUp, Minus, Plus, Equal,
  FileCheck, AlertTriangle, Timer, Lock, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, type ApiPayrollLedger, type ApiPayrollRow } from "@/lib/api";

export default function PayrollEngine() {
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date(2026, 2, 1));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reviewRow, setReviewRow] = useState<ApiPayrollRow | null>(null);
  const [bonus, setBonus] = useState("");
  const [fines, setFines] = useState("");
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);

  const year  = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth() + 1;

  // ── Fetch ledger ─────────────────────────────────────────────────────────
  const { data: ledger, isLoading } = useQuery<ApiPayrollLedger>({
    queryKey: ["payroll-ledger", year, month],
    queryFn: () => api.get<ApiPayrollLedger>(`/payroll/ledger?year=${year}&month=${month}`),
  });

  const employees = ledger?.employees ?? [];
  const runId = ledger?.run_id;

  // ── Approve mutation ─────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: () => api.post("/payroll/approve", { run_id: runId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-ledger", year, month] });
      toast.success("Payslips Generated!", { description: "Payroll run locked and approved. Visit Receipt Vault to download PDFs." });
    },
    onError: (err: Error) => toast.error("Approval failed", { description: err.message }),
  });

  // ── Recalculate one employee override ────────────────────────────────────
  const calcMutation = useMutation({
    mutationFn: (override: { employee_id: number; bonus: number; fines: number }) =>
      api.post("/payroll/calculate", { run_id: runId, ...override, professional_tax: 200 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-ledger", year, month] });
      setReviewRow(null);
      toast.success("Payroll recalculated");
    },
    onError: (err: Error) => toast.error("Calculation failed", { description: err.message }),
  });

  const openReview = (row: ApiPayrollRow) => { setReviewRow(row); setBonus(""); setFines(""); };

  // ── Pulse totals ─────────────────────────────────────────────────────────
  const pulse = useMemo(() => {
    let totalBase = 0, totalOT = 0, totalDed = 0, totalNet = 0;
    employees.forEach((r) => {
      totalBase += Number(r.base_salary);
      totalOT   += Number(r.ot_pay);
      totalDed  += Number(r.total_deductions);
      totalNet  += Number(r.net_payable);
    });
    return { totalBase, totalOT, totalDed, totalNet };
  }, [employees]);

  const inr = (n: number) => Number(n || 0).toLocaleString("en-IN");
  const isLocked = ledger?.status === "locked" || ledger?.status === "approved";
  const isDraft  = !isLocked;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Payroll Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">Hourly-driven Master Ledger — auto-calculated from total hours logged.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live / Locked Status Badge */}
          {ledger && !isLoading && (
            isDraft ? (
              <Badge variant="outline" className="h-8 px-3 text-xs gap-1.5 border-amber-300 bg-amber-50 text-amber-700">
                <Zap className="h-3 w-3" />
                Live Draft
              </Badge>
            ) : (
              <Badge className="h-8 px-3 text-xs gap-1.5 bg-emerald-600 text-white">
                <Lock className="h-3 w-3" />
                🔒 PAYROLL LOCKED
              </Badge>
            )
          )}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 text-sm gap-2 min-w-[160px] justify-start">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(selectedMonth, "MMMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={selectedMonth} onSelect={(d) => { if (d) { setSelectedMonth(d); setCalendarOpen(false); } }} className={cn("p-3 pointer-events-auto")} initialFocus />
            </PopoverContent>
          </Popover>
          {isDraft && (
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 text-sm gap-2" onClick={() => setLockConfirmOpen(true)} disabled={approveMutation.isPending || !runId || employees.length === 0}>
              <FileCheck className="h-3.5 w-3.5" />
              {approveMutation.isPending ? "Processing…" : "Lock & Finalize Payroll"}
            </Button>
          )}
        </div>
      </div>

      {/* Lock Confirmation AlertDialog */}
      <AlertDialog open={lockConfirmOpen} onOpenChange={setLockConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              Once locked, attendance and advances for this month cannot be edited. This action is permanent. All payslips will be generated and the payroll run will be marked as approved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                approveMutation.mutate();
                setLockConfirmOpen(false);
              }}
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" />
              Yes, Lock & Finalize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pulse Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <PulseCard icon={<IndianRupee className="h-4 w-4" />} label="Total Base Payroll"  value={`₹${inr(pulse.totalBase)}`} color="primary" />
        <PulseCard icon={<TrendingUp   className="h-4 w-4" />} label="Overtime Earnings"  value={`+₹${inr(pulse.totalOT)}`}  color="success" />
        <PulseCard icon={<TrendingDown className="h-4 w-4" />} label="Total Deductions"   value={`-₹${inr(pulse.totalDed)}`} color="destructive" />
        <PulseCard icon={<CheckCircle2 className="h-4 w-4" />} label="Final Net Payable"  value={`₹${inr(pulse.totalNet)}`}  color="success" />
      </div>

      {/* Ledger Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Calculating payroll from attendance data…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="min-w-[180px]">Employee</TableHead>
                  <TableHead className="text-right">Base Salary</TableHead>
                  <TableHead className="text-right">Hours Logged</TableHead>
                  <TableHead className="text-right">Gross Earned</TableHead>
                  <TableHead className="text-right">Total Deductions</TableHead>
                  <TableHead className="text-right font-semibold">Net Payable</TableHead>
                  <TableHead className="text-center w-[100px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((row) => {
                  const hoursOver = Number(row.hours_logged) >= Number(row.standard_hours);
                  return (
                    <TableRow key={row.employee_id} className="group hover:bg-muted/30 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">{row.avatar}</div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{row.name}</p>
                            <p className="text-xs text-muted-foreground">{row.designation}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">₹{inr(Number(row.base_salary))}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={cn("text-sm font-medium tabular-nums", hoursOver ? "text-emerald-600" : "text-destructive")}>{row.hours_logged}h / {row.standard_hours}h</span>
                          {Number(row.ot_hours) > 0  && <span className="text-xs text-emerald-600 tabular-nums">+{row.ot_hours}h OT</span>}
                          {Number(row.short_hours) > 0 && <span className="text-xs text-destructive tabular-nums">-{row.short_hours}h short</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-sm tabular-nums">₹{inr(Number(row.gross_earnings))}</span>
                          {Number(row.ot_pay) > 0 && <span className="text-xs text-emerald-600 tabular-nums">+₹{inr(Number(row.ot_pay))} OT</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(row.total_deductions) > 0 ? (
                          <span className="text-sm text-destructive tabular-nums font-medium">-₹{inr(Number(row.total_deductions))}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">₹0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm font-bold text-emerald-600 tabular-nums">₹{inr(Number(row.net_payable))}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="sm" className="h-8 text-xs text-primary hover:text-primary hover:bg-primary/10" onClick={() => openReview(row)} disabled={isLocked}>
                          {isLocked ? "Locked" : "Review"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {employees.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No payroll data. Mark attendance first.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      {/* Review Sheet */}
      <Sheet open={!!reviewRow} onOpenChange={(open) => { if (!open) setReviewRow(null); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {reviewRow && (
            <ReviewPanel
              row={reviewRow} month={selectedMonth}
              bonus={bonus} fines={fines}
              setBonus={setBonus} setFines={setFines}
              onSave={() => calcMutation.mutate({ employee_id: reviewRow.employee_id, bonus: Number(bonus) || 0, fines: Number(fines) || 0 })}
              isSaving={calcMutation.isPending}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ReviewPanel({ row, month, bonus, fines, setBonus, setFines, onSave, isSaving }: {
  row: ApiPayrollRow; month: Date; bonus: string; fines: string;
  setBonus: (v: string) => void; setFines: (v: string) => void;
  onSave: () => void; isSaving: boolean;
}) {
  const bonusVal = Number(bonus) || 0;
  const finesVal = Number(fines) || 0;
  const inr = (n: number) => Number(n || 0).toLocaleString("en-IN");

  // Preview net with overrides
  const previewNet = Number(row.gross_earnings) + bonusVal - Number(row.total_deductions) - finesVal;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-lg">Review Payroll — {row.name}</SheetTitle>
        <SheetDescription>{format(month, "MMMM yyyy")} · {row.designation}, {row.department}</SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-5">
        {/* Time Audit */}
        <div className="rounded-xl bg-muted/60 border p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Time Audit</p>
          </div>
          <AuditLine label="Expected Monthly Hours" value={`${row.standard_hours}h`} sub={`26 Days × 8h`} />
          <AuditLine label="Actual Hours Logged" value={`${row.hours_logged}h`} highlight={Number(row.hours_logged) >= Number(row.standard_hours) ? "success" : "destructive"} />
          {Number(row.ot_hours) > 0    && <AuditLine label="Auto-Calculated OT" value={`+${row.ot_hours}h`} highlight="success" />}
          {Number(row.short_hours) > 0 && <AuditLine label="Hours Short" value={`-${row.short_hours}h`} highlight="destructive" />}
          <AuditLine label="Paid Leaves Applied" value={`${row.paid_leaves}`} />
        </div>

        {/* Financial Breakdown */}
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Financial Breakdown</p>
          <div className="space-y-2">
            <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Earnings</p>
            <BreakdownLine label={`Base Salary (for ${row.standard_hours}h)`} value={`₹${inr(Number(row.base_salary))}`} />
            {Number(row.ot_pay) > 0  && <BreakdownLine label={`Overtime Pay (${row.ot_hours}h)`} value={`+₹${inr(Number(row.ot_pay))}`} variant="success" />}
            {bonusVal > 0            && <BreakdownLine label="Bonus" value={`+₹${inr(bonusVal)}`} variant="success" />}
          </div>
          <Separator />
          <div className="space-y-2">
            <p className="text-xs font-medium text-destructive uppercase tracking-wide">Deductions</p>
            <BreakdownLine label={`Short Hours (${row.short_hours}h)`} value={Number(row.short_deduction) > 0 ? `-₹${inr(Number(row.short_deduction))}` : "₹0"} variant={Number(row.short_deduction) > 0 ? "destructive" : undefined} />
            <BreakdownLine label="Advance Recovery" value={Number(row.advances_taken) > 0 ? `-₹${inr(Number(row.advances_taken))}` : "₹0"} variant={Number(row.advances_taken) > 0 ? "warning" : undefined} />
            <BreakdownLine label="Professional Tax" value={Number(row.professional_tax) > 0 ? `-₹${inr(Number(row.professional_tax))}` : "₹0"} />
            {finesVal > 0 && <BreakdownLine label="Other Fines" value={`-₹${inr(finesVal)}`} variant="destructive" />}
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-semibold text-foreground">Net Payable</span>
            <span className="text-xl font-bold text-emerald-600 tabular-nums">₹{inr(previewNet)}</span>
          </div>
        </div>

        {/* Formula */}
        <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">Calculation Formula</p>
          <div className="flex items-center gap-1.5 flex-wrap text-sm">
            <Badge variant="secondary" className="tabular-nums text-xs">Base: ₹{inr(Number(row.base_salary))}</Badge>
            {Number(row.ot_pay) > 0 && <><Plus className="h-3 w-3 text-muted-foreground" /><Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 tabular-nums text-xs">OT: ₹{inr(Number(row.ot_pay))}</Badge></>}
            {bonusVal > 0           && <><Plus className="h-3 w-3 text-muted-foreground" /><Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 tabular-nums text-xs">Bonus: ₹{inr(bonusVal)}</Badge></>}
            <Minus className="h-3 w-3 text-muted-foreground" />
            <Badge variant="destructive" className="tabular-nums text-xs">Ded: ₹{inr(Number(row.total_deductions) + finesVal)}</Badge>
            <Equal className="h-3 w-3 text-muted-foreground" />
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 tabular-nums text-xs">₹{inr(previewNet)}</Badge>
          </div>
        </div>

        <Separator />

        {/* Manual Overrides */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Manual Overrides</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Add Bonus (₹)</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-2 text-sm text-muted-foreground font-medium">₹</span>
                <Input type="number" placeholder="0" value={bonus} onChange={(e) => setBonus(e.target.value)} className="pl-7 h-9 text-sm" min={0} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Other Fines (₹)</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-2 text-sm text-muted-foreground font-medium">₹</span>
                <Input type="number" placeholder="0" value={fines} onChange={(e) => setFines(e.target.value)} className="pl-7 h-9 text-sm" min={0} />
              </div>
            </div>
          </div>
        </div>

        <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onSave} disabled={isSaving}>
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
          {isSaving ? "Saving…" : "Lock & Approve Salary"}
        </Button>
      </div>
    </>
  );
}

// Sub-components
function PulseCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: "primary" | "destructive" | "warning" | "success" }) {
  const styles = { primary: "bg-primary/10 text-primary", destructive: "bg-destructive/10 text-destructive", warning: "bg-amber-100 text-amber-700", success: "bg-emerald-100 text-emerald-700" };
  const valueStyles = { primary: "text-foreground", destructive: "text-destructive", warning: "text-amber-700", success: "text-emerald-700" };
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", styles[color])}>{icon}</div>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <p className={cn("text-xl font-bold tabular-nums", valueStyles[color])}>{value}</p>
      </CardContent>
    </Card>
  );
}

function AuditLine({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "success" | "destructive" }) {
  const color = highlight === "success" ? "text-emerald-600 font-medium" : highlight === "destructive" ? "text-destructive font-medium" : "text-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {sub && <span className="text-xs text-muted-foreground">({sub})</span>}
        <span className={cn("text-sm tabular-nums", color)}>{value}</span>
      </div>
    </div>
  );
}

function BreakdownLine({ label, value, variant }: { label: string; value: string; variant?: "destructive" | "warning" | "success" }) {
  const valueColor = variant === "destructive" ? "text-destructive" : variant === "warning" ? "text-amber-600" : variant === "success" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium tabular-nums", valueColor)}>{value}</span>
    </div>
  );
}

// Clock and Timer re-exports (already imported at top)
export { Clock, Timer };
