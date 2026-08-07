import { EventEmitter } from 'node:events';

const events = new EventEmitter();
events.setMaxListeners(250);

export function publishLiveEvent(type, payload = {}) {
  events.emit('change', { type, payload, generatedAt: new Date().toISOString() });
}

export function subscribeLiveEvents(listener) {
  events.on('change', listener);
  return () => events.off('change', listener);
}
