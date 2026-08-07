const DATABASE = 'serendipia-offline';
const VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
      if (!db.objectStoreNames.contains('commands')) db.createObjectStore('commands', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const result = operation(transaction.objectStore(name));
    transaction.oncomplete = () => { db.close(); resolve(result?.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export const saveDraftOffline = (key, value) => store('drafts', 'readwrite', (target) => target.put(value, key));
export const removeDraftOffline = (key) => store('drafts', 'readwrite', (target) => target.delete(key));
export const loadDraftOffline = (key) => store('drafts', 'readonly', (target) => target.get(key));

export async function queueCommand(path, method, body) {
  const id = body.idempotencyKey || crypto.randomUUID();
  await store('commands', 'readwrite', (target) => target.put({ id, path, method, body, queuedAt: new Date().toISOString() }));
  navigator.serviceWorker?.ready.then((registration) => registration.sync?.register('serendipia-sync')).catch(() => {});
  return id;
}

export async function flushCommands() {
  const commands = await store('commands', 'readonly', (target) => target.getAll()) || [];
  let processed = 0;
  for (const command of commands.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) {
    try {
      const response = await fetch(command.path, {
        method: command.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.body),
      });
      if (!response.ok && response.status !== 409) break;
      await store('commands', 'readwrite', (target) => target.delete(command.id));
      processed += 1;
    } catch { break; }
  }
  if (processed) window.dispatchEvent(new CustomEvent('serendipia-offline-flushed', { detail: { processed } }));
  return processed;
}
