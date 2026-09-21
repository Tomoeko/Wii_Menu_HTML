/** Small, local completion vocabulary. This is an explicit replacement for
 * Zi8, not an extraction or emulation of Nintendo's prediction dictionaries.
 * Draft words receive priority. Nothing is sent to a remote service.
 */
const WORDS = {
  en: [
    'a about after all also and are back be because before but can come day did do for from',
    'get good had has have hello here home how I if in into is it just know like look make',
    'me menu mom mon moo nom non money months more my new next no not now of on one only',
    'or other our out please right see',
    'so some thank thanks that the their them then there these they this time to today too',
    'two up use want was way we well what when where which who will with work would yes you',
    'your',
  ].join(' '),
  fr: [
    'à après au aussi avec avoir bien bon bonjour ce ces comme dans de des deux dire du',
    'elle en encore est et faire ici il ils je jour la le les leur lui mais me merci mes',
    'moi mon ne nous on ou oui par pas plus pour pourquoi quand que quel qui sa sans se ses',
    'si son sur te temps toi ton toujours tout très tu un une va vais vous votre',
  ].join(' '),
  es: [
    'a ahora al algo aquí así bien buenos como con cuando de del día dos el ella en es esta',
    'este esto gracias gusta ha hacer hasta hay hola hoy la las le lo los más me mi mucho',
    'muy no nos nosotros o para pero poco por porque puede que qué quien se ser si sí sin',
    'sobre son su te tiempo todo tu tú un una uno usted vamos ver vez yo',
  ].join(' '),
};

export function createLocalPredictor(initialText = '', dictionaries = {}) {
  const learned = new Map();
  function learn(value) {
    const complete = value.match(/[\p{L}\p{M}]+(?=[^\p{L}\p{M}]|$)/gu) || [];
    for (const word of complete) {
      if (word.length > 1) learned.set(word.toLocaleLowerCase(), word);
    }
  }
  learn(initialText);

  const vocabulary = (language) => [
    ...new Set(
      [...learned.keys(), ...(dictionaries[language] || WORDS[language]?.split(' ') || [])].map(
        (word) => word.toLocaleLowerCase(),
      ),
    ),
  ];

  const digitsFor = (word) =>
    [...word.normalize('NFD').replace(/\p{M}/gu, '')]
      .map((character) => {
        const index = ['abc', 'def', 'ghi', 'jkl', 'mno', 'pqrs', 'tuv', 'wxyz'].findIndex(
          (letters) => letters.includes(character),
        );
        return index < 0 ? '' : String(index + 2);
      })
      .join('');

  return {
    learn,
    suggest(prefix, { language = 'en' } = {}) {
      if (!prefix) return [];
      const normalized = prefix.toLocaleLowerCase();
      const matches = vocabulary(language)
        .filter((word) => word.startsWith(normalized) && word !== normalized)
        .slice(0, 20);
      return matches.map((word) => {
        if (prefix === prefix.toLocaleUpperCase()) return word.toLocaleUpperCase();
        if (prefix[0] === prefix[0].toLocaleUpperCase()) {
          return word[0].toLocaleUpperCase() + word.slice(1);
        }
        return word;
      });
    },
    suggestDigits(digits, { language = 'en', uppercase = false } = {}) {
      if (!digits) return [];
      return vocabulary(language)
        .filter((word) => digitsFor(word).startsWith(digits))
        .sort(
          (first, second) =>
            Number(digitsFor(second) === digits) - Number(digitsFor(first) === digits),
        )
        .slice(0, 20)
        .map((word) => (uppercase ? word[0].toLocaleUpperCase() + word.slice(1) : word));
    },
  };
}
