import { createClient } from "@supabase/supabase-js";

const url = __NVA_SUPABASE_URL__;
const key = __NVA_SUPABASE_PUBLISHABLE_KEY__;

export const configured = Boolean(key);
export const supabase = configured
  ? createClient(url, key, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null;
