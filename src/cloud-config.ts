// The Supabase project behind accounts and leaderboards (see supabase/schema.sql).
export const SUPABASE_REF = 'lgzkfgpopofabmjlxxli';
export const SUPABASE_URL = `https://${SUPABASE_REF}.supabase.co`;
/** publishable key: safe in the browser, the database rules decide what it can do */
export const SUPABASE_KEY = 'sb_publishable_60xgi51nmCnfK6-kCJSXgQ_Bq3rzVb7';

/** midnight at the start of this Monday, local time: when Hall Week resets */
export function weekStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
}
