export function deferredDictionary() {
  const sessions = [];
  const provider = () => { throw new Error('An editor must own its dictionary session'); };
  provider.createSession = () => {
    const session = { requests: [], closeCalls: 0 };
    const predict = (text, options) => new Promise((resolve, reject) => {
      session.requests.push({ text, options, resolve, reject });
    });
    predict.close = () => { session.closeCalls++; };
    sessions.push(session);
    return predict;
  };
  return { provider, sessions };
}

export const flushDictionary = () => new Promise((resolve) => setImmediate(resolve));
