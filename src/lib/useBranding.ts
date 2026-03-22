import { useQuery } from "@tanstack/react-query";
import { api, type ApiCompanySettings } from "./api";

export interface BrandingInfo {
  companyName: string;
  companyAddress: string;
  logoPath: string | null;
  /** First letter or two of the company name, capitalized. E.g. "PrintWorks" -> "P" */
  initials: string;
}

export function useBranding() {
  return useQuery<BrandingInfo>({
    queryKey: ["company-settings"],
    queryFn: async () => {
      // Fetch the settings using our API client
      const data = await api.get<ApiCompanySettings>("/settings");

      // Set fallback values
      const companyName = data?.company_name || "Salary & Advance Tracker";
      const companyAddress = data?.company_address || "";
      const logoPath = data?.logo_path || null;

      // Compute initials
      const words = companyName.split(" ").filter(w => w.length > 0);
      const initials = words.length > 0
        ? words.slice(0, 2).map((w) => w[0]).join("").toUpperCase()
        : "S";

      return { companyName, companyAddress, logoPath, initials };
    },
    // We can hold on to this data for longer since settings don't change every second
    staleTime: 5 * 60 * 1000,
  });
}
