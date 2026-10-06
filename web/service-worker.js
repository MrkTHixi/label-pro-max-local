// Keep API and UI responses live; the local launcher supplies the offline service.
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET') event.respondWith(fetch(event.request));
});
