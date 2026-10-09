import test from "node:test";
import assert from "node:assert/strict";
import { bigSurWithoutChrome, classifyWaError, waSessionDir } from "../src/lib/waSupport.js";

const linux = { platform: "linux", osRelease: "6.8.0" }, bigSur = { platform: "darwin", osRelease: "20.6.0" }, monterey = { platform: "darwin", osRelease: "21.6.0" };

test("every institution (and the platform) gets its own session folder / Chrome profile", () => {
  const ids = ["9f2df396-dd42-45ac-9891-7908cb9d960e", "11111111-2222-3333-4444-555555555555", "platform"];
  const dirs = ids.map((i) => waSessionDir("/var/lib/enrolla/wa", i));
  assert.equal(new Set(dirs).size, 3);
  assert.ok(dirs.every((d) => d.startsWith("/var/lib/enrolla/wa/session-")));
  for (const bad of ["../x", "a/b", "", "x".repeat(65), "a b"]) assert.throws(() => waSessionDir("/d", bad), /invalid session key/); // no path tricks
});

test("macOS 11 without a configured Chrome is detected up front; with one it is allowed", () => {
  assert.equal(bigSurWithoutChrome(bigSur, undefined), true);
  assert.equal(bigSurWithoutChrome(bigSur, "/x/chrome"), false);
  assert.equal(bigSurWithoutChrome(monterey, undefined), false);
  assert.equal(bigSurWithoutChrome(linux, undefined), false);
});

test("launch failures are explained: network, missing Chrome, Big Sur incompatibility, missing Linux libraries", () => {
  assert.match(classifyWaError("net::ERR_TUNNEL_CONNECTION_FAILED at https://web.whatsapp.com/", linux), /^wa_err:network:/);
  assert.match(classifyWaError("Could not find Chrome (ver. 146.0.1)", linux), /^wa_err:no_chrome:/);
  assert.match(classifyWaError("Browser was not found at the configured executablePath (/x): ENOENT", linux), /^wa_err:no_chrome:/);
  assert.match(classifyWaError("Failed to launch the browser process! dyld: Symbol not found: _SecTrustCopyCertificateChain", bigSur), /^wa_err:mac11:/);
  assert.match(classifyWaError("Failed to launch the browser process! error while loading shared libraries: libnss3.so", linux), /^wa_err:chrome_start:/);
  assert.equal(classifyWaError("something unexpected", linux), "something unexpected");
});
