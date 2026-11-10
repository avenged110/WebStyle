#!/usr/bin/env python3
"""WebStyle end-to-end tests (stdlib only; drives /Applications/Chromium.app headless over DevTools).

Usage: python3 run_tests.py <extension dir> <test-site dir> [<Stylus Backup.json>]
"""
import functools
import http.server
import json
import os
import sys
import threading
import time

from cdp import Browser

EXT, SITE = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
STYLUS = sys.argv[3] if len(sys.argv) > 3 else None

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


handler = functools.partial(Quiet, directory=SITE)
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {detail}")


def wait(fn, timeout=5):
    end = time.time() + timeout
    while True:
        v = fn()
        if v or time.time() > end:
            return v
        time.sleep(0.1)


b = Browser(EXT)
w = b.worker()


def set_sites(sites):
    w.eval(f"chrome.storage.local.set({{sites: {json.dumps(sites)}}})")
    time.sleep(0.8)  # let the worker re-register and update open tabs


def site(domain, bold=False, helvetica=False, added=1700000000000):
    return {"domain": domain, "added": added, "features": {"bold": bold, "helvetica": helvetica}}


def open_tab(url):
    w.eval(f"chrome.tabs.create({{url: {json.dumps(url)}}}).then(() => 0)")
    p = b.page(url.split("//", 1)[1].split("/", 1)[1] and url or url)
    wait(lambda: p.eval("document.readyState") == "complete")
    time.sleep(0.3)
    return p


STYLE_JS = """(() => {
  const s = (el) => { const c = getComputedStyle(el); return [c.fontFamily, c.fontWeight]; };
  const f = document.getElementById('same');
  return { p: s(document.getElementById('p')), icon: s(document.getElementById('icon')),
           srcdoc: s(f.contentDocument.getElementById('p')),
           off: document.documentElement.getAttribute('data-webstyle-off') };
})()"""


def styles(p):
    return p.eval(STYLE_JS)


def xo_frame_style():
    t = b._find(lambda t: t["type"] == "iframe" and "other.test" in t["url"], 5)
    v = t.eval("(() => { const c = getComputedStyle(document.getElementById('p')); return [c.fontFamily, c.fontWeight]; })()")
    t.close()
    return v


HELV = "Helvetica, sans-serif"
GEORGIA = "Georgia, serif"

