// =============================================================================
//  src/lib/supabase.ts
//  Supabase client — singleton instance for the entire app.
//
//  Environment variables (add to .env):
//    VITE_SUPABASE_URL      = https://<project>.supabase.co
//    VITE_SUPABASE_ANON_KEY = <your anon/public key>
//
//  If you are using the local Express + pg backend instead of Supabase:
//    Leave these blank and use src/lib/api.ts fetch helpers instead.
//    This file provides a typed client that the rest of the app can import;
//    it will gracefully no-op when credentials are absent.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// ── Guard: only create the client when credentials are present ─────────────
function createSupabaseClient(): SupabaseClient<Database> {
  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      "[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. " +
      "The Supabase client will not be available. " +
      "Using the Express REST API (/api/*) as the data layer instead."
    );
    // Return a no-op proxy so imports never throw undefined errors
    return new Proxy({} as SupabaseClient<Database>, {
      get: (_target, prop) => {
        if (prop === "from" || prop === "rpc" || prop === "auth" || prop === "storage") {
          return () => ({ data: null, error: new Error("Supabase client not configured") });
        }
        return undefined;
      },
    });
  }

  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    db: {
      schema: "public",
    },
  });
}

/** Singleton Supabase client typed against the full Database schema */
export const supabase = createSupabaseClient();

export type { SupabaseClient };
