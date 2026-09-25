export const keyName = (index) => String(index).padStart(2, '0');
export const lowerKeys = [...'1234567890-qwertyuiopasdfghjkl:zxcvbnm,.=', '', '', '', ..."[]'`/@"];
export const shiftedKeys = [
  ...'!\\#$%^&*()_QWERTYUIOPASDFGHJKL;ZXCVBNM<>+',
  '',
  '',
  '',
  ...'{}"?~|',
];
// US symbol pages, column-major in keyboard/tiSwData.cpp's csSignKeyUS table.
export const symbolPages = [
  '.,‘:;„“”\'"?!()_¿¡«»&',
  '[]{}·<>+-×÷=±∞%\\/|§@',
  '^~™©®ºª♭♪*←→↑↓#$¢€£¥',
  'àáâäåæãçèéêëìíîïñòóô',
  'öœøõßùúûüýÿÀÁÂÄÅÆÃÇÈ',
  'ÉÊËÌÍÎÏÑÒÓÔÖŒØÕÙÚÛÜÝ',
  'Ÿαβγδεζηθικλμνξοπρστ',
  'υφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟ',
  'ΠΡΣΤΥΦΧΨΩ;΄΅Ά·ΈΉΊΌΎΏ',
  'ΐΪΫάέήίΰςϊϋόύώ◎☆○◇□△',
].map((value) => [...value]);

// The US telephone keyboard tables in tiCpData.cpp. Mode order is
// Abc, abc, ABC, 123; only the first mode returns to lowercase after a word starts.
export const PHONE_MODES = ['Abc', 'abc', 'ABC', '123'];
// The native phone editor displays a pending literal space with this visible
// marker until the active key is committed or the pointer leaves the key.
export const PHONE_SPACE_MARKER = '\u2423';
export const PHONE_LABELS = [
  '.,?@',
  'abc',
  'def',
  'ghi',
  'jkl',
  'mno',
  'pqrs',
  'tuv',
  'wxyz',
  '',
  '\ue0570',
  '',
];
export const PHONE_CYCLES = [
  ".,?!-':@/$#&1",
  'abc2',
  'def3',
  'ghi4',
  'jkl5',
  'mno6',
  'pqrs7',
  'tuv8',
  'wxyz9',
  '',
  ' 0',
  '',
];
export const DICTIONARY_LANGUAGES = [
  { id: 'en', pane: 'US', label: 'English', short: 'Eng' },
  { id: 'fr', pane: 'Fre', label: 'Français', short: 'Fra' },
  { id: 'es', pane: 'Spa', label: 'Español', short: 'Esp' },
];
