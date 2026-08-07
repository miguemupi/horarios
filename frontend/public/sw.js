const CACHE = 'serendipia-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/factoria-serendipia-logo.png'];

self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match('/'))));
});

function pendingCommands() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('serendipia-offline', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
      if (!db.objectStoreNames.contains('commands')) db.createObjectStore('commands', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('commands', 'readonly');
      const all = transaction.objectStore('commands').getAll();
      all.onsuccess = () => { db.close(); resolve(all.result || []); };
      all.onerror = () => { db.close(); reject(all.error); };
    };
  });
}

function removeCommand(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('serendipia-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('commands', 'readwrite');
      transaction.objectStore('commands').delete(id);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  });
}

self.addEventListener('sync', (event) => {
  if (event.tag !== 'serendipia-sync') return;
  event.waitUntil((async () => {
    const commands = await pendingCommands();
    let processed = 0;
    for (const command of commands.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) {
      const response = await fetch(command.path, {
        method: command.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.body),
      });
      if (!response.ok && response.status !== 409) throw new Error(`HTTP ${response.status}`);
      await removeCommand(command.id);
      processed += 1;
    }
    if (processed) {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.postMessage({ type: 'offline-flushed', processed }));
    }
  })());
});
