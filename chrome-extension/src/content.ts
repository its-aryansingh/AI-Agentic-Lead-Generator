// @ts-nocheck
// content.ts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageContext') {
    const title = document.title;
    const url = window.location.href;
    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    
    // Extract a snippet of the body text, limiting to a reasonable size
    const bodyText = document.body.innerText.substring(0, 3000);

    sendResponse({
      title,
      url,
      metaDescription,
      bodyText
    });
  }
});
