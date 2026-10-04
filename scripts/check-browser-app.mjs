// Run with Node 22 after building and serving the static export on port 3041.
// BROWSER_APP_URL and BROWSER_PATH may override the local target and Chrome binary.
// Live checks use public Imgur examples. Only the optional 1,000-item fixture
// intercepts a response, specifically external /a/Test1000/embed HTML.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { delay, withBrowser } from './browser-harness.mjs';

const target = process.env.BROWSER_APP_URL || 'http://127.0.0.1:3041/';
const outputDirectory = resolve(import.meta.dirname, '../design-drafts');
mkdirSync(outputDirectory, { recursive: true });
const report = {
  startedAt: new Date().toISOString(), target, corsDisabled: false, apiCredentialsUsed: false,
  clipboard: 'Isolated page stub; system clipboard is never read or written',
  checks: [], requests: [], runtimeErrors: [], screenshots: [],
};
let phase = 'live';
const check = (name, passed, details = {}) => {
  report.checks.push({ name, phase, passed: Boolean(passed), details });
  console.log(`${passed ? 'PASS' : 'FAIL'} [${phase}] ${name}: ${JSON.stringify(details)}`);
};
const step = async (name, work) => {
  try { await work(); }
  catch (error) { check(name, false, { error: error.message }); }
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const thumbnailSelector = 'section[aria-labelledby="draft-gallery-title"] button[aria-label^="Open "]';

try {
  await withBrowser(async ({ send, evaluate, wait, onEvent }) => {
    onEvent(message => {
      if (message.method === 'Network.requestWillBeSent') {
        const { url, method } = message.params.request;
        report.requests.push({ url, method, phase });
      }
      if (message.method === 'Runtime.exceptionThrown') report.runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__appCheckClipboard = '';
      window.__appCheckClipboardFail = false;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async text => { if (window.__appCheckClipboardFail) throw new Error('Controlled clipboard denial'); window.__appCheckClipboard = text; },
        readText: async () => window.__appCheckClipboard,
      }});
      window.__appCheckZipBlobs = [];
      window.__appCheckDownloads = [];
      const createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = createObjectURL(blob); window.__appCheckZipBlobs.push({ blob, url }); return url; };
      const anchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download.endsWith('.zip')) { window.__appCheckDownloads.push({ name: this.download, url: this.href }); return; }
        return anchorClick.call(this);
      };
    ` });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: target });
    await wait(`document.getElementById('draft-url')`);
    report.browser = await evaluate('navigator.userAgent');
    const output = () => evaluate(`document.getElementById('draft-output')?.value ?? ''`);
    check('Initial tool view keeps result controls hidden', await evaluate(`!document.getElementById('draft-output') && !document.querySelector('[aria-label="Link format"]') && ![...document.querySelectorAll('button')].some(button => /^(Copy links|Copied!|Shuffle|Download ZIP)$/.test(button.textContent.trim()))`));
    const clickText = async (text, exact = true) => {
      await evaluate(`(() => { const text = ${JSON.stringify(text)}; const button = [...document.querySelectorAll('button')].find(button => ${exact ? "button.textContent.trim() === text" : "button.textContent.trim().startsWith(text)"}); if (!button) throw new Error('Button not found: ' + text); if (button.disabled) throw new Error('Button disabled: ' + text); button.click(); })()`);
      await delay(50);
    };
    const selectFormat = async value => {
      await evaluate(`(() => {
        const value = ${JSON.stringify(value)};
        const select = document.querySelector('select[aria-label="Link format"]');
        if (select) {
          if (select.disabled) throw new Error('Format select is disabled');
          if (![...select.options].some(option => option.value === value)) throw new Error('Format option not found: ' + value);
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        const labels = { plain: 'Plain URLs', bbcode: 'BBCode', html: 'HTML', markdown: 'Markdown' };
        const button = [...document.querySelectorAll('[aria-label="Link format"] button')].find(button => button.textContent.trim() === labels[value]);
        if (!button) {
          if (!document.getElementById('draft-output') && !document.querySelector('[aria-label="Link format"]')) return;
          throw new Error('Format button not found: ' + value);
        }
        if (button.disabled) throw new Error('Format button is disabled: ' + value);
        button.click();
      })()`);
      await delay(50);
    };
    const setInput = async url => {
      await evaluate(`(() => { const input = document.getElementById('draft-url'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    };
    const startLookup = async url => {
      await setInput(url);
      await evaluate(`document.getElementById('draft-url').closest('form').requestSubmit()`);
    };
    const submit = async (url, count) => {
      await startLookup(url);
      await wait(`!document.getElementById('draft-url').closest('form').querySelector('button[type="submit"]').disabled && (document.getElementById('draft-error') || (document.getElementById('draft-output')?.value ?? '').trim().split('\\n').filter(Boolean).length === ${count})`, 22000);
      const error = await evaluate(`document.getElementById('draft-error')?.textContent || null`);
      assert.equal(error, null, error || 'Lookup should succeed');
      if (count > 0) await selectFormat('plain');
      const lines = (await output()).trim().split('\n').filter(Boolean);
      assert.equal(lines.length, count);
      return lines;
    };
    const screenshot = async name => {
      // Radix dialog enter/exit transitions must finish before saving evidence.
      await delay(350);
      const filename = `local-client-${name}.png`;
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outputDirectory, filename), Buffer.from(data, 'base64'));
      report.screenshots.push(filename);
    };
    const closeDialog = async () => {
      if (!await evaluate(`Boolean(document.querySelector('[role="dialog"]'))`)) return;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await wait(`!document.querySelector('[role="dialog"]')`);
    };
    const openItem = async index => {
      await evaluate(`(() => { const button = document.querySelectorAll(${JSON.stringify(thumbnailSelector)})[${index}]; if (!button) throw new Error('Thumbnail not found'); button.scrollIntoView({ block: 'center' }); button.click(); })()`);
      await wait(`document.querySelector('[role="dialog"]')`);
      await delay(350);
    };

    let mixed = [];
    await step('Live mixed album loads', async () => {
      mixed = await submit('https://imgur.com/a/ypaFujs', 11);
      const counts = mixed.reduce((result, url) => { const ext = new URL(url).pathname.split('.').at(-1); result[ext] = (result[ext] || 0) + 1; return result; }, {});
      const thumbs = await evaluate(`document.querySelectorAll(${JSON.stringify(thumbnailSelector)}).length`);
      check('Live mixed album contains 8 GIFs, 2 MP4s, 1 photo and 11 previews', counts.gif === 8 && counts.mp4 === 2 && (counts.jpg || counts.jpeg) === 1 && thumbs === 11, { counts, thumbs });
      await evaluate('window.scrollTo(0, 0)');
      const visibleImages = `(() => [...document.querySelectorAll(${JSON.stringify(`${thumbnailSelector} img`)})].filter(image => { const rect = image.getBoundingClientRect(); const grid = image.closest('button').parentElement.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.bottom > Math.max(0, grid.top) && rect.top < Math.min(innerHeight, grid.bottom) && rect.right > Math.max(0, grid.left) && rect.left < Math.min(innerWidth, grid.right); }))()`;
      await wait(`${visibleImages}.length > 0 && ${visibleImages}.every(image => image.complete && image.naturalWidth > 0)`, 20000);
      const loadedPreviews = await evaluate(`${visibleImages}.map(image => ({ src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight }))`);
      check('Visible mixed-album thumbnails finish loading', loadedPreviews.length > 0 && loadedPreviews.every(image => image.width > 0), { previews: loadedPreviews });
      await screenshot('mixed');
    });

    await step('Formatting and clipboard', async () => {
      assert.equal(mixed.length, 11, 'Mixed album is required');
      for (const [label, value, imagePattern, videoPattern] of [
        ['BBCode', 'bbcode', /^\[IMG\]/, /^\[URL\]/],
        ['HTML', 'html', /^<img /, /^<video /],
        ['Markdown', 'markdown', /^!\[image\]/, /^\[video\]/],
      ]) {
        await selectFormat(value);
        const lines = (await output()).split('\n');
        check(`${label} formats images and videos correctly`, lines.filter(line => imagePattern.test(line)).length === 9 && lines.filter(line => videoPattern.test(line)).length === 2);
      }
      await selectFormat('plain');
      check('Plain URLs restores original media links', JSON.stringify((await output()).split('\n')) === JSON.stringify(mixed));
      await clickText('Copy links');
      check('Copy writes exact output to isolated clipboard stub', await evaluate(`Boolean(document.getElementById('draft-output')) && window.__appCheckClipboard === document.getElementById('draft-output').value`));
      await evaluate('window.__appCheckClipboardFail = true');
      await clickText('Copied!');
      check('Clipboard denial selects output for manual copy', await evaluate(`(() => { const field = document.getElementById('draft-output'); return Boolean(field) && document.activeElement === field && field.selectionStart === 0 && field.selectionEnd === field.value.length; })()`));
      await evaluate('window.__appCheckClipboardFail = false');
      await clickText('Shuffle');
      const shuffled = (await output()).split('\n');
      check('Shuffle preserves every item and changes order', JSON.stringify([...mixed].sort()) === JSON.stringify([...shuffled].sort()) && JSON.stringify(mixed) !== JSON.stringify(shuffled));
    });

    await step('Live mixed ZIP contains actual media bytes', async () => {
      assert.equal(mixed.length, 11, 'Mixed album is required');
      const expected = (await output()).split('\n');
      await clickText('Download ZIP');
      await wait('window.__appCheckDownloads.length > 0', 90000);
      const zip = await evaluate(`(() => { const download = window.__appCheckDownloads.at(-1); const capture = window.__appCheckZipBlobs.find(item => item.url === download.url); window.__appCheckZip = capture.blob; return { name: download.name, size: capture.blob.size, mime: capture.blob.type }; })()`);
      const chunks = [];
      for (let offset = 0; offset < zip.size; offset += 512 * 1024) {
        const encoded = await evaluate(`(async () => { const bytes = new Uint8Array(await window.__appCheckZip.slice(${offset}, ${offset + 512 * 1024}).arrayBuffer()); let binary = ''; for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768)); return btoa(binary); })()`);
        chunks.push(Buffer.from(encoded, 'base64'));
      }
      const archive = await JSZip.loadAsync(Buffer.concat(chunks));
      const files = Object.values(archive.files).filter(file => !file.dir);
      const entries = [];
      for (const file of files) {
        const bytes = await file.async('nodebuffer');
        const valid = file.name.endsWith('.gif') ? /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) : file.name.endsWith('.mp4') ? bytes.toString('ascii', 4, 8) === 'ftyp' : bytes[0] === 0xff && bytes[1] === 0xd8;
        entries.push({ name: file.name, bytes: bytes.length, signatureValid: valid, sha256: sha256(bytes) });
      }
      const expectedNames = expected.map((url, index) => `${String(index + 1).padStart(3, '0')}_${new URL(url).pathname.split('/').at(-1)}`);
      check('Live ZIP preserves all 11 originals and output order', files.length === 11 && entries.every(item => item.signatureValid && item.bytes > 0) && JSON.stringify(files.map(file => file.name)) === JSON.stringify(expectedNames), { ...zip, entries });
      for (const id of ['qOFnGs4', 'ENIoXlC']) {
        const url = expected.find(value => value.includes(`/${id}.`));
        const originalHash = await evaluate(`(async () => { const response = await fetch(${JSON.stringify(url)}, { credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer' }); if (!response.ok) throw new Error('Original comparison fetch failed'); const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer()); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); })()`);
        const entry = entries.find(item => item.name.includes(`_${id}.`));
        check(`ZIP ${id} bytes equal the live original`, entry?.sha256 === originalHash, { sha256: originalHash });
      }
    });

    await step('ZIP cancellation and changing albums during download', async () => {
      const gif = 'https://i.imgur.com/qOFnGs4.gif';
      const photo = 'https://i.imgur.com/QAfnFZe.jpeg';
      await submit(gif, 1);
      await send('Network.setCacheDisabled', { cacheDisabled: true });
      await send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
      try {
        const beforeCancel = await evaluate('window.__appCheckDownloads.length');
        await clickText('Download ZIP');
        await wait(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Cancel download' && !button.disabled)`, 5000);
        await clickText('Cancel download');
        await delay(1800);
        const canceled = await evaluate(`({ downloadCount: window.__appCheckDownloads.length, output: document.getElementById('draft-output')?.value ?? '', downloadEnabled: [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Download ZIP' && !button.disabled), status: [...document.querySelectorAll('[role="status"]')].map(node => node.textContent.trim()).join(' | ') })`);
        check('Cancel download prevents an archive and restores the controls', canceled.downloadCount === beforeCancel && canceled.output === gif && canceled.downloadEnabled && /download cancel(?:l)?ed/i.test(canceled.status) && !/download started/i.test(canceled.status), canceled);

        // Direct URLs establish a new result immediately; only the ZIP media
        // fetch is delayed, so this exercises cancellation during real I/O.
        await submit(photo, 1);
        const beforeReplacement = await evaluate('window.__appCheckDownloads.length');
        await clickText('Download ZIP');
        await wait(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Cancel download' && !button.disabled)`, 5000);
        await delay(100);
        await submit(gif, 1);
        await delay(1800);
        const replaced = await evaluate(`({ downloadCount: window.__appCheckDownloads.length, output: document.getElementById('draft-output')?.value ?? '', downloadEnabled: [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Download ZIP' && !button.disabled), status: [...document.querySelectorAll('[role="status"], [role="alert"]')].map(node => node.textContent.trim()).join(' | ') })`);
        check('Changing albums cancels the old ZIP without a late save or notice', replaced.downloadCount === beforeReplacement && replaced.output === gif && replaced.downloadEnabled && !/(download (started|cancelled|canceled)|could not download)/i.test(replaced.status), replaced);
      } finally {
        await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await send('Network.setCacheDisabled', { cacheDisabled: false });
      }
    });

    await step('Live 100-image album and gallery scrolling', async () => {
      await submit('https://imgur.com/a/L1Z5W', 100);
      const layout = await evaluate(`(() => { const thumbs = document.querySelectorAll(${JSON.stringify(thumbnailSelector)}); const grid = thumbs[0]?.parentElement?.parentElement; return { count: thumbs.length, scrollHeight: grid?.scrollHeight, clientHeight: grid?.clientHeight, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }; })()`);
      check('Live large album lists 100 originals in a bounded gallery', layout.count === 100 && layout.scrollHeight > layout.clientHeight && layout.documentWidth <= layout.viewportWidth + 1, layout);
      await openItem(99);
      check('Last-item viewer disables Next media', await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Next media"]').disabled`));
      await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Previous media"]').click()`);
      check('Viewer can navigate backward from the last item', !await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Next media"]').disabled`));
      await closeDialog();
    });

    await step('Recovered GIFV original renders and animates', async () => {
      const lines = await submit('https://i.imgur.com/4XBi2TE.gifv', 1);
      check('GIFV resolves to the actual GIF original', lines[0] === 'https://i.imgur.com/4XBi2TE.gif', { url: lines[0] });
      await openItem(0);
      await wait(`document.querySelector('[role="dialog"] img')?.naturalWidth > 0`);
      const bounds = await evaluate(`(() => { const image = document.querySelector('[role="dialog"] img'); const box = image.getBoundingClientRect(); return { clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }, width: image.naturalWidth, height: image.naturalHeight, src: image.currentSrc }; })()`);
      const frames = [];
      for (let index = 0; index < 3; index++) {
        await delay(300);
        const shot = await send('Page.captureScreenshot', { format: 'png', clip: bounds.clip });
        frames.push(sha256(Buffer.from(shot.data, 'base64')));
      }
      check('GIF original loads with visibly changing animation frames', bounds.width === 420 && bounds.height === 221 && new Set(frames).size > 1, { width: bounds.width, height: bounds.height, src: bounds.src, distinctFrames: new Set(frames).size });
      await screenshot('gif');
      await closeDialog();
    });

    for (const [name, id, width, height] of [['landscape', 'ENIoXlC', 400, 222], ['portrait', 'pJ7dOPT', 480, 600]]) {
      await step(`Live ${name} video playback`, async () => {
        await closeDialog();
        const lines = await submit(`https://imgur.com/${id}`, 1);
        check(`${name} video stays MP4`, lines[0] === `https://i.imgur.com/${id}.mp4`);
        await openItem(0);
        await wait(`document.querySelector('[role="dialog"] video')`);
        await evaluate(`(async () => { const video = document.querySelector('[role="dialog"] video'); video.muted = true; await video.play(); video.currentTime = 0; })()`);
        await wait(`document.querySelector('[role="dialog"] video').readyState >= 2`);
        const before = await evaluate(`(() => { const video = document.querySelector('[role="dialog"] video'); return { time: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames }; })()`);
        await delay(750);
        const after = await evaluate(`(() => { const video = document.querySelector('[role="dialog"] video'); return { time: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames, width: video.videoWidth, height: video.videoHeight, error: video.error?.message || null }; })()`);
        check(`Actual ${name} MP4 plays in the production viewer`, after.time > before.time + 0.3 && after.frames > before.frames && after.width === width && after.height === height && !after.error, { before, after });
        await screenshot(`${name}-video`);
        await closeDialog();
        check(`Closing ${name} viewer removes the player`, await evaluate(`!document.querySelector('video')`));
      });
    }

    await step('Photo, theme, and mobile layout', async () => {
      await closeDialog();
      const lines = await submit('https://imgur.com/QAfnFZe', 1);
      check('Single photo resolves to original JPEG', lines[0] === 'https://i.imgur.com/QAfnFZe.jpeg');
      await openItem(0);
      await wait(`document.querySelector('[role="dialog"] img')?.naturalWidth > 0`);
      check('Single photo opens at its original dimensions', await evaluate(`(() => { const image = document.querySelector('[role="dialog"] img'); return image.naturalWidth === 1836 && image.naturalHeight === 1837; })()`));
      await closeDialog();
      const before = await evaluate(`document.querySelector('[data-theme]').getAttribute('data-theme')`);
      await evaluate(`document.querySelector('button[aria-label^="Switch to "]').click()`);
      const after = await evaluate(`document.querySelector('[data-theme]').getAttribute('data-theme')`);
      check('Theme toggle changes appearance and preserves results', before !== after && (await output()) === lines.join('\n'), { before, after });
      await evaluate(`document.querySelector('button[aria-label^="Switch to "]').click()`);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await evaluate('window.scrollTo(0, 0)');
      await delay(100);
      const mobile = await evaluate(`({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, formatControlsVisible: (() => {
        const fits = control => { const rect = control.getBoundingClientRect(); return !control.disabled && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth + 1; };
        const select = document.querySelector('select[aria-label="Link format"]');
        if (select) return fits(select) && ['plain', 'bbcode', 'html', 'markdown'].every(value => [...select.options].some(option => option.value === value));
        const buttons = [...document.querySelectorAll('[aria-label="Link format"] button')];
        return ['Plain URLs', 'BBCode', 'HTML', 'Markdown'].every(label => buttons.some(button => button.textContent.trim() === label && fits(button)));
      })() })`);
      check('Mobile layout has no horizontal overflow and usable format controls', mobile.documentWidth <= mobile.viewportWidth + 1 && mobile.formatControlsVisible, mobile);
      await screenshot('mobile');
      await openItem(0);
      const modal = await evaluate(`(() => { const rect = document.querySelector('[role="dialog"]').getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }; })()`);
      check('Mobile media viewer fits the viewport', modal.x >= -1 && modal.y >= -1 && modal.right <= modal.width + 1 && modal.bottom <= modal.height + 1, modal);
      await closeDialog();
      await submit('https://i.imgur.com/4XBi2TE.gifv', 1);
      await openItem(0);
      await wait(`document.querySelector('[role="dialog"] img')?.naturalWidth > 0`);
      const gifToolbar = await evaluate(`(() => { const dialog = document.querySelector('[role="dialog"]'); const rect = dialog.getBoundingClientRect(); const links = [...dialog.querySelectorAll('a')].map(link => { const box = link.getBoundingClientRect(); return { text: link.textContent.trim(), href: link.href, left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }); return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, links }; })()`);
      check('Mobile GIF viewer fits original and MP4 links without overflow', gifToolbar.left >= -1 && gifToolbar.right <= gifToolbar.width + 1 && gifToolbar.bottom <= gifToolbar.height + 1 && gifToolbar.links.some(link => link.href === 'https://i.imgur.com/4XBi2TE.gif' && link.text === 'Open original') && gifToolbar.links.some(link => link.href === 'https://i.imgur.com/4XBi2TE.mp4' && link.text === 'MP4') && gifToolbar.links.every(link => link.left >= -1 && link.right <= gifToolbar.width + 1 && link.top >= -1 && link.bottom <= gifToolbar.height + 1), gifToolbar);
      await screenshot('mobile-gif');
      await closeDialog();
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    });

    await step('Lookup cancellation', async () => {
      await send('Network.setCacheDisabled', { cacheDisabled: true });
      await send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
      try {
        await startLookup('https://imgur.com/a/ypaFujs');
        await wait(`[...document.querySelectorAll('button')].some(button => /^Cancel/.test(button.textContent.trim()) && !button.disabled)`, 5000);
        check('Loading hides stale results and result controls', await evaluate(`!document.getElementById('draft-output') && !document.querySelector('[aria-label="Link format"]') && ![...document.querySelectorAll('button')].some(button => /^(Copy links|Copied!|Shuffle|Download ZIP)$/.test(button.textContent.trim()))`));
        await clickText('Cancel', false);
        await wait(`!document.getElementById('draft-url').closest('form').querySelector('button[type="submit"]').disabled`, 5000);
        const canceledOutput = await output();
        await delay(1700);
        check('Cancel stops lookup and prevents late results', canceledOutput === (await output()) && (await output()) === '' && await evaluate(`!document.getElementById('draft-output') && !document.querySelector('[aria-label="Link format"]')`), { status: await evaluate(`[...document.querySelectorAll('[role="status"], [role="alert"]')].map(node => node.textContent.trim()).join(' | ')`) });
      } finally {
        await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await send('Network.setCacheDisabled', { cacheDisabled: false });
      }
    });

    await step('Invalid and missing links show actionable errors', async () => {
      const before = report.requests.filter(request => request.url.startsWith('https://imgur.com/')).length;
      await startLookup('https://example.com/a/ypaFujs');
      await wait(`document.getElementById('draft-error')`);
      const invalid = await evaluate(`document.getElementById('draft-error').textContent.trim()`);
      check('Invalid host is rejected before contacting Imgur', report.requests.filter(request => request.url.startsWith('https://imgur.com/')).length === before && invalid.length > 0, { error: invalid });
      await startLookup('https://imgur.com/ZzZzZzZ');
      await wait(`document.getElementById('draft-error') && !document.getElementById('draft-url').closest('form').querySelector('button[type="submit"]').disabled`, 22000);
      const missing = await evaluate(`document.getElementById('draft-error').textContent.trim()`);
      check('Unavailable media shows a stable error and no false success', missing.length > 0 && !/invalid.*url/i.test(missing) && (await output()).length === 0, { error: missing });
    });

    if (process.env.BROWSER_SKIP_LARGE_FIXTURE !== '1') {
      phase = 'controlled 1000-item fixture';
      await step('Controlled large-album layout', async () => {
        const examples = [{ hash: 'QAfnFZe', ext: '.jpeg', width: 1836, height: 1837 }, { hash: 'Ziz25', ext: '.jpg', width: 2592, height: 1944 }, { hash: '0r7qN8U', ext: '.png', width: 1920, height: 1080 }];
        const album = { id: 'Test1000', title: 'Controlled 1000-item layout fixture', num_images: 1000, album_images: { count: 1000, images: Array.from({ length: 1000 }, (_, index) => ({ ...examples[index % examples.length], animated: false })) } };
        const html = `<script>Imgur.Album.getInstance({id:"Test1000",\nalbum:${JSON.stringify(album)}\n});</script>`;
        let fulfilled = 0;
        onEvent(message => {
          if (message.method !== 'Fetch.requestPaused') return;
          if (message.params.request.url !== 'https://imgur.com/a/Test1000/embed') {
            void send('Fetch.continueRequest', { requestId: message.params.requestId }).catch(() => {});
            return;
          }
          fulfilled++;
          void send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(html).toString('base64') }).catch(error => report.runtimeErrors.push(`Fixture interception: ${error.message}`));
        });
        await send('Fetch.enable', { patterns: [{ urlPattern: 'https://imgur.com/a/Test1000/embed', requestStage: 'Request' }] });
        try {
          await submit('https://imgur.com/a/Test1000', 1000);
          const layout = await evaluate(`(() => { const thumbs = document.querySelectorAll(${JSON.stringify(thumbnailSelector)}); const grid = thumbs[0]?.parentElement?.parentElement; return { count: thumbs.length, scrollHeight: grid?.scrollHeight, clientHeight: grid?.clientHeight, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }; })()`);
          check('1000-item fixture remains scrollable without page overflow', fulfilled === 1 && layout.count === 1000 && layout.scrollHeight > layout.clientHeight && layout.documentWidth <= layout.viewportWidth + 1, { ...layout, fixtureResponses: fulfilled });
          await openItem(999);
          check('1000-item fixture opens the last image and respects navigation boundary', await evaluate(`document.querySelector('[role="dialog"] button[aria-label="Next media"]').disabled`));
          await closeDialog();
        } finally { await send('Fetch.disable'); }
      });
    }
    phase = 'audit';
    const forbidden = report.requests.filter(({ url }) => {
      const parsed = new URL(url);
      return parsed.hostname === 'api.imgur.com' || parsed.pathname.startsWith('/api/') || parsed.pathname === '/api' || parsed.pathname.startsWith('/_next/image');
    });
    check('All extraction and media requests stay browser direct', forbidden.length === 0, { forbiddenRequests: forbidden, requestCount: report.requests.length });
    check('Application has no uncaught browser exceptions', report.runtimeErrors.length === 0, { errors: report.runtimeErrors });
  });
} catch (error) {
  report.harnessError = error.message;
  check('Browser harness completed', false, { error: error.message });
} finally {
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.filter(item => item.passed).length;
  report.failed = report.checks.filter(item => !item.passed).length;
  writeFileSync(join(outputDirectory, 'local-client-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Production browser checks: ${report.passed} passed, ${report.failed} failed`);
  if (report.failed) process.exitCode = 1;
}
