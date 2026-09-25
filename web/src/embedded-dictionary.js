import {
  createLocalPredictor,
  DEFAULT_DICTIONARIES,
} from './keyboard-prediction.js';

function embeddedResult(parameters, predictor) {
  const {
    text = '',
    language = 'en',
    digits,
    action = 'query',
    case: caseMode = 'lower',
  } = parameters;
  if (action !== 'query') return { engine: 'embedded-word-list', candidates: [] };
  if (digits !== undefined) {
    let candidates = predictor.suggestDigits(digits, {
      language,
      uppercase: caseMode === 'upper',
    });
    if (caseMode === 'title') {
      candidates = candidates.map((word) => word[0]?.toLocaleUpperCase() + word.slice(1));
    }
    return { engine: 'embedded-word-list', candidates };
  }
  return { engine: 'embedded-word-list', candidates: predictor.suggest(text, { language }) };
}

function preparedWordListUrl(source, manifestUrl) {
  if (typeof source !== 'string' ||
      !/^(?:\/assets\/)?keyboard-dictionary\/[A-Za-z0-9_-]+\.json$/.test(source)) {
    return null;
  }
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  return source.startsWith('/') ? source : base + source;
}

/** Load the prepared OEM word lists without requiring a native runtime. */
export async function loadEmbeddedDictionaries({
  fetcher = globalThis.fetch,
  manifestUrl = '/assets/keyboard-dictionary.json',
} = {}) {
  if (!/^\/assets\/[A-Za-z0-9_-]+\.json$/.test(manifestUrl)) {
    throw new Error('The dictionary manifest must be a local asset.');
  }
  try {
    const response = await fetcher(manifestUrl);
    if (!response.ok) return {};
    const manifest = await response.json();
    const dictionaries = {};
    await Promise.all(
      ['en', 'fr', 'es'].map(async (language) => {
        const url = preparedWordListUrl(manifest.languages?.[language]?.oem?.wordsUrl, manifestUrl);
        if (!url) return;
        const wordsResponse = await fetcher(url);
        if (!wordsResponse.ok) return;
        const words = (await wordsResponse.json())?.words;
        if (Array.isArray(words) && words.length <= 10000) {
          dictionaries[language] = words.filter((word) =>
            typeof word === 'string' && word.length > 0 && word.length <= 64 &&
            !/[\x00-\x1f\x7f]/.test(word),
          );
        }
      }),
    );
    return dictionaries;
  } catch {
    return {};
  }
}

/** Prepared words and the small built-in vocabulary are a local replacement.
 * Each keyboard editor owns its draft words; no query leaves the browser. */
export function createEmbeddedDictionaryProvider(preparedDictionaries = {}) {
  const words = Object.fromEntries(
    Object.entries(DEFAULT_DICTIONARIES).map(([language, values]) => [language, [...values]]),
  );
  for (const language of ['en', 'fr', 'es']) {
    if (Array.isArray(preparedDictionaries[language])) {
      words[language].push(...preparedDictionaries[language]);
    }
  }
  const makeSession = () => {
    const predictor = createLocalPredictor('', words);
    let closed = false;
    const predict = (text, { language = 'en', digits, case: caseMode = 'lower' } = {}) => {
      if (closed) throw new Error('Dictionary session is closed.');
      return embeddedResult({ text, language, digits, case: caseMode }, predictor);
    };
    predict.learn = (text) => {
      if (closed) throw new Error('Dictionary session is closed.');
      predictor.learn(text);
    };
    predict.reset = () => ({ engine: 'embedded-word-list', candidates: [] });
    predict.accept = () => ({ engine: 'embedded-word-list', candidates: [] });
    predict.close = () => {
      closed = true;
      return { engine: 'embedded-word-list', candidates: [] };
    };
    return predict;
  };
  const provider = makeSession();
  provider.createSession = makeSession;
  return provider;
}
