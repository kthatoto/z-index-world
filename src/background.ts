// Tab state management
const tabStates = new Map<number, boolean>();

// Toggle function shared by icon click and keyboard shortcut
async function toggleGame(tabId: number) {
  const isActive = tabStates.get(tabId) ?? false;

  if (isActive) {
    // Turn OFF: Send message to cleanup
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'cleanup' });
    } catch (e) {
      // Content script may not be loaded
    }
    tabStates.set(tabId, false);
    await chrome.action.setBadgeText({ tabId, text: '' });
  } else {
    // Turn ON: Inject content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-script.js'],
      });
      tabStates.set(tabId, true);
      await chrome.action.setBadgeText({ tabId, text: 'ON' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
    } catch (e) {
      console.error('[z-index-world] Failed to inject script:', e);
    }
  }
}

// Toggle game on/off when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await toggleGame(tab.id);
});

// Listen for toggle message from key-listener
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'toggle' && sender.tab?.id) {
    toggleGame(sender.tab.id);
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// Clean up when tab is navigated
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabStates.set(tabId, false);
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});
