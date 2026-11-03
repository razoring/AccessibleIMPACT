// renderer.js — runs in isolated world of arcade.makecode.com iframe
// Relays render requests from background.js to in_page_renderer.js (MAIN world).

(function () {
  'use strict';

  const pending = new Map();

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.action !== 'AIFX_BLOCK_RENDERED') return;
    const { id, svg, width, height, isMultiLine, err } = event.data;
    if (pending.has(id)) {
      const resolver = pending.get(id);
      pending.delete(id);
      resolver({ svg, width, height, isMultiLine, err });
    }
  });

  function requestBlockRender(token) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ svg: null, err: 'timeout' });
        }
      }, 5000);

      pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });

      window.postMessage({
        action: 'AIFX_RENDER_BLOCK',
        id: id,
        token: token
      }, '*');
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || request.action !== 'renderToken') return;
    requestBlockRender(request.token || '')
      .then(res => sendResponse(res || { svg: null }))
      .catch(err => sendResponse({ svg: null, err: String(err) }));
    return true; // async
  });

  console.info('[AIFX renderer] bridge initialized');
})();
