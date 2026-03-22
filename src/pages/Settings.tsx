import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, ImageIcon, Save, ShieldCheck, Plus, UserX } from "lucide-react";

interface SystemUser {
  id: string;
  name: string;
  userId: string;
  role: "admin" | "operator";
}

export default function Settings() {
  const queryClient = useQueryClient();

  // Branding
  const [companyName, setCompanyName] = useState("PrintWorks Pvt. Ltd.");
  const [companyAddress, setCompanyAddress] = useState("42 Industrial Area, Sector 7\nNew Delhi — 110020");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // User management
  const { data: users = [], isLoading: isUsersLoading } = useQuery<SystemUser[]>({
    queryKey: ["users"],
    queryFn: () => api.get<SystemUser[]>("/users"),
  });

  const [newName, setNewName] = useState("");
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "operator">("operator");
  const [newPassword, setNewPassword] = useState("");

  const addUserMutation = useMutation({
    mutationFn: (body: any) => api.post("/users", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setNewName("");
      setNewUserId("");
      setNewPassword("");
      toast.success("User added successfully");
    },
    onError: (err: Error) => toast.error("Failed to add user", { description: err.message }),
  });

  const revokeUserMutation = useMutation({
    mutationFn: (id: string) => api.put(`/users/${id}/revoke`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Access revoked");
    },
    onError: (err: Error) => toast.error("Failed to revoke user", { description: err.message }),
  });

  const addUser = () => {
    if (!newName.trim() || !newUserId.trim() || !newPassword.trim()) {
      toast.error("Please fill all fields");
      return;
    }
    addUserMutation.mutate({ name: newName.trim(), userId: newUserId.trim(), role: newRole, password: newPassword });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Global application configuration and user management.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card A: Company Branding */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Company Branding
            </CardTitle>
            <CardDescription>This logo will appear on the Login Screen and all generated Payslips.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Registered Company Name</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Registered Address</Label>
              <Textarea value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} className="text-sm min-h-[72px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Company Logo</Label>
              <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 p-6 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="max-h-16 max-w-[200px] object-contain" />
                ) : (
                  <>
                    <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-xs font-medium text-muted-foreground">Click or Drag to Upload Logo</p>
                    <p className="text-[10px] text-muted-foreground/70">Recommended: 250×100px (PNG / JPG)</p>
                  </>
                )}
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setLogoPreview(URL.createObjectURL(file));
                }} />
              </label>
            </div>
            <Button className="w-full mt-2" size="sm">
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Branding
            </Button>
          </CardContent>
        </Card>

        {/* Card B: User Management */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              System Users & Roles
            </CardTitle>
            <CardDescription>Create login IDs for your staff.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add user row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">User ID</Label>
                <Input value={newUserId} onChange={(e) => setNewUserId(e.target.value)} placeholder="login@email.com" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Role</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as "admin" | "operator")}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="operator">Operator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Password</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" className="h-9 text-sm" />
              </div>
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={addUser} disabled={!newName.trim() || !newUserId.trim() || !newPassword.trim() || addUserMutation.isPending}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {addUserMutation.isPending ? "Adding..." : "Add User"}
            </Button>

            {/* Active users */}
            <div className="space-y-2 pt-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Active Users</p>
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                      {u.name.split(" ").map(w => w[0]).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.userId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px] capitalize">{u.role}</Badge>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => revokeUserMutation.mutate(u.id)} disabled={revokeUserMutation.isPending}>
                      <UserX className="h-3 w-3 mr-1" />
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
