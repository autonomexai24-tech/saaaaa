import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, X, Clock, Save, CalendarDays, Palmtree, Building2, ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, type ApiCompanySettings, type ApiDepartment, type ApiDesignation, type ApiHoliday } from "@/lib/api";

interface Props {
  departments:      ApiDepartment[];
  designations:     ApiDesignation[];
}

export default function CompanySettings({ departments, designations }: Props) {
  const queryClient = useQueryClient();

  // ── Load company settings ─────────────────────────────────────────────────
  const { data: settings } = useQuery<ApiCompanySettings>({
    queryKey: ["company-settings"],
    queryFn: () => api.get<ApiCompanySettings>("/settings"),
  });

  // ── Local form state (synced from settings) ──────────────────────────────
  const [shiftStart,    setShiftStart]    = useState("09:00");
  const [shiftEnd,      setShiftEnd]      = useState("18:00");
  const [workingHours,  setWorkingHours]  = useState("8");
  const [gracePeriod,   setGracePeriod]   = useState("10");
  const [annualLeaves,  setAnnualLeaves]  = useState("12");
  const [monthlyAccrual,setMonthlyAccrual]= useState("1");
  const [unusedLeave,   setUnusedLeave]   = useState("carry_forward");
  const [companyName,   setCompanyName]   = useState("PrintWorks Pvt. Ltd.");
  const [companyAddr,   setCompanyAddr]   = useState("42 Industrial Area, Sector 7\nNew Delhi — 110020");
  const [logoPreview,   setLogoPreview]   = useState<string | null>(null);

  // Sync from server
  useEffect(() => {
    if (!settings) return;
    setShiftStart(settings.shift_start || "09:00");
    setShiftEnd(settings.shift_end || "18:00");
    setWorkingHours(String(settings.working_hours_per_day || 8));
    setGracePeriod(String(settings.grace_period_minutes || 10));
    setAnnualLeaves(String(settings.annual_paid_leaves || 12));
    setMonthlyAccrual(String(settings.monthly_leave_accrual || 1));
    setUnusedLeave(settings.unused_leave_action || "carry_forward");
    setCompanyName(settings.company_name || "");
    setCompanyAddr(settings.company_address || "");
    if (settings.logo_path) setLogoPreview(settings.logo_path);
  }, [settings]);

  // ── Save settings mutation ───────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: Partial<ApiCompanySettings>) => api.put("/settings", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      toast.success("Settings saved");
    },
    onError: (err: Error) => toast.error("Save failed", { description: err.message }),
  });

  const saveTimings = () => {
    const hours = Number(workingHours);
    const grace = Number(gracePeriod);
    
    if (isNaN(hours) || hours <= 0 || hours > 24) {
      toast.error("Validation Error", { description: "Working hours must be between 1 and 24." });
      return;
    }
    if (isNaN(grace) || grace < 0 || grace > 120) {
      toast.error("Validation Error", { description: "Grace period must be between 0 and 120 minutes." });
      return;
    }
    
    saveMutation.mutate({ shift_start: shiftStart, shift_end: shiftEnd, working_hours_per_day: hours, grace_period_minutes: grace });
  };
  
  const saveLeaves  = () => {
    const annual = Number(annualLeaves);
    const accrual = Number(monthlyAccrual);
    
    if (isNaN(annual) || annual < 0 || annual > 365) {
      toast.error("Validation Error", { description: "Annual leaves must be between 0 and 365." });
      return;
    }
    if (isNaN(accrual) || accrual < 0 || accrual > 31) {
      toast.error("Validation Error", { description: "Monthly accrual must be between 0 and 31." });
      return;
    }
    
    saveMutation.mutate({ annual_paid_leaves: annual, monthly_leave_accrual: accrual, unused_leave_action: unusedLeave });
  };
  const saveBranding= () => saveMutation.mutate({ company_name: companyName, company_address: companyAddr });

  // ── Logo upload ──────────────────────────────────────────────────────────
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
    const form = new FormData();
    form.append("logo", file);
    try {
      const res = await fetch("/api/settings/logo", { method: "POST", body: form });
      const data = await res.json();
      if (data.logo_path) setLogoPreview(data.logo_path);
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      toast.success("Logo uploaded successfully");
    } catch (err: any) {
      toast.error("Logo upload failed", { description: err.message });
    }
  };

  // ── Holidays ─────────────────────────────────────────────────────────────
  const { data: holidays = [] } = useQuery<ApiHoliday[]>({
    queryKey: ["holidays"],
    queryFn: () => api.get<ApiHoliday[]>("/settings/holidays"),
  });
  const [holidayDate, setHolidayDate] = useState<Date>();
  const [holidayName, setHolidayName] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const addHolidayMutation = useMutation({
    mutationFn: (body: { date: string; name: string }) => api.post("/settings/holidays", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["holidays"] }); setHolidayDate(undefined); setHolidayName(""); },
    onError: (err: Error) => toast.error("Failed to add holiday", { description: err.message }),
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/settings/holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
  });

  const addHoliday = () => {
    if (!holidayDate || !holidayName.trim()) return;
    addHolidayMutation.mutate({ date: format(holidayDate, "yyyy-MM-dd"), name: holidayName.trim() });
  };

  // ── Department & Designation management ──────────────────────────────────
  const [newDept, setNewDept] = useState("");
  const [newDesig, setNewDesig] = useState("");

  const addDeptMutation = useMutation({
    mutationFn: (name: string) => api.post("/settings/departments", { name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["departments"] }); setNewDept(""); },
    onError: (err: Error) => toast.error("Failed", { description: err.message }),
  });

  const delDeptMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/settings/departments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["departments"] }),
  });

  const addDesigMutation = useMutation({
    mutationFn: (name: string) => api.post("/settings/designations", { name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["designations"] }); setNewDesig(""); },
    onError: (err: Error) => toast.error("Failed", { description: err.message }),
  });

  const delDesigMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/settings/designations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["designations"] }),
  });

  const graceEnd = (() => {
    const [h, m] = shiftStart.split(":").map(Number);
    const total = h * 60 + m + (Number(gracePeriod) || 0);
    const nh = Math.floor(total / 60), nm = total % 60;
    const suffix = nh >= 12 ? "PM" : "AM";
    const dh = nh > 12 ? nh - 12 : nh === 0 ? 12 : nh;
    return `${String(dh).padStart(2, "0")}:${String(nm).padStart(2, "0")} ${suffix}`;
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ========== LEFT COLUMN ========== */}
      <div className="space-y-6">
        {/* Shift & Timing */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-primary" />Global Shift & Timing Rules</CardTitle>
            <CardDescription>Set the default timings used across all payroll calculations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Default Shift Start</Label>
                <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default Shift End</Label>
                <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Working Hours / Day</Label>
                <Input type="number" value={workingHours} onChange={(e) => setWorkingHours(e.target.value)} className="h-9 text-sm" min={1} max={24} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Late Grace Period (min)</Label>
                <Input type="number" value={gracePeriod} onChange={(e) => setGracePeriod(e.target.value)} className="h-9 text-sm" min={0} />
                <p className="text-[11px] text-muted-foreground">No penalty before {graceEnd}</p>
              </div>
            </div>
            <Button className="w-full mt-2" size="sm" onClick={saveTimings} disabled={saveMutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Master Timings
            </Button>
          </CardContent>
        </Card>

        {/* Leave Policy */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Palmtree className="h-4 w-4 text-primary" />Global Leave Policy</CardTitle>
            <CardDescription>Set default paid time off (PTO) rules for all employees.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Annual Paid Leaves (Total)</Label>
                <Input type="number" value={annualLeaves} onChange={(e) => setAnnualLeaves(e.target.value)} className="h-9 text-sm" min={0} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Monthly Accrual Limit</Label>
                <Input type="number" value={monthlyAccrual} onChange={(e) => setMonthlyAccrual(e.target.value)} className="h-9 text-sm" min={0} />
                <p className="text-[11px] text-muted-foreground">Leaves earned per month</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unused Leave Action</Label>
              <Select value={unusedLeave} onValueChange={setUnusedLeave}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="encash">Encash at year-end</SelectItem>
                  <SelectItem value="carry_forward">Carry forward</SelectItem>
                  <SelectItem value="expire">Expire</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full mt-2" size="sm" onClick={saveLeaves} disabled={saveMutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Leave Rules
            </Button>
          </CardContent>
        </Card>

        {/* Branding */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />Company Branding & Details</CardTitle>
            <CardDescription>Details appear on official payslips and reports.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Registered Company Name</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Registered Address</Label>
              <Textarea value={companyAddr} onChange={(e) => setCompanyAddr(e.target.value)} className="text-sm min-h-[72px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Company Logo</Label>
              <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 p-6 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors">
                {logoPreview ? (
                  <img src={logoPreview} alt="Company logo" className="max-h-16 max-w-[200px] object-contain" />
                ) : (
                  <>
                    <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-xs font-medium text-muted-foreground">Click or Drag to Add Company Logo</p>
                    <p className="text-[10px] text-muted-foreground/70">Recommended: 250×100px (PNG / JPG)</p>
                  </>
                )}
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoUpload} />
              </label>
            </div>
            <Button className="w-full mt-2" size="sm" onClick={saveBranding} disabled={saveMutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Branding
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ========== RIGHT COLUMN ========== */}
      <div className="space-y-6">
        {/* Holiday Calendar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />Company Holiday Calendar</CardTitle>
            <CardDescription>Mark festival/public holidays to prevent absent penalties.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("h-9 w-[130px] justify-start text-left text-sm font-normal shrink-0", !holidayDate && "text-muted-foreground")}>
                    <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                    {holidayDate ? format(holidayDate, "dd MMM") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={holidayDate} onSelect={(d) => { setHolidayDate(d); setDatePickerOpen(false); }} className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
              <Input placeholder="Holiday name..." value={holidayName} onChange={(e) => setHolidayName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addHoliday()} className="h-9 text-sm" />
              <Button size="sm" variant="outline" onClick={addHoliday} className="shrink-0" disabled={!holidayDate || !holidayName.trim() || addHolidayMutation.isPending}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {[...holidays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((h) => (
                <Badge key={h.id} variant="secondary" className="pl-2 pr-1 py-1 text-xs gap-1.5">
                  <span className="text-muted-foreground">🗓️ {format(new Date(h.date), "dd MMM")}</span>
                  <span className="font-medium">–</span>
                  <span>{h.name}</span>
                  <button onClick={() => deleteHolidayMutation.mutate(h.id)} className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 transition-colors">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
              {holidays.length === 0 && <p className="text-xs text-muted-foreground py-2">No holidays added yet.</p>}
            </div>
          </CardContent>
        </Card>

        {/* Designations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Designations</CardTitle>
            <CardDescription>Manage roles available for employee registration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Add new designation..." value={newDesig} onChange={(e) => setNewDesig(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newDesig.trim() && addDesigMutation.mutate(newDesig.trim())} className="h-9 text-sm" />
              <Button size="sm" variant="outline" onClick={() => newDesig.trim() && addDesigMutation.mutate(newDesig.trim())} className="shrink-0"><Plus className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {designations.map((d) => (
                <Badge key={d.id} variant="secondary" className="pl-2.5 pr-1 py-1 text-xs gap-1">
                  {d.name}
                  <button onClick={() => delDesigMutation.mutate(d.id)} className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 transition-colors"><X className="h-2.5 w-2.5" /></button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Departments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Departments</CardTitle>
            <CardDescription>Manage departments for grouping employees.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Add new department..." value={newDept} onChange={(e) => setNewDept(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newDept.trim() && addDeptMutation.mutate(newDept.trim())} className="h-9 text-sm" />
              <Button size="sm" variant="outline" onClick={() => newDept.trim() && addDeptMutation.mutate(newDept.trim())} className="shrink-0"><Plus className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {departments.map((d) => (
                <Badge key={d.id} variant="secondary" className="pl-2.5 pr-1 py-1 text-xs gap-1">
                  {d.name}
                  <button onClick={() => delDeptMutation.mutate(d.id)} className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 transition-colors"><X className="h-2.5 w-2.5" /></button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
