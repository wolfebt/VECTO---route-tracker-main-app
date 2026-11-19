/* VECTO Firebase Cloud Messaging & Web Dispatch Notification Service Worker */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { notification: { title: 'Vecto Dispatch', body: event.data.text() } };
    }
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || 'Vecto Dispatch';
  const body = notification.body || data.body || 'You have a new dispatch update.';
  const jobId = data.jobId || '';

  const baseUrl = self.registration?.scope || (self.location.origin + '/');
  const iconUrl = new URL('favicon.svg', baseUrl).href;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: iconUrl,
      badge: iconUrl,
      tag: jobId ? `vecto-job-${jobId}` : 'vecto-dispatch',
      data: {
        jobId,
        url: data.url || baseUrl
      }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const jobId = data.jobId || '';
  const baseUrl = self.registration?.scope || (self.location.origin + '/');
  const targetUrl = jobId
    ? new URL(`?job=${encodeURIComponent(jobId)}`, baseUrl).href
    : (data.url || baseUrl);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(baseUrl) && 'focus' in client) {
          client.postMessage({ type: 'VECTO_NOTIFICATION_CLICK', jobId });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
