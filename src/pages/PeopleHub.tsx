import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, UserPlus, Zap, Phone, User, Save } from "lucide-react";
import { toast } from "sonner";
import { api, type ApiEmployee, type ApiDepartment, type ApiDesignation } from "@/lib/api";
import CompanySettings from "@/components/CompanySettings";
import { cn } from "@/lib/utils";

export default function PeopleHub() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Form state
  const [regName, setRegName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regDeptId, setRegDeptId] = useState("");
  const [regDesigId, setRegDesigId] = useState("");
  const [regMonthly, setRegMonthly] = useState("");
  const [regWorkingDays] = useState("26");

  // ── Fetches ─────────────────────────────────────────────────────────────
  const { data: employees = [], isLoading } = useQuery<ApiEmployee[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<ApiEmployee[]>("/employees"),
  });

  const { data: departments = [] } = useQuery<ApiDepartment[]>({
    queryKey: ["departments"],
    queryFn: () => api.get<ApiDepartment[]>("/settings/departments"),
  });

  const { data: designations = [] } = useQuery<ApiDesignation[]>({
    queryKey: ["designations"],
    queryFn: () => api.get<ApiDesignation[]>("/settings/designations"),
  });

  // ── Create employee mutation ─────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<ApiEmployee>("/employees", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee registered successfully");
      resetForm();
      setSheetOpen(false);
    },
    onError: (err: Error) => toast.error("Failed to register", { description: err.message }),
  });

  const resetForm = () => { setRegName(""); setRegPhone(""); setRegDeptId(""); setRegDesigId(""); setRegMonthly(""); };

  const monthlyVal = Number(regMonthly) || 0;
  const workingDaysVal = Number(regWorkingDays) || 26;
  const perDay   = monthlyVal > 0 ? Math.round(monthlyVal / workingDaysVal) : 0;
  const perHour  = perDay > 0 ? Math.round(perDay / 8) : 0;
  const perMin   = perHour > 0 ? Math.round((perHour / 60) * 100) / 100 : 0;

  const saveEmployee = () => {
    if (!regName.trim() || !regDeptId || !regDesigId || monthlyVal <= 0) return;
    createMutation.mutate({
      name: regName.trim(), phone: regPhone || null,
      department_id: Number(regDeptId), designation_id: Number(regDesigId),
      monthly_basic: monthlyVal,
    });
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      (e.department || "").toLowerCase().includes(q) ||
      (e.designation || "").toLowerCase().includes(q)
    );
  }, [employees, search]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">People Hub</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage employees, designations, and company settings.</p>
      </div>

      <Tabs defaultValue="directory">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="directory">Employee Directory</TabsTrigger>
          <TabsTrigger value="settings">Company Settings</TabsTrigger>
        </TabsList>

        {/* Company Settings Tab */}
        <TabsContent value="settings" className="mt-6">
          <CompanySettings departments={departments} designations={designations} />
        </TabsContent>

        {/* Employee Directory Tab */}
        <TabsContent value="directory" className="mt-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
            </div>
            <Button onClick={() => { resetForm(); setSheetOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0" size="sm">
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
              Register New Employee
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Loading employees…</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((emp) => (
                <Card key={emp.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                      {emp.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.designation}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="text-[11px] font-normal">{emp.department}</Badge>
                        <span className="text-[11px] text-muted-foreground">₹{Number(emp.monthly_basic).toLocaleString("en-IN")}/mo</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {emp.emp_code}
                        {emp.joined_on && ` · Joined ${format(parseISO(emp.joined_on), "dd MMM yyyy")}`}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No employees found.</div>
          )}
        </TabsContent>
      </Tabs>

      {/* Register Employee Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-lg">Register New Employee</SheetTitle>
            <SheetDescription>Add a new team member. Auto-calculated rates will power the Daily Log.</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Personal Information</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="e.g. Rahul Mehta" value={regName} onChange={(e) => setRegName(e.target.value)} className="pl-8 h-9 text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone Number</Label>
                  <div className="relative">
                    <Phone className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="e.g. 98765 43210" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} className="pl-8 h-9 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Department</Label>
                    <Select value={regDeptId} onValueChange={setRegDeptId}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Designation</Label>
                    <Select value={regDesigId} onValueChange={setRegDesigId}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {designations.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Salary Configuration</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Monthly Basic Salary</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-sm text-muted-foreground font-medium">₹</span>
                  <Input type="number" placeholder="25000" value={regMonthly} onChange={(e) => setRegMonthly(e.target.value)} className="pl-7 h-9 text-sm" min={0} />
                </div>
              </div>
            </div>

            {/* Auto-Calculation Box */}
            <div className={cn("rounded-xl border-2 p-4 space-y-3", monthlyVal > 0 ? "border-emerald-200 bg-emerald-50" : "border-muted bg-muted/30")}>
              <div className="flex items-center gap-2">
                <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-white", monthlyVal > 0 ? "bg-emerald-600" : "bg-muted-foreground/50")}>
                  <Zap className="h-3.5 w-3.5" />
                </div>
                <p className={cn("text-sm font-semibold", monthlyVal > 0 ? "text-emerald-900" : "text-muted-foreground")}>Automated Rate Breakdown</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <RateBox label="Per Day"    value={`₹${perDay.toLocaleString("en-IN")}`}  active={monthlyVal > 0} />
                <RateBox label="Per Hour"   value={`₹${perHour.toLocaleString("en-IN")}`} active={monthlyVal > 0} />
                <RateBox label="Per Minute" value={`₹${perMin.toFixed(2)}`}               active={monthlyVal > 0} />
              </div>
            </div>

            <Button onClick={saveEmployee} className="w-full" disabled={!regName.trim() || !regDeptId || !regDesigId || monthlyVal <= 0 || createMutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {createMutation.isPending ? "Saving…" : "Save Employee Profile"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RateBox({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2.5 text-center", active ? "bg-white/80 border-emerald-200" : "bg-background border-border")}>
      <p className={cn("text-[11px]", active ? "text-emerald-700" : "text-muted-foreground")}>{label}</p>
      <p className={cn("text-base font-bold tabular-nums", active ? "text-emerald-900" : "text-foreground")}>{active ? value : "—"}</p>
    </div>
  );
}
