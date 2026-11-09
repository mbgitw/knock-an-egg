// Small runtime shims required by the Builda Chrome 81 / iOS 15 target.
// Loaded before the host SDK and application modules. Never replace native APIs.
(function () {
  'use strict';
  function define(target, key, value) { if (!target[key]) Object.defineProperty(target, key, {value, configurable:true, writable:true}); }
  define(Array.prototype, 'at', function (index) {
    if (this == null) throw new TypeError('Array.at receiver');
    const object = Object(this), length = Math.min(Math.max(Math.trunc(Number(object.length) || 0), 0), Number.MAX_SAFE_INTEGER);
    let n = Math.trunc(Number(index) || 0); if (n < 0) n += length;
    return n < 0 || n >= length ? undefined : object[n];
  });
  define(Object, 'hasOwn', function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); });
  if (globalThis.crypto) define(crypto, 'randomUUID', function () {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  });
  for (const type of [Element, Document, DocumentFragment]) define(type.prototype, 'replaceChildren', function (...nodes) {
    const fragment = document.createDocumentFragment();
    fragment.append(...nodes); while(this.firstChild)this.removeChild(this.firstChild); this.appendChild(fragment);
  });
  // Chrome 81 accepts the options object but ignores its signal member.
  const probe = new EventTarget(), controller = new AbortController(); let fired = false;
  probe.addEventListener('compat', () => { fired = true; }, {signal:controller.signal});
  controller.abort(); probe.dispatchEvent(new Event('compat'));
  if (fired) {
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener, records = new WeakMap();
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      const receiver = this || globalThis; // Unqualified window.addEventListener calls.
      if (!options || !options.signal || !callback) return add.call(receiver,type,callback,options);
      const signal = options.signal, capture = !!options.capture;
      if (signal.aborted) return;
      let list = records.get(receiver); if (!list) records.set(receiver, list = []);
      if (list.some(r => r.type === type && r.callback === callback && r.capture === capture)) return;
      const target = receiver;
      const record = {type,callback,capture};
      const cleanup = () => { remove.call(target,type,record.listener,capture); remove.call(signal,'abort',cleanup); const i=list.indexOf(record); if(i>=0)list.splice(i,1); };
      record.cleanup = cleanup;
      record.listener = function (event) { if (options.once) cleanup(); if (typeof callback === 'function') callback.call(this,event); else callback.handleEvent(event); };
      list.push(record); add.call(target,type,record.listener,options); add.call(signal,'abort',cleanup,{once:true});
    };
    EventTarget.prototype.removeEventListener = function (type, callback, options) {
      const receiver = this || globalThis;
      const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
      const record = (records.get(receiver)||[]).find(r=>r.type===type && r.callback===callback && r.capture===capture);
      if(record)record.cleanup(); else remove.call(receiver,type,callback,options);
    };
  }
})();
