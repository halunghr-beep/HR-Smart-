import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.halung.hrsmart',
  appName: 'HR Smart',
  webDir: 'dist',
  android: {
    allowMixedContent: true
  }
};

export default config;
