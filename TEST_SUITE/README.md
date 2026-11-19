# VECTO Test Suite (`TEST_SUITE/`)

Standalone automated verification suite for the VECTO Route Tracker web, Cloud Functions v2, security rules, and mobile/automotive assets.

## Folder Structure

- `TEST_SUITE/helpers/` — Shared DOM/Canvas/Clipboard mocks (`setupDomMocks.js`), async IndexedDB v2 fake (`fakeIndexedDB.js`), stateful Firestore mock (`firebaseMock.js`), and React 19 `createRoot` + `act` harness (`renderUtils.jsx`).
- `TEST_SUITE/*.test.js` — Unit suites for utilities (`src/utils/*`), Zustand stores (`src/store/*`), static rules/index invariants (`securityRules.static.test.js`), live Firestore Emulator rules (`firestoreRules.emulator.test.js`), and web/Capacitor/Android Auto/iOS/Service Worker assets (`platformAssets.test.js`).
- `TEST_SUITE/hooks/` — Custom React hook suites covering Firebase sync/onboarding (`useFirebaseAndOnboarding.test.js`) and telemetry/routing/native bridges (`telemetryRoutingAndNativeHooks.test.js`).
- `TEST_SUITE/components/` — UI component, Operations Board, fleet vehicle/DVIR, analytics/reporting, portal, and modal suites covering `App.jsx`, views, layout overlays, and all 19 lazy modals.
- `TEST_SUITE/functions/` — Node-environment tests for all 5 Firebase Cloud Functions v2 exports in `functions/index.js` (`cloudFunctions.test.js`).

## Commands

Run from the repository root (`npm` or `npm.cmd` in Windows PowerShell):

```powershell
# Lint application + TEST_SUITE files
npm.cmd run lint

# Run all non-emulator Vitest suites
npm.cmd test

# Run targeted suites
npm.cmd run test:unit
npm.cmd run test:hooks
npm.cmd run test:ui
npm.cmd run test:fleet-assets
npm.cmd run test:platform-assets
npm.cmd run test:functions
npm.cmd run test:rules

# Full check (lint + vitest + Vite production build)
npm.cmd run test:all
```

### Live Firestore Rules Emulator (`test:rules:emulator`)

`TEST_SUITE/firestoreRules.emulator.test.js` is skipped during regular `npm test` runs unless `FIRESTORE_EMULATOR_HOST` or `RUN_FIRESTORE_EMULATOR_TESTS` is set. Running it via Firebase CLI requires Java (e.g., Android Studio JBR) on `PATH`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
npm.cmd run test:rules:emulator
```
