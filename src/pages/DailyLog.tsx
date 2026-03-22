import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, ChevronDown, Clock, Users, UserCheck, UserX, BarChart3, Save, Download } from "lucide-react";
import { toast } from "sonner";
import { api, type ApiAttendanceRow } from "@/lib/api";
import { cn } from "@/lib/utils";

type FilterStatus = "all" | "present" | "late" | "pending";

const TODAY = new Date().toISOString().split("T")[0];

export default function DailyLog() {
  const queryClient = useQueryClient();
  const [openCards, setOpenCards] = useState<Record<number, boolean>>({});
  const [localEdits, setLocalEdits] = useState<Record<number, { timeIn: string; timeOut: string; advance: number }>>({});
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMonth, setReportMonth] = useState("3");
  const [reportYear, setReportYear] = useState("2026");

  // ── Fetch attendance for today ──────────────────────────────────────────
  const { data: rows = [], isLoading } = useQuery<ApiAttendanceRow[]>({
    queryKey: ["attendance", TODAY],
    queryFn: () => api.get<ApiAttendanceRow[]>(`/attendance?date=${TODAY}`),
  });

  // ── Monthly summary (for the report dialog) ─────────────────────────────
  const { data: monthlySummary = [] } = useQuery<any[]>({
    queryKey: ["attendance-monthly", reportYear, reportMonth],
    queryFn: () => api.get<any[]>(`/attendance/monthly-summary?year=${reportYear}&month=${reportMonth}`),
    enabled: reportOpen,
  });

  // ── Save attendance mutation ─────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (payload: { employee_id: number; date: string; time_in: string; time_out: string; advance_given: number }) =>
      api.post("/attendance", payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", TODAY] });
      const row = rows.find((r) => r.employee_id === variables.employee_id);
      toast.success("Attendance Saved", {
        description: `${row?.name ?? "Employee"} — ${variables.time_in} to ${variables.time_out}`,
      });
      setOpenCards((prev) => ({ ...prev, [variables.employee_id]: false }));
    },
    onError: (err: Error) => toast.error("Failed to save", { description: err.message }),
  });

  const getEdit = (empId: number, row: ApiAttendanceRow) =>
    localEdits[empId] ?? { timeIn: row.time_in, timeOut: row.time_out, advance: row.advance_given };

  const updateEdit = (empId: number, field: "timeIn" | "timeOut" | "advance", value: string | number) =>
    setLocalEdits((prev) => ({ ...prev, [empId]: { ...getEdit(empId, rows.find((r) => r.employee_id === empId)!), [field]: value } }));

  const quickFill = (empId: number) =>
    setLocalEdits((prev) => ({ ...prev, [empId]: { ...getEdit(empId, rows.find((r) => r.employee_id === empId)!), timeIn: "09:00", timeOut: "18:00" } }));

  const saveAttendance = useCallback((row: ApiAttendanceRow) => {
    const ed = getEdit(row.employee_id, row);
    if (!ed.timeIn || !ed.timeOut) return;
    saveMutation.mutate({ employee_id: row.employee_id, date: TODAY, time_in: ed.timeIn, time_out: ed.timeOut, advance_given: ed.advance });
  }, [localEdits, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status derivation ────────────────────────────────────────────────────
  function getStatus(row: ApiAttendanceRow): "present" | "late" | "pending" {
    const ti = localEdits[row.employee_id]?.timeIn ?? row.time_in;
    if (!ti) return "pending";
    const [h, m] = ti.split(":").map(Number);
    const inMin = h * 60 + m;
    if (inMin > 9 * 60 + 10) return "late";
    return "present";
  }

  const counts = useMemo(() => {
    let present = 0, late = 0, pending = 0;
    rows.forEach((r) => {
      const s = getStatus(r);
      if (s === "present") present++;
      else if (s === "late") late++;
      else pending++;
    });
    return { present, late, pending, all: rows.length };
  }, [rows, localEdits]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() =>
    filter === "all" ? rows : rows.filter((r) => getStatus(r) === filter),
    [rows, filter, localEdits] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Daily Attendance Log</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {today}
          </p>
        </div>
        <Button variant="outline" className="h-9 text-sm gap-2" onClick={() => setReportOpen(true)}>
          <BarChart3 className="h-3.5 w-3.5" />
          View Monthly Attendance Report
        </Button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Workforce" value={String(counts.all)} icon={<Users className="h-3.5 w-3.5" />} color="slate" />
        <StatCard label="Present Today" value={String(counts.present + counts.late)} icon={<UserCheck className="h-3.5 w-3.5" />} color="emerald" />
        <StatCard label="Late Arrivals" value={String(counts.late)} icon={<Clock className="h-3.5 w-3.5" />} color="amber" />
        <StatCard label="Absent / Leave" value={String(counts.pending)} icon={<UserX className="h-3.5 w-3.5" />} color="rose" />
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")} count={counts.all} label="All Employees" />
        <FilterPill active={filter === "present"} onClick={() => setFilter("present")} count={counts.present} label="Present" variant="emerald" />
        <FilterPill active={filter === "late"} onClick={() => setFilter("late")} count={counts.late} label="Late" variant="amber" />
        <FilterPill active={filter === "pending"} onClick={() => setFilter("pending")} count={counts.pending} label="Absent / Pending" variant="rose" />
      </div>

      {/* Employee Cards */}
      {isLoading ? (
        <div className="text-center py-10 text-sm text-muted-foreground">Loading employees…</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => {
            const ed = getEdit(row.employee_id, row);
            const status = getStatus(row);
            const isOpen = openCards[row.employee_id] ?? false;
            const worked = (() => {
              if (!ed.timeIn || !ed.timeOut) return null;
              const [ih, im] = ed.timeIn.split(":").map(Number);
              const [oh, om] = ed.timeOut.split(":").map(Number);
              const mins = (oh * 60 + om) - (ih * 60 + im);
              const h = Math.floor(mins / 60), m = mins % 60;
              const otMins = Math.max(0, (oh * 60 + om) - 18 * 60);
              return { display: `${h}h ${m}m`, ot: otMins > 0 ? `+${Math.floor(otMins / 60)}h ${otMins % 60}m OT` : "" };
            })();

            return (
              <Collapsible key={row.employee_id} open={isOpen} onOpenChange={(op) => setOpenCards((prev) => ({ ...prev, [row.employee_id]: op }))}>
                <Card className="overflow-hidden transition-shadow hover:shadow-md">
                  <CollapsibleTrigger asChild>
                    <button className="w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                        {row.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{row.name}</p>
                        <p className="text-[11px] text-muted-foreground">{row.designation}</p>
                      </div>
                      <Badge variant="secondary" className="hidden sm:inline-flex text-[11px] font-normal">{row.department}</Badge>
                      <StatusBadge status={status} />
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} />
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="border-t px-4 py-3 space-y-3">
                      <div className="flex items-end gap-3">
                        <div className="flex-1 space-y-1">
                          <label className="text-[11px] text-muted-foreground font-medium">Time In</label>
                          <div className="relative">
                            <Clock className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input type="time" value={ed.timeIn} onChange={(e) => updateEdit(row.employee_id, "timeIn", e.target.value)} className="pl-8 text-sm h-8" />
                          </div>
                        </div>
                        <div className="flex-1 space-y-1">
                          <label className="text-[11px] text-muted-foreground font-medium">Time Out</label>
                          <div className="relative">
                            <Clock className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input type="time" value={ed.timeOut} onChange={(e) => updateEdit(row.employee_id, "timeOut", e.target.value)} className="pl-8 text-sm h-8" />
                          </div>
                        </div>
                        <Button variant="outline" size="sm" className="h-8 text-[11px] px-3 shrink-0" onClick={(e) => { e.stopPropagation(); quickFill(row.employee_id); }}>
                          <Clock className="h-3 w-3 mr-1" />
                          9–6
                        </Button>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div className="text-xs text-muted-foreground">
                          {worked ? (
                            <span>Total Shift: <span className="font-medium text-foreground">{worked.display}</span>{worked.ot && <span className="text-emerald-600 font-medium"> ({worked.ot})</span>}</span>
                          ) : (
                            <span className="italic">Enter times to see shift duration</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-3" onClick={() => setOpenCards((prev) => ({ ...prev, [row.employee_id]: false }))}>
                            Cancel
                          </Button>
                          <Button size="sm" className="h-7 text-xs px-4" disabled={!ed.timeIn || !ed.timeOut || saveMutation.isPending} onClick={() => saveAttendance(row)}>
                            <Save className="h-3 w-3 mr-1" />
                            Save Attendance
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}

          {filtered.length === 0 && !isLoading && (
            <div className="text-center py-10 text-sm text-muted-foreground">No employees match this filter.</div>
          )}
        </div>
      )}

      {/* Monthly Attendance Report Dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg">Monthly Attendance Summary</DialogTitle>
              <Select value={reportMonth} onValueChange={setReportMonth}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{m} {reportYear}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogDescription>Overview of employee presence, absences, and late arrivals.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="min-w-[180px]">Employee</TableHead>
                  <TableHead className="text-center">Working Days</TableHead>
                  <TableHead className="text-center">Present</TableHead>
                  <TableHead className="text-center">Absent</TableHead>
                  <TableHead className="text-center">Late</TableHead>
                  <TableHead className="text-right">Total Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlySummary.map((r: any) => (
                  <TableRow key={r.employee_id}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-foreground">{r.employee_name}</p>
                        <p className="text-[11px] text-muted-foreground">{r.department}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm tabular-nums">{r.working_days}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={cn("tabular-nums text-xs font-medium border-0", Number(r.present_days) >= r.working_days ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-50")}>{r.present_days}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={cn("tabular-nums text-xs font-medium border-0", Number(r.absent_days) > 0 ? "bg-rose-100 text-rose-800 hover:bg-rose-100" : "bg-muted text-muted-foreground hover:bg-muted")}>{r.absent_days}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={cn("tabular-nums text-xs font-medium border-0", Number(r.late_days) > 0 ? "bg-amber-100 text-amber-800 hover:bg-amber-100" : "bg-muted text-muted-foreground hover:bg-muted")}>{r.late_days}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{Number(r.total_hours).toFixed(1)}h</TableCell>
                  </TableRow>
                ))}
                {monthlySummary.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data for this month.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <DialogFooter className="px-6 py-4 border-t flex items-center justify-between sm:justify-between">
            <Button variant="ghost" size="sm" className="text-xs gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Export as CSV
            </Button>
            <Button size="sm" className="text-xs px-4" onClick={() => setReportOpen(false)}>
              Close Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: "emerald" | "rose" | "amber" | "slate" }) {
  const styles = { emerald: "bg-emerald-50 text-emerald-600 border-emerald-100", rose: "bg-rose-50 text-rose-600 border-rose-100", amber: "bg-amber-50 text-amber-600 border-amber-100", slate: "bg-muted text-muted-foreground border-border" };
  return (
    <Card className="border">
      <CardContent className="p-3 flex items-center gap-2.5">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg border", styles[color])}>{icon}</div>
        <div>
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className="text-base font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterPill({ active, onClick, count, label, variant }: { active: boolean; onClick: () => void; count: number; label: string; variant?: "emerald" | "amber" | "rose" }) {
  const textColor = !variant ? "" : variant === "emerald" ? "text-emerald-700" : variant === "amber" ? "text-amber-700" : "text-rose-700";
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors", active ? "bg-primary text-primary-foreground shadow-sm" : cn("bg-muted/60 text-muted-foreground hover:bg-muted", !active && variant && textColor))}>
      {label}
      <span className={cn("tabular-nums rounded-full px-1.5 py-0.5 text-[10px] font-semibold", active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-foreground")}>{count}</span>
    </button>
  );
}

function StatusBadge({ status }: { status: "present" | "late" | "pending" }) {
  if (status === "present") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-0 text-[11px] font-medium">Present</Badge>;
  if (status === "late")    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-0 text-[11px] font-medium">Late</Badge>;
  return <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 border-0 text-[11px] font-medium">Absent</Badge>;
}
