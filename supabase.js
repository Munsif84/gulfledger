const SUPABASE_URL = 'https://ykzivnasjwtuhvjxfxzf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlreml2bmFzand0dWh2anhmeHpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjI5NzAsImV4cCI6MjA5MjE5ODk3MH0.t9n60yaQJZcgD4BoNIhGiNNVMB3QIxcLc4KQL82pmNE';

// Load Supabase from CDN
async function getSupabase() {
  if (window._supabase) return window._supabase;
  const { createClient } = supabase;
  window._supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return window._supabase;
}
