// Runs in LinkedIn's own page (not the extension's sandbox). LinkedIn gives a
// post's link only through "Copy link to post", which writes to the clipboard.
// When the extension asks for a link, catch it here instead of the clipboard.
(() => {
  const cb = navigator.clipboard;
  if (!cb?.writeText) return;
  const orig = cb.writeText.bind(cb);
  cb.writeText = function (text) {
    const el = document.documentElement;
    if (el.dataset.acGrabLink === "1") {
      el.dataset.acGrabLink = "";
      window.postMessage({ acPostLink: String(text) }, location.origin);
      return Promise.resolve();
    }
    return orig(text);
  };
})();
