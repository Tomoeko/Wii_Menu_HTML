import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmbeddedDictionaryProvider,
  loadEmbeddedDictionaries,
} from '../src/embedded-dictionary.js';

test('prepared dictionary loader reads only local word-list assets', async () => {
  const requests = [];
  const dictionaries = await loadEmbeddedDictionaries({
    fetcher: async (url) => {
      requests.push(url);
      if (url === '/assets/keyboard-dictionary.json') {
        return {
          ok: true,
          json: async () => ({
            languages: {
              en: { oem: { wordsUrl: 'keyboard-dictionary/en-oem.json' } },
              fr: { oem: { wordsUrl: '/assets/keyboard-dictionary/fr-oem.json' } },
              es: { oem: { wordsUrl: 'https://other.example/words.json' } },
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ words: [url.includes('/fr-') ? 'bonjour' : 'hello'] }),
      };
    },
  });
  assert.deepEqual(dictionaries, { en: ['hello'], fr: ['bonjour'] });
  assert.deepEqual(requests.sort(), [
    '/assets/keyboard-dictionary.json',
    '/assets/keyboard-dictionary/en-oem.json',
    '/assets/keyboard-dictionary/fr-oem.json',
  ]);
  await assert.rejects(
    loadEmbeddedDictionaries({ manifestUrl: 'https://other.example/words.json' }),
    /local asset/,
  );
});

test('embedded dictionary suggestions stay in each editor and require no endpoint', () => {
  const provider = createEmbeddedDictionaryProvider({ en: ['help', 'world'] });
  const first = provider.createSession();
  const second = provider.createSession();
  assert.equal(first('hel').engine, 'embedded-word-list');
  assert.ok(first('hel').candidates.includes('help'));
  first.learn('helium ');
  assert.equal(first('hel').candidates[0], 'helium');
  assert.equal(second('hel').candidates.includes('helium'), false);
  assert.deepEqual(first('wor', { digits: '967' }), {
    engine: 'embedded-word-list',
    candidates: ['work', 'world'],
  });
  assert.deepEqual(first.accept(0), { engine: 'embedded-word-list', candidates: [] });
  assert.deepEqual(first.reset(), { engine: 'embedded-word-list', candidates: [] });
  first.close();
  assert.throws(() => first('hel'), /closed/);
  assert.equal(second('hel').engine, 'embedded-word-list');
});
