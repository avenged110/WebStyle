/* WebStyle — settings import window.
 * On macOS the toolbar popover closes as soon as a file dialog opens, so (like TabBackup and Autoplay Stopper)
 * the picker lives in its own small window. Imported sites are merged into the current list; a site that's
 * already listed takes the imported settings. Stylus backups (.json) are accepted too, for migrating. */
"use strict";

(() => {
  const FORMAT = globalThis.WS_FORMAT;
  const STYLUS = globalThis.WS_STYLUS;
  const SITES = globalThis.WS_SITES;
  const MAX_BYTES = 4 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);
  const msg = $("msg");
  const choose = $("choose");
  const input = $("file");

  function say(text, cls = "") {
    msg.textContent = text;
    msg.className = "msg" + (cls ? " " + cls : "");
  }

  const plural = (n) => (n === 1 ? "1 site" : `${n} sites`);

  chrome.storage.local.get("sites").then(({ sites }) => {
    const n = Array.isArray(sites) ? sites.length : 0;
    $("lede").textContent =
      "Choose a WebStyle settings file (.txt) or a Stylus backup (.json). " +
      (n > 0 ? `It's merged into your current list (${plural(n)}); sites in both take the file's settings.` : "");
  });

  /** Opens a picker that starts on the Desktop and only offers .txt/.json files; falls back to <input type=file>. */
  async function pickFile() {
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const [handle] = await window.showOpenFilePicker({
          id: "webstyle-import",
          startIn: "desktop",
          multiple: false,
          excludeAcceptAllOption: true,
          // One entry for both: with separate entries macOS only offers the first until you switch the
          // format menu, so .json files showed up grayed out.
          types: [
            {
              description: "WebStyle settings or Stylus backup",
              accept: { "text/plain": [".txt"], "application/json": [".json"] },
            },
          ],
        });
        return handle ? await handle.getFile() : null;
      } catch (e) {
        if (e && e.name === "AbortError") return null; // the user canceled
      }
    }
    return new Promise((resolve) => {
      input.value = "";
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }

  async function parse(file) {
    const isJson = /\.json$/i.test(file.name);
    if (!isJson && !/\.txt$/i.test(file.name)) throw new Error("Please choose a .txt or .json file.");
    if (file.size === 0) throw new Error("That file is empty.");
    if (file.size > MAX_BYTES) throw new Error("That file is too large to be a settings file.");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch (e) {
      throw new Error("That file isn't readable plain text.");
    }
    return isJson ? STYLUS.parse(text) : FORMAT.parseText(text);
  }

  choose.addEventListener("click", async () => {
    const file = await pickFile();
    if (!file) return;
    choose.disabled = true;
    try {
      const incoming = await parse(file);
      const { sites } = await chrome.storage.local.get("sites");
      const current = Array.isArray(sites) ? sites : [];
      const known = new Set(current.map((e) => e.domain));
      const updated = incoming.filter((e) => known.has(e.domain)).length;
      await chrome.storage.local.set({ sites: SITES.merge(current, incoming) });
      const added = incoming.length - updated;
      say(
        `Imported ${plural(incoming.length)} from “${file.name}”` +
          (updated ? ` (${added} new, ${updated} updated).` : "."),
        "ok"
      );
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "show-popup" }).catch(() => {});
        window.close();
      }, 1600);
    } catch (e) {
      say(e.message || String(e), "err");
      choose.disabled = false;
    }
  });

  $("cancel").addEventListener("click", () => window.close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });
})();
