// LevAcademy settings. No secrets here: the Supabase anon (publishable) key is public by design; RLS protects the data.
// Leave url and anonKey empty until the Supabase project exists; store.js then uses the indexeddb provider (this browser only).
export const config = {
  provider: 'cloud',            // 'indexeddb' until supabase.url and supabase.anonKey are filled, then 'cloud'
  supabase: { url: 'https://ofdczjywamhsccgrrzpw.supabase.co', anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZGN6anl3YW1oc2NjZ3JyenB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMjQzOTksImV4cCI6MjEwODcwMDM5OX0.rd82Cy6pjlBroItmOco7iChqZ8vkImGQJb2kJoFDIro' },   // Project URL and anon/publishable key; never the service_role key
  socialProviders: [],          // 'google', 'facebook': add each one after switching it on in Supabase
  gaMeasurementId: '',          // Google Analytics 4, public pages only, after consent
  contractVersions: [1],
};
