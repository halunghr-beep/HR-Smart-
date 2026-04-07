const config: CapacitorConfig = {
  appId: 'com.halung.hrsmart',
  appName: 'HR Smart',
  webDir: 'dist',
  server: {
    url: 'https://hr-smart.onrender.com',  // ← hena el sirr
    cleartext: true,
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true
  }
};
