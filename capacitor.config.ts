import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.santanads.nsb',
  appName: 'Navy Seal Burpees',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
