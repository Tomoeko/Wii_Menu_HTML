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
  predictor.learn(text);
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

/** Load the prepared OEM word lists without requiring a native runtime. */
export async function loadEmbeddedDictionaries({
  fetcher = globalThis.fetch,
  manifestUrl = '/assets/keyboard-dictionary.json',
} = {}) {
  try {
    const response = await fetcher(manifestUrl);
    if (!response.ok) return {};
    const manifest = await response.json();
    const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
    const dictionaries = {};
    await Promise.all(
      Object.entries(manifest.languages || {}).map(async ([language, descriptor]) => {
        const relative = descriptor?.oem?.wordsUrl;
        if (typeof relative !== 'string') return;
        const url = relative.startsWith('/') ? relative : base + relative;
        const wordsResponse = await fetcher(url);
        if (!wordsResponse.ok) return;
        const words = (await wordsResponse.json())?.words;
        if (Array.isArray(words)) {
          dictionaries[language] = words.filter((word) => typeof word === 'string');
        }
      }),
    );
    return dictionaries;
  } catch {
    return {};
  }
}

/** Fetch original Zi8 when available, with a data-only local fallback. */
export function createNativeDictionaryProvider({
  fetcher = globalThis.fetch,
  url = '/api/dictionary',
  fallbackDictionaries = null,
} = {}) {
  const makeFallback = () => {
    if (fallbackDictionaries === null) return null;
    const words = Object.fromEntries(
      Object.entries(DEFAULT_DICTIONARIES).map(([language, values]) => [language, [...values]]),
    );
    for (const [language, values] of Object.entries(fallbackDictionaries)) {
      if (!Array.isArray(values)) continue;
      words[language] = [...(words[language] || []), ...values];
    }
    return createLocalPredictor('', words);
  };
  let nativeUnavailable = false;
  const request = async (parameters, fallback = null) => {
    if (fallback && nativeUnavailable) return embeddedResult(parameters, fallback);
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters),
      });
      const result = await response.json();
      if (!response.ok || result.engine !== 'original-zi8' || !Array.isArray(result.candidates)) {
        throw new Error(result.error || 'Original dictionary is unavailable');
      }
      return result;
    } catch (error) {
      if (fallback) {
        nativeUnavailable = true;
        return embeddedResult(parameters, fallback);
      }
      throw error;
    }
  };
  const sharedFallback = makeFallback();
  const provider = (text, { language = 'en', digits, case: caseMode } = {}) =>
    request({ text, language, digits, case: caseMode }, sharedFallback);

  provider.createSession = () => {
    const fallback = makeFallback();
    const session = globalThis.crypto.randomUUID();
    let pending = Promise.resolve();
    let queued = 0;
    let closed = false;
    const enqueue = (parameters) => {
      if (closed) return Promise.reject(new Error('Dictionary session is closed'));
      if (queued >= 32 && parameters.action !== 'close') {
        return Promise.reject(new Error('Dictionary session queue is full'));
      }
      queued++;
      // Each editor owns an ordered stream. A late response cannot reorder an
      // acceptance/reset with the next composition in the shared native worker.
      const result = pending.then(() => request({ ...parameters, session }, fallback));
      pending = result.catch(() => {}).finally(() => { queued--; });
      return result;
    };
    const predict = (text, { language = 'en', digits, case: caseMode = 'lower' } = {}) =>
      enqueue({ text, language, digits, case: caseMode });
    predict.reset = () => enqueue({ action: 'reset' });
    predict.accept = (index) => enqueue({ action: 'accept', index });
    predict.close = () => {
      const result = enqueue({ action: 'close' });
      closed = true;
      return result;
    };
    return predict;
  };
  return provider;
}
