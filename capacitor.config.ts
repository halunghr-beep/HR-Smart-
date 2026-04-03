import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.halung.hrsmart',
  appName: 'HR Smart',
  webDir: 'dist',
  server: {
    url: 'https://hr-smart.onrender.com',
    cleartext: true,
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
