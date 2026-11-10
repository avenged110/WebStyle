/*
 * WebStyle — service worker.
 *
 * Styling: every enabled feature of every listed site becomes a registered content-script stylesheet, so
 * Chromium injects it before the page first paints (no flash of the original fonts; this is what Stylus
 * achieves with its "instant inject" option). Changes also reach pages that are already open: features
 * being switched on are inserted with scripting.insertCSS, and features being switched off are disabled
 * through the data-webstyle-off attribute that each stylesheet's selectors check. So no reload is needed.
 */
"use strict";

importScripts("shared/features.js", "shared/sites.js", "shared/format.js");

const F = self.WS_FEATURES;
const SITES = self.WS_SITES;
const FORMAT = self.WS_FORMAT;
const PREFIX = "ws-";

async function getSites() {
  const { sites } = await chrome.storage.local.get("sites");
  return Array.isArray(sites) ? sites : [];
}

// ---------------------------------------------------------------------------------------------
// Registered stylesheets (applied to every page load from now on)
// ---------------------------------------------------------------------------------------------

/**
 * One registration per enabled (site, feature). Each excludes the listed subdomains that turn that feature
 * off, so the most specific entry always wins (a deeper subdomain that turns it back on has its own).
 * IDs are keyed by site and feature, so an edit only touches the registrations it actually changes.
 */
function desiredScripts(sites) {
  const out = [];
  for (const e of sites) {
    for (const f of F.FEATURES) {
      if (!e.features || !e.features[f.id]) continue;
      const excludeMatches = sites
        .filter((o) => o.domain !== e.domain && SITES.hostMatches(o.domain, e.domain) && !(o.features && o.features[f.id]))
        .flatMap((o) => SITES.matchPatterns(o.domain));
      out.push({
        id: `${PREFIX}${f.id}:${e.domain}`,
        matches: SITES.matchPatterns(e.domain),
        excludeMatches,
        css: [f.css],
        allFrames: true,
        matchOriginAsFallback: true,
        runAt: "document_start",
        persistAcrossSessions: true,
      });
    }
  }
  return out;
}

let queue = Promise.resolve();
/** Serializes work so overlapping storage changes can't interleave registration calls. */
const serial = (fn) => (queue = queue.then(fn).catch((e) => console.error("WebStyle:", e)));

/** The parts of a registration that matter, for comparing what's registered with what should be. */
const signature = (s) =>
  JSON.stringify([s.matches, [...(s.excludeMatches || [])].sort(), s.css, s.allFrames, s.matchOriginAsFallback]);

/**
 * Brings the registered stylesheets in line with `sites`, changing only what differs (so pages loading
 * meanwhile never see a moment with nothing registered). Chromium rejects a whole batch if any entry is
 * invalid, so a failed batch is retried one entry at a time: one bad site can't unstyle all the others.
 */
