import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function readProjectFile(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function fileSize(relPath) {
  return fs.statSync(path.resolve(process.cwd(), relPath)).size;
}

describe('Web, Service Worker, Capacitor Mobile, Android Auto, iOS & Bundle Assets', () => {
  it('validates index.html, src/index.css theme & utility classes, SVGs, static binary assets, and documentation files', () => {
    const indexHtml = readProjectFile('index.html');
    expect(indexHtml).toContain('<meta name="viewport"');
    expect(indexHtml).toContain('<title>Vecto Route Tracker</title>');
    expect(indexHtml).toContain('<div id="root"></div>');
    expect(indexHtml).toContain('/src/main.jsx');

    const indexCss = readProjectFile('src/index.css');
    expect(indexCss).toContain('@import "tailwindcss";');
    expect(indexCss).toContain('@plugin "@tailwindcss/typography";');
    expect(indexCss).toContain('--color-primary-500');
    expect(indexCss).toContain('.glass-panel');
    expect(indexCss).toContain('.btn-primary');
    expect(indexCss).toContain('.pulse-border');

    const faviconSvg = readProjectFile('public/favicon.svg');
    expect(faviconSvg).toContain('<svg');
    expect(faviconSvg).toContain('viewBox="0 0 48 46"');

    const iconsSvg = readProjectFile('public/icons.svg');
    const symbolIds = [
      'bluesky-icon',
      'discord-icon',
      'documentation-icon',
      'github-icon',
      'social-icon',
      'x-icon',
    ];
    for (const id of symbolIds) {
      expect(iconsSvg).toContain(`<symbol id="${id}"`);
    }

    for (const assetPath of ['src/assets/hero.png', 'src/assets/react.svg', 'src/assets/vite.svg']) {
      expect(fileSize(assetPath)).toBeGreaterThan(0);
    }

    for (const docPath of [
      'README.md',
      'onboarding_guide.md',
      'user_guide.md',
      'job_report_revision_guide.md',
      'VECTO_ARCHITECTURE_REVIEW.md',
    ]) {
      expect(readProjectFile(docPath).trim().length).toBeGreaterThan(100);
    }
  });

  it('executes public/firebase-messaging-sw.js lifecycle, push notifications, and notificationclick handlers via node:vm', async () => {
    const swSource = readProjectFile('public/firebase-messaging-sw.js');
    const listeners = {};
    const openWindow = vi.fn().mockResolvedValue(null);
    const matchAll = vi.fn();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const claim = vi.fn().mockResolvedValue('claimed');
    const skipWaiting = vi.fn();

    const sandbox = {
      URL,
      self: {
        location: { origin: 'https://vecto.app' },
        skipWaiting,
        clients: { claim, matchAll, openWindow },
        registration: { showNotification },
        addEventListener(type, fn) {
          listeners[type] = fn;
        },
      },
    };

    vm.runInNewContext(swSource, sandbox);
    expect(Object.keys(listeners)).toEqual(['install', 'activate', 'push', 'notificationclick']);

    // install
    listeners.install();
    expect(skipWaiting).toHaveBeenCalledTimes(1);

    // activate
    const activatePromises = [];
    listeners.activate({ waitUntil: (p) => activatePromises.push(p) });
    await Promise.all(activatePromises);
    expect(claim).toHaveBeenCalledTimes(1);

    // push with JSON payload
    const jsonPushPromises = [];
    listeners.push({
      data: {
        json: () => ({
          notification: { title: 'New Job Assigned', body: 'North Loop' },
          data: { jobId: 'job-9', url: '/?job=job-9' },
        }),
      },
      waitUntil: (p) => jsonPushPromises.push(p),
    });
    await Promise.all(jsonPushPromises);
    expect(showNotification).toHaveBeenCalledWith(
      'New Job Assigned',
      expect.objectContaining({
        body: 'North Loop',
        tag: 'vecto-job-job-9',
        data: { jobId: 'job-9', url: '/?job=job-9' },
      })
    );

    // push with plain-text fallback when .json() throws
    const textPushPromises = [];
    listeners.push({
      data: {
        json: () => {
          throw new SyntaxError('Not JSON');
        },
        text: () => 'Plain dispatch alert',
      },
      waitUntil: (p) => textPushPromises.push(p),
    });
    await Promise.all(textPushPromises);
    expect(showNotification).toHaveBeenLastCalledWith(
      'Vecto Dispatch',
      expect.objectContaining({
        body: 'Plain dispatch alert',
        tag: 'vecto-dispatch',
      })
    );

    // notificationclick with matching client focuses and posts message
    const close = vi.fn();
    const postMessage = vi.fn();
    const focus = vi.fn().mockResolvedValue(undefined);
    matchAll.mockResolvedValueOnce([{ url: 'https://vecto.app/dashboard', postMessage, focus }]);

    const clickExistingPromises = [];
    listeners.notificationclick({
      notification: { close, data: { jobId: 'job-9', url: '/?job=job-9' } },
      waitUntil: (p) => clickExistingPromises.push(p),
    });
    await Promise.all(clickExistingPromises);
    expect(close).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'VECTO_NOTIFICATION_CLICK', jobId: 'job-9' });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();

    // notificationclick with no existing tab opens new window
    matchAll.mockResolvedValueOnce([]);
    const clickNewPromises = [];
    listeners.notificationclick({
      notification: { close: vi.fn(), data: { jobId: 'job-12', url: '/?job=job-12' } },
      waitUntil: (p) => clickNewPromises.push(p),
    });
    await Promise.all(clickNewPromises);
    expect(openWindow).toHaveBeenCalledWith('https://vecto.app/?job=job-12');
  });

  it('verifies Capacitor config, Android manifest/Auto service contracts, iOS Info.plist, and React.lazy splitting', () => {
    const capConfig = JSON.parse(readProjectFile('capacitor.config.json'));
    expect(capConfig.appId).toBe('vecto.app');
    expect(capConfig.appName).toBe('Vecto');
    expect(capConfig.webDir).toBe('dist');
    expect(capConfig.plugins.StatusBar).toBeDefined();
    expect(capConfig.plugins.FirebaseAuthentication.providers).toContain('google.com');
    expect(capConfig.plugins.PushNotifications.presentationOptions).toEqual(
      expect.arrayContaining(['badge', 'sound', 'alert'])
    );

    const androidManifest = readProjectFile('android/app/src/main/AndroidManifest.xml');
    for (const perm of [
      'ACCESS_FINE_LOCATION',
      'CAMERA',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
      'vecto.app.car.VectoCarAppService',
      'androidx.car.app.CarAppService',
      'androidx.car.app.category.POI',
      'android.hardware.location.gps',
      'android.hardware.camera',
    ]) {
      expect(androidManifest).toContain(perm);
    }

    const autoDesc = readProjectFile('android/app/src/main/res/xml/automotive_app_desc.xml');
    expect(autoDesc).toContain('<uses name="template" />');

    const carService = readProjectFile('android/app/src/main/java/vecto/app/car/VectoCarAppService.java');
    expect(carService).toContain('extends CarAppService');
    expect(carService).toContain('createHostValidator');
    expect(carService).toContain('JobListCarScreen');

    const carSession = readProjectFile('android/app/src/main/java/vecto/app/car/VectoCarSession.java');
    expect(carSession).toContain('extends Session');
    expect(carSession).toContain('JobListCarScreen');

    const jobListScreen = readProjectFile('android/app/src/main/java/vecto/app/car/JobListCarScreen.java');
    expect(jobListScreen).toContain('formatStatusLabel');
    expect(jobListScreen).toContain('MAX_LIST_ITEMS = 6');
    expect(jobListScreen).toContain('JobDetailCarScreen');

    const jobDetailScreen = readProjectFile('android/app/src/main/java/vecto/app/car/JobDetailCarScreen.java');
    expect(jobDetailScreen).toContain('"complete_stop"');
    expect(jobDetailScreen).toContain('"update_status"');
    expect(jobDetailScreen).toContain('"in-progress"');
    expect(jobDetailScreen).toContain('"completed"');
    expect(jobDetailScreen).toContain('Done Stop #');

    const bridgePlugin = readProjectFile('android/app/src/main/java/vecto/app/car/VectoCarBridgePlugin.java');
    expect(bridgePlugin).toContain('@CapacitorPlugin(name = "VectoCarBridge")');
    expect(bridgePlugin).toContain('public void syncJobs');
    expect(bridgePlugin).toContain('public void drainPendingCarActions');
    expect(bridgePlugin).toContain('public void getPendingCarAction');
    expect(bridgePlugin).toContain('prefsListener');

    const iosPlist = readProjectFile('ios/App/App/Info.plist');
    for (const key of [
      'NSLocationWhenInUseUsageDescription',
      'NSLocationAlwaysAndWhenInUseUsageDescription',
      'NSCameraUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'UIBackgroundModes',
      '<string>location</string>',
      '<string>remote-notification</string>',
    ]) {
      expect(iosPlist).toContain(key);
    }

    const appSource = readProjectFile('src/App.jsx');
    const lazyTargets = [
      'CustomerTrackingView',
      'OperationsBoard',
      'SettingsModal',
      'MapSettingsModal',
      'CreateJobModal',
      'AdminSettingsModal',
      'CompanySettingsModal',
      'ProfileModal',
      'UserGuideModal',
      'TechnicalsModal',
      'DevelopmentModal',
      'InviteModal',
      'JobReportModal',
      'LogProgressModal',
      'LogExpenseModal',
      'PodCaptureModal',
      'DriverRosterModal',
      'ExpenseLedgerModal',
      'FleetVehiclesModal',
      'DvirModal',
      'FleetAnalyticsModal',
    ];
    for (const target of lazyTargets) {
      expect(appSource).toMatch(new RegExp(`const ${target} = React\\.lazy\\(`));
    }
  });
});
