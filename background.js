// background.js — message relay between overlay (IMPACT parent frame) and renderer
// (embedded arcade.makecode.com IFRAME). Locates arcade iframe in sender tab.

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || req.action !== 'renderToken') return;

  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) {
    console.error('[AIFX bg] No sender tab ID');
    sendResponse({ svg: null, err: 'no sender tab' });
    return;
  }

  chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
    if (chrome.runtime.lastError) {
      console.error('[AIFX bg] getAllFrames error:', chrome.runtime.lastError.message);
      sendResponse({ svg: null, err: 'getAllFrames: ' + chrome.runtime.lastError.message });
      return;
    }
    if (!frames || !frames.length) {
      console.error('[AIFX bg] No frames in tab', tabId);
      sendResponse({ svg: null, err: 'no frames in tab' });
      return;
    }

    console.info('[AIFX bg] Found', frames.length, 'frames in tab', tabId);
    let target = null;
    for (const f of frames) {
      if (f.frameId === 0) continue;
      if (/^https:\/\/[^/]*arcade\.makecode\.com\//.test(f.url)) {
        target = f;
        break;
      }
    }
    if (!target) {
      target = frames.find(f => f.frameId !== 0 && (f.url.includes('makecode.com') || f.url.includes('pxt-')));
    }
    if (!target) {
      console.error('[AIFX bg] Arcade iframe not found in frames:', frames.map(f => f.url));
      sendResponse({ svg: null, err: 'arcade iframe not found in tab' });
      return;
    }

    console.info('[AIFX bg] Relaying', req.token, 'to frame', target.frameId, target.url);
    chrome.tabs.sendMessage(tabId, req, { frameId: target.frameId }, (res) => {
      if (chrome.runtime.lastError) {
        console.error('[AIFX bg] Relay error:', chrome.runtime.lastError.message);
        sendResponse({ svg: null, err: 'renderer unreachable: ' + (chrome.runtime.lastError.message || 'unknown') });
        return;
      }
      sendResponse(res || { svg: null, err: 'no renderer response' });
    });
  });

  return true; // async response
});