/* Chippi service worker — web push only.
 *
 * Dependency-free and deliberately minimal. Two responsibilities:
 *   1. push           — show the notification the server sent.
 *   2. notificationclick — focus an open Chippi tab, or open the target URL.
 *
 * The payload is JSON: { title, body, url }. We defend against a missing or
 * malformed payload so a bad push never throws inside the SW (which on iOS can
 * cause the browser to silently revoke the subscription).
 */

self.addEventListener('push', function (event) {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Chippi', body: event.data.text() };
    }
  }

  const title = data.title || 'Chippi';
  const options = {
    body: data.body || '',
    icon: '/chip-avatar.png',
    badge: '/chip-avatar.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        // Focus an existing Chippi tab if one is open.
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client && targetUrl !== '/') {
              client.navigate(targetUrl).catch(function () {});
            }
            return;
          }
        }
        // Otherwise open a new one.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
