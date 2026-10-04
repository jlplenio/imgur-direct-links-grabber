import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const delay = ms => new Promise(done => setTimeout(done, ms));

/** Isolated browser session. CORS and web security retain browser defaults. */
export async function withBrowser(work) {
  const profile = mkdtempSync(join(tmpdir(), 'imgur-app-check-'));
  const child = spawn(process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  child.on('error', error => { launchError = error; });
  let socket;
  const pending = new Map();
  try {
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      try {
        const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page');
        if (target) break;
      } catch { /* The isolated browser may still be starting. */ }
      await delay(100);
    }
    assert.ok(target, 'Chrome must expose its isolated CDP page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      socket.addEventListener('open', done, { once: true });
      socket.addEventListener('error', fail, { once: true });
    });
    let serial = 0;
    const listeners = [];
    const send = (method, params = {}) => new Promise((done, fail) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(id, { done: value => { clearTimeout(timer); done(value); }, fail: error => { clearTimeout(timer); fail(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.fail(new Error(message.error.message));
        else request.done(message.result);
        return;
      }
      for (const listener of listeners) listener(message);
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async (expression, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      do {
        if (await evaluate(`Boolean(${expression})`)) return;
        await delay(100);
      } while (Date.now() < deadline);
      throw new Error(`Timed out waiting for: ${expression}`);
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await work({ send, evaluate, wait, onEvent: listener => listeners.push(listener) });
    await send('Browser.close').catch(() => {});
  } finally {
    for (const request of pending.values()) request.fail(new Error('Browser session closed'));
    pending.clear();
    socket?.close();
    child.kill();
    await delay(300);
    const target = resolve(profile);
    // Only the exact temporary directory created by this session may be removed.
    if (dirname(target) === resolve(tmpdir()) && basename(target).startsWith('imgur-app-check-')) {
      try { rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
      catch { /* Firefox/Chrome cleanup can briefly retain Windows file handles. */ }
    }
  }
}
