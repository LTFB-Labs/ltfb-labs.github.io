// LevAcademy settings. No secrets here: the Supabase anon key and the Cognito client id are public by design.
// Leave the ids empty until the cloud accounts exist; store.js then uses the local provider.
export const config = {
  provider: 'local',            // 'local' until the cloud ids below are filled, then 'cloud'
  cognito: { region: 'eu-central-1', userPoolId: '', clientId: '', domain: '' },   // domain = managed login domain
  supabase: { url: '', anonKey: '' },
  gaMeasurementId: '',          // Google Analytics 4, public pages only, after consent
  contractVersions: [1],
};
