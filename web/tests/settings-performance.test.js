import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLatestRasterQueue,
  createSettingsResourceEmbedder,
  settingsFastImageGeometry,
  settingsImageReplacement,
} from '../src/settings-raster-work.js';

test('slow rasterization coalesces pointer bursts into one latest pending state', async () => {
  const jobs = [],
    gates = [];
  const queue = createLatestRasterQueue(async (value) => {
    jobs.push(value);
    await new Promise((resolve) => gates.push(resolve));
  });
  queue.submit({ hover: 0 });
  for (let hover = 1; hover <= 240; hover++) queue.submit({ hover });
  assert.deepEqual(jobs, [{ hover: 0 }]);
  assert.equal(queue.snapshot().pending, 1);
  assert.equal(queue.snapshot().coalesced, 239);
  gates.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(jobs, [{ hover: 0 }, { hover: 240 }]);
  gates.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.snapshot().running, false);
  assert.equal(queue.snapshot().processed, 2);
});

test('opaque GIF rollovers preserve unchanged pixels and replace only provably covered pixels', () => {
  const original = new Uint8ClampedArray([20, 40, 60, 255, 90, 80, 70, 100, 0, 0, 0, 0]);
  const replacement = new Uint8ClampedArray([30, 50, 70, 255, 90, 80, 70, 100, 10, 20, 30, 128]);
  const patch = settingsImageReplacement(original, replacement);
  assert.deepEqual([...patch], [30, 50, 70, 255, 0, 0, 0, 0, 10, 20, 30, 128]);
  const blend = (back, front) =>
    back.map((value, index) => value * (1 - front[3] / 255) + (front[index] * front[3]) / 255);
  const backdrop = [180, 110, 40];
  for (let offset = 0; offset < original.length; offset += 4) {
    const base = blend(backdrop, original.subarray(offset, offset + 4));
    assert.deepEqual(
      blend(base, patch.subarray(offset, offset + 4)),
      blend(backdrop, replacement.subarray(offset, offset + 4)),
    );
  }
});

test('translucent replacement or removal of an opaque image falls back to a full raster', () => {
  const original = new Uint8ClampedArray([30, 40, 50, 100]);
  assert.equal(settingsImageReplacement(original, new Uint8ClampedArray([60, 40, 50, 100])), null);
  assert.equal(settingsImageReplacement(original, new Uint8ClampedArray([0, 0, 0, 0])), null);
});

test('enhanced Settings image patches retain integer supersample geometry', () => {
  assert.deepEqual(
    settingsFastImageGeometry({ x: 12, y: 18, width: 32, height: 24 }, 2),
    { x: 24, y: 36, width: 64, height: 48 },
  );
  assert.equal(settingsFastImageGeometry({ x: 12.25, y: 18, width: 32, height: 24 }, 2), null);
  assert.equal(settingsFastImageGeometry({ x: 12, y: 18, width: 0, height: 24 }, 2), null);
});

test('a failed or cancelled snapshot does not block readiness for the next page', async () => {
  const errors = [],
    processed = [];
  const queue = createLatestRasterQueue(
    async (job) => {
      if (job === 'bad') throw new Error('bad');
      processed.push(job);
    },
    (error) => errors.push(error.message),
  );
  queue.submit('bad');
  queue.submit('obsolete');
  queue.clear();
  queue.submit('ready');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, ['bad']);
  assert.deepEqual(processed, ['ready']);
});

