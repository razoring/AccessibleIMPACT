// background.js — message relay between overlay (IMPACT) and renderer (Arcade MakeCode)
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'renderToken') {
    // Find arcade.makecode.com tab with renderer content script
    chrome.tabs.query({ url: '*://arcade.makecode.com/*' }, (tabs) => {
      if (!tabs || !tabs.length) { sendResponse({ svg: null, err: 'no arcade tab' }); return; }
      chrome.tabs.sendMessage(tabs[0].id, req, (res) => {
        if (chrome.runtime.lastError) {
          sendResponse({ svg: null, err: chrome.runtime.lastError.message || 'renderer unreachable' });
        } else {
          sendResponse(res || { svg: null, err: 'no renderer response' });
        }
      });
    });
    return true; // async
  }
});
