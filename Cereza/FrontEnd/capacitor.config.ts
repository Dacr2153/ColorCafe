import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor — empaquetado nativo Android (y opcionalmente iOS) sobre el mismo
// bundle web PWA. La build de producción se sirve desde `dist/`.
//
// Para evitar publicar dos motores de cámara distintos, las rutas /v2/* usan
// `getUserMedia` que en Android Capacitor mapea automáticamente al permiso de
// cámara nativo (requiere `android.permission.CAMERA` en AndroidManifest.xml).
const config: CapacitorConfig = {
  appId: 'co.cafevision.app',
  appName: 'CaféVision',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#FAF7F2',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      backgroundColor: '#6B4423',
      style: 'DARK',
    },
  },
};

export default config;
