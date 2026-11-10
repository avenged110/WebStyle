/* WebStyle — popover. */
"use strict";

(() => {
  const F = globalThis.WS_FEATURES;
  const SITES = globalThis.WS_SITES;
  const $ = (id) => document.getElementById(id);

  const el = {
    count: $("count"),
    btnAdd: $("btn-add"),
    btnAddLabel: $("btn-add-label"),
    btnAddSub: $("btn-add-sub"),
    favicon: $("favicon"),
    btnExport: $("btn-export"),
    btnImport: $("btn-import"),
    refreshBar: $("refresh-bar"),
    btnRefresh: $("btn-refresh"),
    listWrap: $("list-wrap"),
    list: $("list"),
    empty: $("empty"),
    hint: $("hint"),
  };

  let tab = null;
  let pageUrl = null; // URL object when WebStyle can style the current tab, else null
  let sites = [];
  let justAdded = null;
  let exporting = false;
  let doneTimer = 0;
  const EXPORT_TITLE = el.btnExport.title;

  const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const plural = (n) => (n === 1 ? "1 site" : `${n} sites`);
  const currentDomain = () => (pageUrl ? SITES.normalizeHost(pageUrl.hostname) : null);

  function setHint(text, cls = "") {
    el.hint.textContent = text;
    el.hint.className = "hint" + (cls ? " " + cls : "");
    el.hint.title = "";
    el.listWrap.classList.toggle("has-hint", !!text);
  }

  // Writes in flight. While any are pending, storage-change echoes of earlier writes are stale (a quick second
  // click has already moved on) and are ignored, so checkboxes never flicker back.
  let pendingWrites = 0;

  async function save(next) {
    sites = next;
    render();
    pendingWrites++;
    try {
      await chrome.storage.local.set({ sites: next });
    } finally {
      pendingWrites--;
    }
    checkTab();
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------
  function render() {
    renderButtons();
    renderList();
  }

  function renderButtons() {
    el.count.textContent = sites.length ? plural(sites.length) : "";
    el.btnExport.disabled = exporting || sites.length === 0;

    const domain = currentDomain();
    if (!domain) {
      el.btnAdd.disabled = true;
      el.btnAddLabel.textContent = "Add this site";
      el.btnAddSub.textContent = "Not available on this page";
      return;
    }
    const exact = sites.some((e) => e.domain === domain);
    const parent = !exact && SITES.findEntry(sites, domain);
    el.btnAdd.disabled = exact;
    el.btnAddLabel.textContent = exact ? "This site is in the list" : "Add this site";
    el.btnAddSub.textContent = exact ? domain : parent ? `${domain} · now styled via ${parent.domain}` : domain;
    el.btnAddSub.title = el.btnAddSub.textContent;
  }

  function renderList() {
    const items = SITES.sorted(sites);
    el.empty.hidden = items.length > 0;
    const host = pageUrl ? pageUrl.hostname : null;
    const current = host && SITES.findEntry(sites, host);

    const frag = document.createDocumentFragment();
    for (const item of items) {
      const li = document.createElement("li");
      li.dataset.domain = item.domain;

      const info = document.createElement("div");
      info.className = "entry-info";
      const name = document.createElement("div");
      name.className = "entry-domain";
      name.textContent = item.domain;
      // Tooltip only when the name is cut off, so it never just repeats what's visible.
      name.addEventListener("mouseenter", () => {
        name.title = name.scrollWidth > name.clientWidth ? item.domain : "";
      });
      if (current === item) {
        const pill = document.createElement("span");
        pill.className = "this-site";
        pill.textContent = "This site";
        name.append(pill);
      }
      const date = document.createElement("div");
      date.className = "entry-date";
      date.textContent = item.added ? `Added ${dateFormat.format(new Date(item.added))}` : "Added on an unknown date";
      info.append(name, date);

      // Picker menu of presets. A site matching none of them (e.g. imported with nothing turned on) shows
      // a disabled "None" entry until another choice is made.
      const pick = document.createElement("select");
      pick.className = "picker";
      pick.setAttribute("aria-label", `Style for ${item.domain}`);
      const chosen = F.presetFor(item.features);
      if (!chosen) {
        pick.add(new Option("None", "", true, true));
        pick.options[0].disabled = true;
      }
      F.PRESETS.forEach((p, i) => pick.add(new Option(p.label, String(i), false, p === chosen)));
      pick.addEventListener("change", () => setPreset(item.domain, F.PRESETS[+pick.value]));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.title = `Remove ${item.domain}`;
      remove.setAttribute("aria-label", `Remove ${item.domain}`);
      remove.append(document.createElement("span"));
      remove.addEventListener("click", () => removeEntry(item.domain, li, remove));

      li.append(info, pick, remove);
      if (justAdded === item.domain) li.classList.add("added");
      frag.append(li);
    }
    justAdded = null;
    // Keep keyboard focus on the same control across re-renders.
    const focused = document.activeElement;
    const focusKey = focused && el.list.contains(focused) && [focused.closest("li").dataset.domain, focused.className];
    const scroll = el.list.scrollTop;
    el.list.replaceChildren(frag);
    el.list.scrollTop = scroll;
    if (focusKey) {
      const li = [...el.list.children].find((n) => n.dataset.domain === focusKey[0]);
      const target = li && li.querySelector(`.${focusKey[1]}`);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function showFavicon() {
    el.favicon.onload = () => {
      el.favicon.hidden = false;
      el.btnAdd.classList.add("has-favicon");
    };
    el.favicon.onerror = () => {
      el.favicon.hidden = true;
      el.btnAdd.classList.remove("has-favicon");
    };
    el.favicon.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl.href)}&size=32`);
  }

  // ---------------------------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------------------------
  el.btnAdd.addEventListener("click", async () => {
    const domain = currentDomain();
    if (!domain || sites.some((e) => e.domain === domain)) return;
    // A new subdomain entry starts from what its parent entry already applied, so adding it changes nothing
    // until you change its boxes; otherwise from each feature's default.
    const parent = SITES.findEntry(sites, domain);
    const features = parent ? F.normalize(parent.features) : F.defaults();
    justAdded = domain;
    el.list.scrollTop = 0;
    await save([...sites, { domain, added: Date.now(), features }]);
  });

  function setPreset(domain, preset) {
    save(sites.map((e) => (e.domain === domain ? { ...e, features: F.fromPreset(preset) } : e)));
  }

  async function removeEntry(domain, li, button) {
    button.disabled = true;
    li.classList.add("removing");
    await new Promise((r) => setTimeout(r, 160));
    await save(sites.filter((e) => e.domain !== domain));
  }

  el.btnExport.addEventListener("click", async () => {
    exporting = true;
    renderButtons();
    setHint("");
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "export" });
    } catch (e) {
      result = { ok: false, error: String(e.message || e) };
    }
    exporting = false;
    renderButtons();
    if (result && result.ok) {
      // Like TabBackup's toolbar icon after an export, but only the button's glyph changes, for 5 seconds.
      clearTimeout(doneTimer);
      el.btnExport.classList.add("done");
      el.btnExport.title = `Exported ${plural(result.count)} to ${result.path}`;
      doneTimer = setTimeout(() => {
        el.btnExport.classList.remove("done");
        el.btnExport.title = EXPORT_TITLE;
      }, 5000);
    } else {
      setHint(`Export failed: ${(result && result.error) || "unknown error"}`, "err");
    }
  });

  // On macOS the toolbar popover closes as soon as a file dialog opens, so (like TabBackup and Autoplay
  // Stopper) the picker lives in its own small window.
  el.btnImport.addEventListener("click", async () => {
    const url = chrome.runtime.getURL("import/import.html");
    const [existing] = await chrome.tabs.query({ url });
    if (existing) await chrome.windows.update(existing.windowId, { focused: true });
    else await chrome.windows.create({ url, type: "popup", width: 420, height: 250 });
    window.close();
  });

  // Changes normally reach open pages instantly. If this tab couldn't be updated (e.g. it's showing an error
  // page or was discarded), offer a reload instead.
  async function checkTab() {
    if (!tab || !pageUrl) return;
    let ok = true;
    try {
      ok = (await chrome.runtime.sendMessage({ type: "check-tab", tabId: tab.id })).ok;
    } catch (e) {
      ok = false;
    }
    el.refreshBar.hidden = ok;
  }

  el.btnRefresh.addEventListener("click", async () => {
    el.btnRefresh.disabled = true;
    await chrome.tabs.reload(tab.id).catch(() => {});
    el.refreshBar.hidden = true;
    el.btnRefresh.disabled = false;
  });

  // Keep in sync with changes made elsewhere (the import window, another window's popover).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sites && !pendingWrites) {
      const next = Array.isArray(changes.sites.newValue) ? changes.sites.newValue : [];
      if (JSON.stringify(next) !== JSON.stringify(sites)) {
        sites = next;
        render();
      }
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------------------------
  (async () => {
    const [[active], stored] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.storage.local.get("sites"),
    ]);
    tab = active || null;
    pageUrl = tab ? SITES.eligibleUrl(tab.url || tab.pendingUrl) : null;
    sites = Array.isArray(stored.sites) ? stored.sites : [];
    if (pageUrl) showFavicon();
    render();
    if (pageUrl && SITES.findEntry(sites, pageUrl.hostname)) checkTab();
  })();
})();
