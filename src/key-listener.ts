// Listen for 'z' key to toggle z-index-world
window.addEventListener('keydown', (e) => {
  // Ignore if typing in input fields
  const target = e.target as Element;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target as HTMLElement).isContentEditable) {
    return;
  }

  if (e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    // Send message to background to toggle
    chrome.runtime.sendMessage({ action: 'toggle' });
  }
}, true);