test('font aliases share one embedded original face and cached font block', async () => {
  const css = ['Wii Font', 'Wii Font Latin', 'Wii Font Latin Regular', 'Wii Font JPN Regular']
    .map(
      (name) => `@font-face{font-family:"${name}";src:url("/assets/font.ttf") format("truetype");}`,
    )
    .join('');
  const calls = [];
  const embed = createSettingsResourceEmbedder(css, async (url) => {
    calls.push(url);
    return `data:font/ttf;base64,${url.endsWith('font.ttf') ? 'FONT' : 'IMAGE'}`;
  });
  const markup =
    '<div style="font-family:&quot;Wii Font JPN Regular&quot;,&quot;Wii Font Latin Regular&quot;,sans-serif;"><img src="/assets/button.png"/></div>';
  const result = await embed(markup);
  assert.equal((result.match(/@font-face/g) || []).length, 1);
  assert.equal((result.match(/base64,FONT/g) || []).length, 1);
  assert.match(result, /font-family:WiiRasterFont0,sans-serif;/);
  assert.match(result, /src="data:font\/ttf;base64,IMAGE"/);
  await embed(markup.replace('button.png', 'hover.png'));
  assert.equal(calls.filter((url) => url === '/assets/font.ttf').length, 1);
});

test('resource embedding preserves distinct physical font fallback order', async () => {
  const embed = createSettingsResourceEmbedder(
    '@font-face{font-family:"Regular";src:url("/assets/a.ttf")}@font-face{font-family:"Other";src:url("/assets/b.ttf")}',
    async (url) => `data:font/ttf;base64,${url}`,
  );
  const result = await embed(
    '<div style="font-family:Other,Regular,serif;background-image:url(&quot;/assets/image.png&quot;);"></div>',
  );
  assert.match(result, /font-family:WiiRasterFont1,WiiRasterFont0,serif/);
  assert.equal((result.match(/@font-face/g) || []).length, 2);
});

test('resource embedding parses formatted multiline @font-face rules with whitespace', async () => {
  const formattedCss = [
    '@font-face {',
    '  font-family: "Wii NTLG PGothic Latin Regular";',
    '  src: url("/assets/fonts/WiiNTLG-Regular-1.ttf") format("truetype");',
    '  font-weight: normal;',
    '  font-style: normal;',
    '  font-display: block;',
    '}',
    '@font-face {',
    '  font-family: "FOT-ロダンNTLG Pro DB";',
    '  src: url("/assets/fonts/WiiNTLG-Regular-1.ttf") format("truetype");',
    '  font-weight: normal;',
    '  font-style: normal;',
    '  font-display: block;',
    '}',
  ].join('\n');
  const embed = createSettingsResourceEmbedder(
    formattedCss,
    async (url) => `data:font/ttf;base64,${url}`,
  );
  const markup =
    '<div style="font-family:&quot;FOT-ロダンNTLG Pro DB&quot;;">Wii System Settings 1</div>' +
    '<div style="font-family:&quot;Wii NTLG PGothic Latin Regular&quot;,sans-serif;">Nickname</div>';
  const result = await embed(markup);
  assert.equal((result.match(/@font-face/g) || []).length, 1);
  assert.match(result, /font-family:WiiRasterFont0;/);
  assert.match(result, /font-family:WiiRasterFont0,sans-serif;/);
});

test('missing or conflicting original font mappings fail before publishing fallback text', () => {
  assert.throws(() => createSettingsResourceEmbedder('Not found', async () => ''),
    /No original Settings font faces/);
  assert.throws(() => createSettingsResourceEmbedder(
    '@font-face{font-family:"Original";src:url("/assets/a.ttf");}' +
    '@font-face{font-family:"ORIGINAL";src:url("/assets/b.ttf");}',
    async () => '',
  ), /conflicting files/);
});

test('font remapping respects CSS case matching and never rewrites nickname text', async () => {
  const embed = createSettingsResourceEmbedder(
    '@font-face{font-family:"Original Face";src:url("/assets/a.ttf");}',
    async () => 'data:font/ttf;base64,SYNTHETIC',
  );
  const nickname = 'font-family:Original Face;';
  const result = await embed(
    `<div style="color:black; font-family : &quot;original face&quot;;">${nickname}</div>` +
    `<input value="${nickname}" style="font-family:ORIGINAL FACE;"/>`,
  );
  assert.match(result, /font-family:WiiRasterFont0;/);
  assert.ok(result.includes(`>${nickname}</div>`));
  assert.ok(result.includes(`value="${nickname}"`));
});