try:
    # ------------------------------------------------------------------ format / parser unit tests
    print("Format")
    r = w.eval("""(() => {
      const s = [{domain:'ebay.com',added:Date.now()-1000,features:{bold:true,helvetica:true}},
                 {domain:'imdb.com',added:Date.now(),features:{bold:false,helvetica:true}},
                 {domain:'x.org',added:Date.now()-5000,features:{bold:false,helvetica:false}}];
      const t = WS_FORMAT.buildText(s);
      const back = WS_FORMAT.parseText(t);
      const errs = [];
      for (const bad of ['hello', t.replace('WebStyle Settings','X'), t.replace('imdb.com','imdb..com'),
                         t.replace('helvetica    added','comic    added'), t.replace(/added \\d{4}-\\d\\d-\\d\\d/, 'added 2026-02-31')]) {
        try { WS_FORMAT.parseText(bad); errs.push(null) } catch (e) { errs.push(e.message) }
      }
      const round = s.every(e => { const o = back.find(x => x.domain === e.domain);
        return o && Math.floor(o.added/1000) === Math.floor(e.added/1000) && JSON.stringify(o.features) === JSON.stringify(e.features); });
      return {t, round, n: back.length, errs};
    })()""")
    print("    " + r["t"].replace("\n", "\n    "))
    check("export round-trips sites, dates and features", r["round"] and r["n"] == 3)
    check("malformed files are rejected with messages", all(r["errs"]), r["errs"])

    r = w.eval("""(() => { const t = WS_FORMAT.buildText([{domain:'my_site.example.com',added:1,features:{bold:true,helvetica:false}}]);
      try { return WS_FORMAT.parseText(t)[0].domain } catch (e) { return e.message } })()""")
    check("hostnames with underscores survive export/import", r == "my_site.example.com", r)

    if STYLUS:
        text = open(STYLUS, encoding="utf-8").read()
        w.eval("chrome.tabs.create({url: chrome.runtime.getURL('import/import.html')}).then(() => 0)")
        ip = b.page("/import/import.html")
        wait(lambda: ip.eval("typeof WS_STYLUS !== 'undefined'"))
        sty = ip.eval(f"WS_STYLUS.parse({json.dumps(text)})")
        ip.eval("window.close()")
        on = lambda f: sorted(e["domain"] for e in sty if e["features"][f])
        print("    stylus helvetica:", on("helvetica"))
        print("    stylus bold:     ", on("bold"))
        check("Stylus backup: 9 Helvetica sites", len(on("helvetica")) == 9)
        check("Stylus backup: bold on imdb/bestbuy/ebay/youtube", on("bold") == ["bestbuy.com", "ebay.com", "imdb.com", "youtube.com"])

    # ------------------------------------------------------------------ styling
    print("Styling")
    A = f"http://site-a.test:{PORT}/index.html"
    p = open_tab(A)
    s = styles(p)
    check("unlisted site is untouched", s["p"] == [GEORGIA, "300"], s)

    set_sites([site("site-a.test", helvetica=True)])
    s = styles(p)
    check("live: Helvetica applied without reload", s["p"] == [HELV, "300"], s)
    check("live: srcdoc frame styled", s["srcdoc"][0] == HELV, s)
    check("icon fonts are left alone", "Material Icons" in s["icon"][0], s)
    check("cross-origin frame on an unlisted site untouched", xo_frame_style()[0] == GEORGIA)

    p.eval("location.reload()"); time.sleep(1)
    s = styles(p)
    check("after reload: registered stylesheet applies", s["p"] == [HELV, "300"] and s["off"] is None, s)
    regs = w.eval("chrome.scripting.getRegisteredContentScripts().then(r => r.map(x => x.id))")
    check("one registration per enabled feature", regs == ["ws-helvetica:site-a.test"], regs)

    set_sites([site("site-a.test", bold=True, helvetica=True)])
    check("live: bold switched on", styles(p)["p"] == [HELV, "700"])
    set_sites([site("site-a.test", bold=True, helvetica=False)])
    s = styles(p)
    check("live: Helvetica switched off (bold stays)", s["p"] == [GEORGIA, "700"], s)
    p.eval("location.reload()"); time.sleep(1)
    check("after reload: only bold", styles(p)["p"] == [GEORGIA, "700"])

    # Re-syncing an unchanged list must not touch any registration.
    calls = w.eval("""(async () => { const n = {u:0, r:0, x:0}; const S = chrome.scripting;
      const o = [S.updateContentScripts, S.registerContentScripts, S.unregisterContentScripts];
      S.updateContentScripts = (...a) => (n.u++, o[0].apply(S, a)); S.registerContentScripts = (...a) => (n.r++, o[1].apply(S, a));
      S.unregisterContentScripts = (...a) => (n.x++, o[2].apply(S, a));
      await syncRegistrations((await chrome.storage.local.get('sites')).sites);
      [S.updateContentScripts, S.registerContentScripts, S.unregisterContentScripts] = o; return n; })()""")
    check("unchanged list: no registration churn", calls == {"u": 0, "r": 0, "x": 0}, calls)

    # A corrupt entry (invalid match pattern) must not take the valid sites down with it.
    set_sites([site("*", bold=True), site("site-a.test", bold=True, helvetica=True)])
    regs = sorted(w.eval("chrome.scripting.getRegisteredContentScripts().then(r => r.map(x => x.id))"))
    check("one invalid entry doesn't block the others", regs == ["ws-bold:site-a.test", "ws-helvetica:site-a.test"], regs)

    # most specific entry wins
    set_sites([site("site-a.test", bold=True, helvetica=True), site("sub.site-a.test", helvetica=True),
               site("deep.sub.site-a.test", bold=True)])
    sub = open_tab(f"http://sub.site-a.test:{PORT}/index.html")
    deep = open_tab(f"http://deep.sub.site-a.test:{PORT}/index.html")
    www = open_tab(f"http://www.site-a.test:{PORT}/index.html")
    check("subdomain entry overrides parent (registered)", styles(sub)["p"] == [HELV, "300"], styles(sub))
    check("deeper entry overrides again", styles(deep)["p"] == [GEORGIA, "700"], styles(deep))
    check("www. and parent still get both", styles(www)["p"] == [HELV, "700"] and styles(p)["p"] == [HELV, "700"])

    set_sites([site("site-a.test", bold=True, helvetica=True), site("other.test", helvetica=True)])
    check("live: removed subdomain entry falls back to parent", styles(sub)["p"] == [HELV, "700"], styles(sub))
    check("live: listed site embedded in a listed page is updated", xo_frame_style() == [HELV, "300"], xo_frame_style())
    unl = open_tab(f"http://unlisted.test:{PORT}/index.html")
    unl_id = w.eval("chrome.tabs.query({url: '*://unlisted.test/*'}).then(([t]) => t.id)")
    touched = w.eval("""(async () => { const S = chrome.scripting, o = S.executeScript, ids = [];
      S.executeScript = (a) => (ids.push(a.target.tabId), o.call(S, a));
      await chrome.storage.local.set({sites: (await chrome.storage.local.get('sites')).sites.map(e => ({...e, added: e.added + 1}))});
      await new Promise(r => setTimeout(r, 800)); S.executeScript = o; return ids; })()""")
    check("live updates skip tabs on unlisted sites", unl_id not in touched and len(touched) > 0, touched)
    unl.eval("window.close()")

    set_sites([])
    check("live: removing the site restores the page", styles(p)["p"] == [GEORGIA, "300"], styles(p))
    p.eval("location.reload()"); time.sleep(1)
    check("after reload: unstyled, nothing registered",
          styles(p)["p"] == [GEORGIA, "300"] and w.eval("chrome.scripting.getRegisteredContentScripts().then(r => r.length)") == 0)
    for t in (sub, deep, www):
        t.eval("window.close()")

    # ------------------------------------------------------------------ popover
    print("Popover")
    w.eval("chrome.tabs.query({url: '*://site-a.test/*'}).then(([t]) => chrome.tabs.update(t.id, {active: true}).then(() => chrome.windows.update(t.windowId, {focused: true})))")
    w.eval("chrome.action.openPopup().then(() => 0)")
    pop = b.page("/popup/popup.html")
    wait(lambda: pop.eval("document.getElementById('btn-add-sub').textContent.trim().length > 0"))
    st = lambda: pop.eval("""({add: document.getElementById('btn-add').disabled, label: document.getElementById('btn-add-label').textContent,
      sub: document.getElementById('btn-add-sub').textContent, exp: document.getElementById('btn-export').disabled,
      imp: document.getElementById('btn-import').disabled, empty: !document.getElementById('empty').hidden,
      rows: [...document.querySelectorAll('#list li')].map(li => { const p = li.querySelector('select.picker');
        return [li.dataset.domain, p.selectedOptions[0].text, [...p.options].map(o => o.text + (o.disabled ? '(off)' : '')).join(',')]; }),
      count: document.getElementById('count').textContent, refresh: !document.getElementById('refresh-bar').hidden})""")
    s0 = st()
    check("empty: Add enabled for this site, Export disabled, Import enabled",
          not s0["add"] and s0["sub"] == "site-a.test" and s0["exp"] and not s0["imp"] and s0["empty"], s0)
    pop.eval("document.getElementById('btn-add').click()"); time.sleep(0.8)
    s1 = st()
    check("added: row with picker set to Helvetica", s1["rows"] == [["site-a.test", "Helvetica", "Both,Helvetica,Bold"]], s1)
    check("added: Add disabled, Export enabled", s1["add"] and not s1["exp"] and s1["label"] == "This site is in the list", s1)
    check("added: page styled live", styles(p)["p"] == [HELV, "300"])
    check("no refresh needed", not s1["refresh"])
    def choose(label):
        pop.eval(f"""(() => {{ const p = document.querySelector('#list li select.picker');
          p.value = [...p.options].find(o => o.text === {json.dumps(label)}).value; p.dispatchEvent(new Event('change')); }})()""")
        time.sleep(0.8)
    choose("Both")
    check("picker: Both saves and applies", w.eval("chrome.storage.local.get('sites').then(s => s.sites[0].features)") == {"bold": True, "helvetica": True} and styles(p)["p"] == [HELV, "700"])
    choose("Bold")
    check("picker: Bold alone", styles(p)["p"] == [GEORGIA, "700"] and st()["rows"][0][1] == "Bold")

    pop.eval("document.getElementById('btn-export').click()")
    glyph = lambda: pop.eval("""(() => { const b = document.getElementById('btn-export');
      return [b.classList.contains('done'), getComputedStyle(b.querySelector('.done-glyph')).display, getComputedStyle(b.querySelector('.glyph')).display]; })()""")
    done = wait(lambda: glyph()[0])
    files = os.listdir(b.downloads)
    check("export writes a .txt to Downloads", len(files) == 1 and files[0].startswith("WebStyle Settings "), files)
    check("export: green check replaces the glyph", glyph() == [True, "block", "none"], glyph())
    check("export: no hint text on success", pop.eval("document.getElementById('hint').textContent") == "")
    time.sleep(5.2)
    check("export: glyph restored after 5 seconds", glyph() == [False, "none", "block"], glyph())
    exported = open(os.path.join(b.downloads, files[0]), encoding="utf-8").read() if files else ""
    check("exported file content", "site-a.test    bold    added" in exported, exported)

    pop.eval("document.querySelector('#list li .remove').click()"); time.sleep(0.8)
    s2 = st()
    check("removed: empty list, Add enabled again, Export disabled", s2["empty"] and not s2["add"] and s2["exp"] and s2["rows"] == [], s2)
    check("removed: page restored live", styles(p)["p"] == [GEORGIA, "300"])
    set_sites([site("site-a.test")]); time.sleep(0.3)
    check("picker: a site with nothing on shows a disabled None", st()["rows"] == [["site-a.test", "None", "None(off),Both,Helvetica,Bold"]], st()["rows"])
    pop.close()

    # ------------------------------------------------------------------ import (merge)
    print("Import")
    set_sites([site("keep.test", bold=True), site("site-a.test", bold=True, helvetica=True)])
    src = os.path.join(b.dir, "import.txt")
    with open(src, "w") as f:
        f.write(exported.replace("site-a.test    bold", "site-a.test    helvetica").rstrip("\n") + "\nnew.test    bold helvetica\n")
    w.eval(f"chrome.tabs.create({{url: chrome.runtime.getURL('import/import.html')}}).then(() => 0)")
    imp = b.page("/import/import.html")
    wait(lambda: imp.eval("document.readyState") == "complete"); time.sleep(0.5)
    imp.call("Page.enable")
    imp.call("Page.setInterceptFileChooserDialog", {"enabled": True})
    imp.eval("delete window.showOpenFilePicker; 0")
    # A real (trusted) click, so the page gets user activation and its file input can open.
    box = imp.eval("(() => { const r = document.getElementById('choose').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
    for t in ("mousePressed", "mouseReleased"):
        imp.call("Input.dispatchMouseEvent", {"type": t, "x": box[0], "y": box[1], "button": "left", "clickCount": 1})
    time.sleep(0.5)
    node = imp.call("DOM.querySelector", {"nodeId": imp.call("DOM.getDocument")["root"]["nodeId"], "selector": "#file"})["nodeId"]
    imp.call("DOM.setFileInputFiles", {"nodeId": node, "files": [src]})
    msg = wait(lambda: imp.eval("document.getElementById('msg').textContent"))
    print("    " + msg)
    got = {e["domain"]: e for e in w.eval("chrome.storage.local.get('sites').then(s => s.sites)")}
    check("import merges: kept, updated, added",
          set(got) == {"keep.test", "site-a.test", "new.test"} and got["site-a.test"]["features"] == {"bold": False, "helvetica": True}
          and got["keep.test"]["features"]["bold"] and got["new.test"]["features"] == {"bold": True, "helvetica": True}, got)
    check("import message counts", "1 new, 1 updated" in msg, msg)
    time.sleep(0.5)
    check("imported settings applied live", styles(p)["p"] == [HELV, "300"], styles(p))
finally:
    print(f"\n{passed} passed, {failed} failed")
    b.close()
    server.shutdown()
sys.exit(1 if failed else 0)
