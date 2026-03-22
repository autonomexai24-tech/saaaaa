import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";

export type AppRole = "admin" | "operator";

interface AuthUser {
  id: string;
  name: string;
  role: AppRole;
  email?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** Sets the user state after successful external login (e.g. from /login page) */
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
  isAdmin: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Simple localStorage persistence for the session
  useEffect(() => {
    const stored = localStorage.getItem("salary_tracker_session");
    if (stored) {
      try {
        setUserState(JSON.parse(stored));
      } catch (e) {
        localStorage.removeItem("salary_tracker_session");
      }
    }
    setIsLoading(false);
  }, []);

  const setUser = useCallback((newUser: AuthUser | null) => {
    if (newUser) {
      localStorage.setItem("salary_tracker_session", JSON.stringify(newUser));
    } else {
      localStorage.removeItem("salary_tracker_session");
    }
    setUserState(newUser);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
  }, [setUser]);

  return (
    <AuthContext.Provider value={{ user, setUser, logout, isAdmin: user?.role === "admin", isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
