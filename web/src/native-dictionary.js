/** Fetches only from this application's local server. Failure is explicit:
 * the keyboard keeps typing available and reports unavailable suggestions.
 */
export function createNativeDictionaryProvider({
  fetcher = globalThis.fetch,
  url = '/api/dictionary',
} = {}) {
  const request = async (parameters) => {
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
  };
  const provider = (text, { language = 'en', digits, case: caseMode } = {}) =>
    request({ text, language, digits, case: caseMode });

  provider.createSession = () => {
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
      const result = pending.then(() => request({ ...parameters, session }));
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