async function syncRegistrations(sites) {
  const existing = new Map(
    (await chrome.scripting.getRegisteredContentScripts())
      .filter((s) => s.id.startsWith(PREFIX))
      .map((s) => [s.id, s])
  );
  const desired = desiredScripts(sites);
  const wanted = new Set(desired.map((s) => s.id));
  const stale = [...existing.keys()].filter((id) => !wanted.has(id));
  const added = desired.filter((s) => !existing.has(s.id));
  const changed = desired.filter((s) => existing.has(s.id) && signature(existing.get(s.id)) !== signature(s));

  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  for (const [list, call] of [
    [changed, (l) => chrome.scripting.updateContentScripts(l)],
    [added, (l) => chrome.scripting.registerContentScripts(l)],
  ]) {
    if (!list.length) continue;
    try {
      await call(list);
    } catch (e) {
      for (const one of list) {
        await call([one]).catch((err) => console.error(`WebStyle: couldn't register ${one.id}:`, err));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Live update of open pages
// ---------------------------------------------------------------------------------------------

/**
 * Runs in each frame. Decides which features apply to this frame's host (most specific entry wins) and sets
 * data-webstyle-off for the rest. Frames on hosts that neither the old nor the new list covers are left
 * untouched. Returns the features to insert, or null. Must be self-contained (it is serialized).
 */
function applyInFrame(sites, ids, prevDomains) {
  const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const norm = (h) => {
    h = String(h || "").toLowerCase().replace(/\.+$/, "");
    return h.startsWith("www.") && h.length > 4 ? h.slice(4) : h;
  };
  const covers = (h, d) => h === d || (h.endsWith("." + d) && !IPV4.test(h) && !h.startsWith("["));
  let host = location.hostname;
  if (!host) {
    try {
      host = new URL(self.origin).hostname; // about:blank / srcdoc frames inherit their creator's origin
    } catch (e) {}
  }
  host = norm(host);
  if (!host) return null;
  let entry = null;
  for (const e of sites) if (covers(host, e.domain) && (!entry || e.domain.length > entry.domain.length)) entry = e;
  const root = document.documentElement;
  if (!entry && !prevDomains.some((d) => covers(host, d)) && !(root && root.hasAttribute("data-webstyle-off"))) return null;
  const on = ids.filter((id) => entry && entry.features && entry.features[id]);
  const off = ids.filter((id) => !on.includes(id));
  if (root) {
    if (off.length) root.setAttribute("data-webstyle-off", off.join(" "));
    else root.removeAttribute("data-webstyle-off");
  }
  return on;
}

/** Brings one tab's frames in line with `sites`. Resolves true if the tab could be updated. */
async function applyToTab(tab, sites, prevDomains) {
  if (tab.discarded || !SITES.eligibleUrl(tab.url)) return false;
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: applyInFrame,
      args: [sites.map((e) => ({ domain: e.domain, features: e.features })), F.IDS, prevDomains],
      injectImmediately: true,
    });
  } catch (e) {
    return false;
  }
  await Promise.all(
    results.flatMap((r) =>
      (r.result || []).map(async (id) => {
        const target = { tabId: tab.id, frameIds: [r.frameId] };
        const files = [F.byId(id).css];
        // removeCSS first so repeated toggles don't stack copies of the same sheet.
        await chrome.scripting.removeCSS({ target, files }).catch(() => {});
        await chrome.scripting.insertCSS({ target, files }).catch(() => {});
      })
    )
  );
  return results.some((r) => r.frameId === 0);
}

/**
 * Updates only tabs whose own (top-level) site is, or just was, in the list; every other tab is left
 * completely alone. A listed site embedded in an unlisted page picks up changes on its next load instead.
 */
async function applyToAllTabs(sites, prevDomains) {
  const domains = [...new Set([...sites.map((e) => e.domain), ...prevDomains])];
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  const relevant = tabs.filter((t) => {
    const u = SITES.eligibleUrl(t.url);
    return u && domains.some((d) => SITES.hostMatches(u.hostname, d));
  });
  await Promise.all(relevant.map((t) => applyToTab(t, sites, prevDomains)));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.sites) return;
  const sites = Array.isArray(changes.sites.newValue) ? changes.sites.newValue : [];
  const prev = Array.isArray(changes.sites.oldValue) ? changes.sites.oldValue : [];
  serial(async () => {
    await syncRegistrations(sites);
    await applyToAllTabs(sites, prev.map((e) => e.domain));
  });
});

chrome.runtime.onInstalled.addListener(() =>
  serial(async () => {
    const sites = await getSites();
    await syncRegistrations(sites);
    await applyToAllTabs(sites, []); // style pages that were open before WebStyle was installed or updated
  })
);
chrome.runtime.onStartup.addListener(() => serial(async () => syncRegistrations(await getSites())));

// ---------------------------------------------------------------------------------------------
// Export (saved straight to the default download folder, like TabBackup and Autoplay Stopper)
// ---------------------------------------------------------------------------------------------

/** Resolves with the final file path once the download completes; rejects if it's interrupted. */
function download(filename, text) {
  return new Promise((resolve, reject) => {
    let id = null;
    const pending = [];
    const settle = (item) => {
      if (item.state === "complete") {
        chrome.downloads.onChanged.removeListener(onChanged);
        chrome.downloads.search({ id }).then(([d]) => resolve(d ? d.filename : filename));
      } else if (item.state === "interrupted") {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error(`Download interrupted (${item.error || "unknown"})`));
      }
    };
    const onChanged = (delta) => {
      const item = { state: delta.state && delta.state.current, error: delta.error && delta.error.current };
      if (id === null) pending.push([delta.id, item]);
      else if (delta.id === id) settle(item);
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads
      .download({
        url: "data:text/plain;charset=utf-8," + encodeURIComponent(text),
        filename,
        conflictAction: "uniquify",
        saveAs: false,
      })
      .then(async (newId) => {
        id = newId;
        for (const [pid, item] of pending) if (pid === id) settle(item);
        const [d] = await chrome.downloads.search({ id });
        if (d) settle(d);
      })
      .catch((e) => {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(e);
      });
  });
}

async function exportSettings() {
  const now = new Date();
  try {
    const sites = await getSites();
    if (!sites.length) throw new Error("There's nothing to export yet.");
    const path = await download(`WebStyle Settings ${FORMAT.stamp(now)}.txt`, FORMAT.buildText(sites, now));
    return { ok: true, path, count: sites.length };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  if (msg.type === "export") {
    exportSettings().then(reply);
    return true;
  }
  if (msg.type === "check-tab") {
    // The popover asks whether its tab took the latest change live; if not, it offers a Refresh button.
    serial(async () => {
      let ok = false;
      try {
        const tab = await chrome.tabs.get(msg.tabId);
        ok = await applyToTab(tab, await getSites(), []);
      } finally {
        reply({ ok });
      }
    });
    return true;
  }
  if (msg.type === "show-popup") {
    // Sent by the import window as it closes, so you land back on the popover.
    setTimeout(() => chrome.action.openPopup().catch(() => {}), 300);
  }
});
