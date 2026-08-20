# FASE 5 — Empaquetado Android + PWA

CaféVision se distribuye como **PWA instalable** (Workbox vía `vite-plugin-pwa`)
y opcionalmente como **APK/AAB Android** vía Capacitor sobre el mismo bundle.

## Arquitectura

```
dist/  (build Vite)
 │
 ├── index.html + assets   ──► servido por Nginx (FrontEnd/Dockerfile)
 │                                 ▲ instalable como PWA
 │
 └── webDir referenced by  ──► Capacitor android/ (Gradle)
                                   genera APK/AAB firmados
```

## PWA — verificación rápida

```bash
cd Cereza/FrontEnd
npm run build
npx serve dist          # abrir http://localhost:3000, DevTools → Application → Manifest
```

Estrategias Workbox (ver [vite.config.ts](vite.config.ts)):

| Recurso                | Estrategia              | TTL    |
|------------------------|-------------------------|--------|
| Script/CSS/Worker      | CacheFirst              | 30 d   |
| Fuentes                | CacheFirst              | 90 d   |
| Imágenes               | StaleWhileRevalidate    | 14 d   |
| GET `/api/v1/*`        | NetworkFirst (4s)       | 30 min |
| POST/PATCH/DELETE      | **No cacheado** (jamás) | —      |

Importante (directriz ética): los métodos de mutación nunca se cachean para
garantizar que ninguna operación de negocio se duplique o falsifique al
recuperar conexión.

## Android — Capacitor

### Primera vez

```bash
cd Cereza/FrontEnd
npm i -D @capacitor/cli @capacitor/core @capacitor/android \
         @capacitor/splash-screen @capacitor/status-bar
npm run build
npx cap add android
npx cap copy android
```

### Builds posteriores

```bash
npm run build
npx cap copy android
npx cap open android        # Android Studio para release signed APK / AAB
```

### Permisos requeridos en `android/app/src/main/AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.CAMERA"/>
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-feature android:name="android.hardware.camera" android:required="true"/>
```

### Apuntar al backend

La app embebe la URL base en tiempo de build (variables `VITE_API_BASE_URL` y
`VITE_WS_URL`). Para builds Android usa:

```bash
VITE_API_BASE_URL=https://api.cafevision.co \
VITE_WS_URL=wss://api.cafevision.co/ws \
npm run build
npx cap copy android
```

NO incrustar tokens ni secretos en el bundle: el JWT se obtiene en runtime vía
`/auth/login`. Cualquier campo en el bundle es público.

## Limitaciones honestas

- La aplicación NO funciona 100% offline: el motor de análisis se ejecuta en el
  servidor Python (FASE 2), no en el dispositivo. Cuando no hay red, la captura
  se encola en IndexedDB y se sincroniza al recuperar conexión.
- No implementamos *background sync* todavía: el envío diferido sólo se ejecuta
  mientras la app está abierta.
- Notificaciones push: pendientes (requieren FCM + clave de servidor real).