test('resource-like nickname text and non-resource attributes remain literal', async () => {
  const requests = [];
  const embed = createSettingsResourceEmbedder(
    '@font-face{font-family:"Original";src:url("/assets/font.ttf");}',
    async (url) => {
      requests.push(url);
      assert.ok(url.startsWith('/assets/'), 'literal user text must not become a fetch');
      return 'data:font/ttf;base64,FONT';
    },
  );
  const nickname = 'url(a)';
  const literal = 'url(https://invalid.example/remote) src="/assets/literal.png" ' +
    'style="font-family:Original; background:url(/assets/literal.png);"';
  const markup = `<div style="font-family:Original;">${nickname} ${literal}</div>` +
    `<input value="${nickname}" title="src=&quot;/assets/literal.png&quot;"/>` +
    '<div data-style="font-family:Original; background:url(/assets/literal.png);"/>' +
    '<!-- <img src="/assets/comment.png"/> -->' +
    '<![CDATA[<img src="/assets/cdata.png"/>]]>';
  const result = await embed(markup);
  assert.ok(result.includes(`>${nickname} ${literal}</div>`));
  assert.ok(result.includes(`<input value="${nickname}"`));
  assert.ok(result.includes('data-style="font-family:Original; background:url(/assets/literal.png);"'));
  assert.ok(result.includes('<!-- <img src="/assets/comment.png"/> -->'));
  assert.ok(result.includes('<![CDATA[<img src="/assets/cdata.png"/>]]>'));
  assert.deepEqual(requests, ['/assets/font.ttf']);
});

test('actual resource attributes and escaped CSS URLs embed without consuming literal CSS strings', async () => {
  const requests = [];
  const embed = createSettingsResourceEmbedder(
    '@font-face{font-family:"Original";src:url("/assets/font.ttf");}',
    async (url) => {
      requests.push(url);
      return url.endsWith('.ttf') ? 'data:font/ttf;base64,FONT' : 'data:image/png;base64,IMAGE';
    },
  );
  const markup = '<div style="font-family:Original;content:&quot;url(literal)&quot;;' +
    'background-image:url(&quot;/assets/a\\&quot;(1).png?x=1&amp;y=2&quot;);' +
    'mask-image:url(/assets/a\\(2\\).png);' +
    'border-image:url(/assets/\\61 b.png);' +
    'list-style-image:url(/assets/trailing\\ );/*url(comment)*/">url(text)</div>' +
    '<img src="/assets/button.png?x=1&#38;y=2"/>' +
    "<img src='/assets/single.png'/>" +
    '<img src="data:image/png;base64,EXISTING"/>';
  const result = await embed(markup);
  assert.deepEqual(requests, [
    '/assets/font.ttf',
    '/assets/a"(1).png?x=1&y=2',
    '/assets/a(2).png',
    '/assets/ab.png',
    '/assets/trailing ',
    '/assets/button.png?x=1&y=2',
    '/assets/single.png',
  ]);
  assert.ok(result.includes('content:&quot;url(literal)&quot;'));
  assert.ok(result.includes('/*url(comment)*/'));
  assert.ok(result.includes('>url(text)</div>'));
  assert.equal((result.match(/data:image\/png;base64,IMAGE/g) || []).length, 6);
  assert.ok(result.includes('src="data:image/png;base64,EXISTING"'));
  assert.equal((result.match(/@font-face/g) || []).length, 1);
});

test('a transient cold font fetch can recover instead of poisoning every later raster', async () => {
  let attempts = 0;
  const embed = createSettingsResourceEmbedder(
    '@font-face{font-family:"Original";src:url("/assets/a.ttf");}',
    async () => {
      attempts++;
      if (attempts === 1) throw new Error('Synthetic interrupted font request');
      return 'data:font/ttf;base64,SYNTHETIC';
    },
  );
  const markup = '<div style="font-family:Original;">Settings</div>';
  await assert.rejects(embed(markup), /interrupted font request/);
  const result = await embed(markup);
  assert.ok(result.includes('base64,SYNTHETIC'));
  assert.equal(attempts, 2);
  await embed(markup);
  assert.equal(attempts, 2);
});
