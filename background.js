// background.js — message relay between overlay (IMPACT parent frame) and renderer
// (embedded arcade.makecode.com IFRAME). Locates arcade iframe in sender tab.

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req) return;

  if (req.action === 'rendererReady') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { action: 'rendererReady' }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
    return;
  }

  if (req.action !== 'renderToken') return;

  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) {
    console.error('[AIFX bg] No sender tab ID');
    sendResponse({ svg: null, err: 'no sender tab' });
    return;
  }

  function tryRelay(attemptsLeft) {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      if (chrome.runtime.lastError || !frames || !frames.length) {
        if (attemptsLeft > 0) {
          setTimeout(() => tryRelay(attemptsLeft - 1), 400);
          return;
        }
        sendResponse({ svg: null, err: 'getAllFrames failed' });
        return;
      }

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
        if (attemptsLeft > 0) {
          setTimeout(() => tryRelay(attemptsLeft - 1), 400);
          return;
        }
        sendResponse({ svg: null, err: 'arcade iframe not found in tab' });
        return;
      }

      chrome.tabs.sendMessage(tabId, req, { frameId: target.frameId }, (res) => {
        if (chrome.runtime.lastError) {
          if (attemptsLeft > 0) {
            setTimeout(() => tryRelay(attemptsLeft - 1), 400);
            return;
          }
          sendResponse({ svg: null, err: 'renderer unreachable: ' + chrome.runtime.lastError.message });
          return;
        }
        sendResponse(res || { svg: null, err: 'no renderer response' });
      });
    });
  }

  tryRelay(6);
  return true; // async response
});
