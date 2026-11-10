# cdp.py — adapted from TabBackup's test harness.
"""Minimal Chrome DevTools Protocol client and throwaway-Chromium launcher (stdlib only)."""
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request

CHROMIUM = "/Applications/Chromium.app/Contents/MacOS/Chromium"


class Target:
    """A WebSocket connection to one DevTools target (a page or the service worker)."""

    def __init__(self, ws_url):
        hostport, path = ws_url[len("ws://"):].split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
             f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(1)
        self.next_id = 0

    def _send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else
                                bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else
                                bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n):
        out = b""
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise ConnectionError("DevTools connection closed")
            out += chunk
        return out

    def _recv(self):
        _, b = self._read(2)
        n = b & 127
        if n == 126:
            n = struct.unpack(">H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._read(8))[0]
        return json.loads(self._read(n))

    def call(self, method, params=None):
        self.next_id += 1
        self._send({"id": self.next_id, "method": method, "params": params or {}})
        while True:
            msg = self._recv()
            if msg.get("id") == self.next_id:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg["result"]

    def eval(self, expression):
        """Evaluates JavaScript (awaiting promises) and returns its JSON value; raises on exceptions."""
        r = self.call("Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description") or r["exceptionDetails"])
        return r["result"].get("value")

    def close(self):
        self.sock.close()


class Browser:
    """Launches Chromium with a throwaway profile and the extension loaded; downloads stay in the profile."""

    def __init__(self, ext):
        # A fresh port per run, so a previous browser that's still shutting down can't answer.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.ext = ext
        self.dir = tempfile.mkdtemp(prefix="webstyle-test-")
        self.downloads = os.path.join(self.dir, "Downloads")
        os.makedirs(os.path.join(self.dir, "profile", "Default"))
        os.makedirs(self.downloads)
        with open(os.path.join(self.dir, "profile", "Default", "Preferences"), "w") as f:
            json.dump({"download": {"default_directory": self.downloads, "prompt_for_download": False}}, f)
        self.start()

    def start(self, *urls):
        self.proc = subprocess.Popen(
            [CHROMIUM, f"--user-data-dir={self.dir}/profile", "--no-first-run", "--no-default-browser-check",
             "--headless=new", f"--remote-debugging-port={self.port}", f"--load-extension={self.ext}",
             f"--disable-extensions-except={self.ext}", "--hide-crash-restore-bubble", "--host-resolver-rules=MAP *.test 127.0.0.1", *(urls or ["about:blank"])],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.worker()  # wait for the extension to come up

    def kill(self, hard=False):
        (self.proc.kill if hard else self.proc.terminate)()
        self.proc.wait()

    def targets(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list", timeout=5) as r:
            return json.loads(r.read())

    def _find(self, match, timeout):
        end = time.time() + timeout
        while time.time() < end:
            try:
                for t in self.targets():
                    if match(t):
                        return Target(t["webSocketDebuggerUrl"])
            except OSError:
                pass
            time.sleep(0.2)
        raise TimeoutError("DevTools target not found")

    def worker(self, timeout=20):
        return self._find(lambda t: t["type"] == "service_worker" and t["url"].endswith("/background.js"), timeout)

    def page(self, suffix, timeout=10):
        return self._find(lambda t: t["type"] == "page" and t["url"].endswith(suffix), timeout)

    def close(self):
        self.kill()
        shutil.rmtree(self.dir, ignore_errors=True)
