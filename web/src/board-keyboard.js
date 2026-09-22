import {
  identity,
  indexLayout,
  multiply,
  paneCorners,
  paneMatrix,
  poseLayout,
} from './animation.js';
import { createDisplay, paneForDisplay } from './display.js';
import { createCandidateStrip } from './keyboard-candidates.js';
import { createCandidateArrowHold } from './keyboard-candidate-hold.js';
import { createKeytopHold } from './keyboard-keytop-hold.js';
import { keyboardProfile } from './keyboard-profiles.js';
import {
  KEYBOARD_PREFERENCES_VERSION,
  normalizeKeyboardPreferences,
} from './keyboard-preferences.js';
import { createKeyboardTextField } from './keyboard-text-field.js';
import { keyboardCaretAtPoint } from './keyboard-text-hit.js';
import { keyboardCaretOpacity } from './keyboard-caret.js';
import { createTextScrollRepeat } from './text-scroll-repeat.js';
import { createPaneAnimationBinding } from './pane-animation-binding.js';
import { createLocalPredictor } from './keyboard-prediction.js';
import {
  keyName,
  lowerKeys,
  shiftedKeys,
  symbolPages,
  PHONE_MODES,
  PHONE_LABELS,
  PHONE_CYCLES,
  DICTIONARY_LANGUAGES,
} from './keyboard-data.js';

export const KEYBOARD_LAYOUTS = [
  'fs_VK_ascii_keytop_a',
  'fs_VK_toolbar_a',
  'fs_VK_textBox_a',
  'fs_signWindow_a',
  'fs_prdicSelWidw_a',
  'fs_VK_cellPhone_a',
  'fs_VK_predictInput_a',
  'fs_VK_bg_a',
  'fs_VK_textBox_b',
];
const MAX_COMPOSITION_UNITS = 32;
const [ASCII, TOOLBAR, TEXTBOX, SYMBOLS, LANGUAGE, PHONE, PREDICTION, BACKGROUND, BIG_TEXTBOX] =
  KEYBOARD_LAYOUTS;
const PREFIXES = {
  [ASCII]: 'ascii',
  [TOOLBAR]: 'toolbar',
  [TEXTBOX]: 'text',
  [SYMBOLS]: 'symbols',
  [LANGUAGE]: 'language',
  [PHONE]: 'phone',
  [PREDICTION]: 'prediction',
  [BACKGROUND]: 'background',
  [BIG_TEXTBOX]: 'text',
};
const setVisible = (panes, name, visible) => {
  const pane = panes.get(name);
  if (pane) pane.flags = visible ? pane.flags | 1 : pane.flags & ~1;
};
const control = (id, key, pane, label, picture = pane, prototype = picture) => ({
  id: `key-${id}`,
  key,
  pane,
  prefix: `keyboard-${PREFIXES[key]}:`,
  label,
  picture,
  prototype,
});

function raiseFocusedPane(parent, name) {
  if (parent.name === name) return true;
  const children = parent.children || [];
  const index = children.findIndex((child) => raiseFocusedPane(child, name));
  if (index < 0) return false;
  // Telephone keys, tabs and delete/return have separate parent panes. Keep
  // those transforms while raising the complete focused branch at each level.
  children.push(...children.splice(index, 1));
  return true;
}

/** Native keytop, toolbar, dictionary-selector and telephone layouts.
 * Timing and pane bindings follow tiToolBar, tiPredictLang and tiCandidateBox.
 * A prediction provider is separate: the WAD's Zi8 engine is not JavaScript.
 */
export function createBoardKeyboard(
  layouts,
  {
    profile = 'memo',
    nativeType = profile === 'console-nickname' ? 6 : undefined,
    value = '',
    maxLength = profile === 'console-nickname' ? 10 : 1000,
    multiline = keyboardProfile(nativeType).multiline,
    onChange = () => {},
    onClose = () => {},
    onSound = () => {},
    initialPreferences,
    initialPredictionEnabled = false,
    initialDictionaryLanguage = 'en',
    onPreferencesChange = () => {},
    showTextBox = nativeType !== undefined,
    showBackground = nativeType !== undefined,
    predictionAllowed = keyboardProfile(nativeType).prediction,
    languageSelectionAllowed = predictionAllowed,
    symbolsAllowed = keyboardProfile(nativeType).symbols,
    layoutSelectionAllowed = keyboardProfile(nativeType).layouts,
    bigTextBox = keyboardProfile(nativeType).bigText,
    secret = false,
    allowedCharacters = null,
    textLayout,
    rowLimit = nativeType === undefined ? Infinity : 1,
    measureTextLayout,
    title = '',
    cancelLabel = nativeType === undefined ? 'Back' : 'Quit',
    predict,
    dictionaries = {},
    display = { width: 832 },
    measureText = (value, pane) => [...value].length * pane.fontSize[0] * 0.5,
  } = {},
) {
  let text = value;
  let caret = value.length;
  let caretColumn = null;
  let caps = false;
  let shift = false;
  let hardwareShift = false;
  let hardwareCapsLock;
  let age = 0;
  const scrollRepeat = createTextScrollRepeat({
    advance: (frames) => api.advance(frames, true),
    activate: (id) => api.activate(id),
  });
  const candidateHold = createCandidateArrowHold({
    advance: (frames) => scrollRepeat.advance(frames),
    activate: (id) => api.activate(id),
    available: (id) => !locked() && controls().some((item) => item.id === id),
  });
  let repeatingKeytop = false;
  const keytopHold = createKeytopHold({
    advance: (frames) => candidateHold.advance(frames),
    activate: (id) => {
      repeatingKeytop = true;
      try {
        return api.activate(id);
      } finally {
        repeatingKeytop = false;
      }
    },
    available: (id) => !locked() && controls().some((item) => item.id === id),
  });
  let focused = null;
  let lastPressed = null;
  let closed = false;
  const inputProfile = keyboardProfile(nativeType);
  const textBoxKey = bigTextBox ? BIG_TEXTBOX : TEXTBOX;
  const textField =
    showTextBox && measureTextLayout
      ? createKeyboardTextField({
          pane: indexLayout(layouts[textBoxKey]).panes.get('T_2l_TextBox'),
          layout: layouts[textBoxKey],
          measure: measureTextLayout,
          rowLimit,
          onScroll: () => onSound('WIPL_SE_LINE_SCROLL'),
        })
      : null;
  textLayout ||= textField?.metrics;

  let savedPreferences = normalizeKeyboardPreferences({
    schemaVersion: KEYBOARD_PREFERENCES_VERSION,
    predictionEnabled: initialPredictionEnabled,
    dictionaryLanguage: initialDictionaryLanguage,
    ...initialPreferences,
  });
  // Numeric and QWERTY-only forms constrain this editor, not the user's saved
  // general keyboard. Only an explicit supported control updates preferences.
  let layoutMode = savedPreferences.layoutMode;
  if (inputProfile.numeric) layoutMode = 'phone';
  else if (!layoutSelectionAllowed) layoutMode = 'qwerty';
  let phoneMode = inputProfile.numeric ? 3 : savedPreferences.phoneMode;
  let phonePending = null;
  let phonePrediction = null;
  let symbols = false;
  let symbolPage = savedPreferences.symbolPage;
  let symbolPhase = null;
  let languageOpen = false;
  let languagePhase = null;
  let dictionaryLanguage = savedPreferences.dictionaryLanguage;
  let predictionEnabled = predictionAllowed && savedPreferences.predictionEnabled;
  let compositionStart = null;
  let predictionPhase = null;
  let candidateCache = null;
  let compositionBoundary = null;
  predict = predict?.createSession?.() || predict;
  const localPredictor = createLocalPredictor(value, dictionaries);
  const predictWords = predict || localPredictor.suggest;
  const motions = new Map();
  const paneBindings = new Map(KEYBOARD_LAYOUTS.map((key) =>
    [key, createPaneAnimationBinding(layouts[key])],
  ));
  const fieldArrows = new Map();
  const sound = (name) => onSound(`WIPL_SE_${name}`);
  const animation = (key, suffix) =>
    layouts[key].animations[`${key === BIG_TEXTBOX ? TEXTBOX : key}_${suffix}`];
  const clip = (key, suffix, frame) => ({ animation: animation(key, suffix), frame, loop: false });
  const locked = () => closed || Boolean(symbolPhase || languagePhase || compositionBoundary?.closing);
  const language = () => DICTIONARY_LANGUAGES.find((entry) => entry.id === dictionaryLanguage);

  const predictionKey = (prefix) =>
    `${dictionaryLanguage}:${prefix}:${predictionEnabled}:${phonePrediction?.digits || ''}`;
  const predictionPrefix = () => {
    if (!predictionEnabled) return '';
    if (phonePrediction) return phonePrediction.value;
    return compositionStart === null ? '' : text.slice(compositionStart, caret);
  };
  function preferencesChanged(changes) {
    savedPreferences = normalizeKeyboardPreferences({ ...savedPreferences, ...changes });
    onPreferencesChange({ ...savedPreferences });
  }

  function notifyDictionary(method, ...arguments_) {
    try {
      const result = predict?.[method]?.(...arguments_);
      // Typing stays available if the optional local worker stops. The next
      // prediction request reports unavailability through the existing UI state.
      if (result?.catch) result.catch(() => {});
    } catch {
      // Custom providers may reject a lifecycle operation synchronously.
    }
  }

  function finishComposition(reset = true) {
    compositionBoundary = null;
    const active = compositionStart !== null || phonePrediction !== null;
    compositionStart = null;
    phonePrediction = null;
    candidateCache = null;
    if (active && reset) notifyDictionary('reset');
    return active;
  }
  function candidateStrip(values) {
    const panes = indexLayout(layouts[PREDICTION]).panes;
    const prototype = panes.get('T_prdc_Text_00');
    return createCandidateStrip(values, {
      measure: (value) => measureText(value, prototype, layouts[PREDICTION]),
      areaWidth: panes.get('N_prdcTextArea').size[0],
      projectionWidth: display.width,
    });
  }

  function candidates() {
    const prefix = predictionPrefix();
    const cacheKey = predictionKey(prefix);
    if (candidateCache?.key === cacheKey) return candidateCache;
    // Keep the active text selectable while the local original-Zi8 request is
    // in flight. A successful result replaces this optimistic literal with
    // dictionary words; an unavailable result leaves the literal selectable.
    const initialValues = prefix ? [prefix] : [];
    const request = {
      key: cacheKey,
      prefix,
      values: initialValues,
      strip: candidateStrip(initialValues),
      state: 'ready',
      selectedIndex: 0,
      engine: predict ? 'provider' : 'local-fallback',
      error: null,
    };
    candidateCache = request;
    if (!predictionEnabled || !prefix) return request;
    const sourceText = text;
    const sourceCaret = caret;
    const current = () =>
      !closed &&
      candidateCache === request &&
      predictionKey(predictionPrefix()) === cacheKey &&
      text === sourceText &&
      caret === sourceCaret;
    const apply = (result) => {
      if (!current()) return;
      const words = Array.isArray(result) ? result : result.candidates;
      if (!Array.isArray(words)) throw new TypeError('Invalid dictionary candidates');
      request.values = words
        .filter((word) => typeof word === 'string' && word.length > 0)
        .slice(0, 40)
        .map((word) => {
          if (phonePrediction?.uppercase) return word[0]?.toLocaleUpperCase() + word.slice(1);
          if (!phonePrediction && prefix === prefix.toLocaleUpperCase())
            return word.toLocaleUpperCase();
          if (!phonePrediction && prefix[0] === prefix[0].toLocaleUpperCase())
            return word[0]?.toLocaleUpperCase() + word.slice(1);
          return word;
        });
      // Zi8 keeps the text being composed visible as a selectable candidate
      // when the dictionary has no match. This also lets an unknown word use
      // the same acceptance path as an ordinary suggestion.
      if (request.values.length === 0 && prefix) request.values = [prefix];
      request.strip = candidateStrip(request.values);
      request.engine = result.engine || (predict ? 'custom' : 'local-fallback');
      request.state = 'ready';
      const composition = request.values.find((word) => word !== '>');
      if (predict && phonePrediction && composition) {
        const value = composition.slice(0, phonePrediction.digits.length);
        const start = phonePrediction.start;
        text = text.slice(0, start) + value + text.slice(caret);
        caret = start + value.length;
        phonePrediction.value = value;
        request.prefix = value;
        request.key = predictionKey(value);
        onChange(text);
      }
    };
    const fail = (error) => {
      if (!current()) return;
      request.state = 'unavailable';
      request.error = error.message || String(error);
    };
    try {
      const caseMode = phonePrediction
        ? (phonePrediction.uppercase ? 'title' : 'lower')
        : prefix === prefix.toLocaleUpperCase()
          ? 'upper'
          : prefix[0] === prefix[0].toLocaleUpperCase() ? 'title' : 'lower';
      const options = {
        language: dictionaryLanguage, digits: phonePrediction?.digits, case: caseMode,
      };
      const result = predict
        ? predict(prefix, options)
        : phonePrediction
          ? localPredictor.suggestDigits(phonePrediction.digits, {
              ...options,
              uppercase: phonePrediction.uppercase,
            })
          : predictWords(prefix, options);
      if (result && typeof result.then === 'function') {
        request.state = 'loading';
        request.settled = Promise.resolve(result).then(apply).catch(fail);
      } else apply(result);
    } catch (error) {
      fail(error);
    }
    return request;
  }

  function queueBoundaryAction(action, closing = false) {
    compositionBoundary.actions.push(action);
    if (closing) {
      // The user has already dismissed this keyboard. Keep its input owner
      // until accepted edits settle, but reject new gestures during that wait.
      compositionBoundary.closing = true;
      api.releaseControl();
    }
    return true;
  }

  function continueAfterCompositionBoundary(action) {
    if (compositionBoundary) return queueBoundaryAction(action);
    const request = candidates();
    const boundary = { request, selectedIndex: request.selectedIndex, actions: [action] };
    compositionBoundary = boundary;
    const settle = () => {
      if (closed || compositionBoundary !== boundary || candidateCache !== request) return false;
      const start = phonePrediction?.start ?? compositionStart;
      if (start === null) return false;
      // Base command 6 reads WithZi's selected full string, then clears it.
      // A failed optional provider has no such string: retain the typed text
      // and let the next query report its status, without fabricating a word.
      const replacement = request.values[boundary.selectedIndex] ?? text.slice(start, caret);
      const next = text.slice(0, start) + replacement + text.slice(caret);
      if (next.length > maxLength || (textField && !textField.accepts(next))) {
        compositionBoundary = null;
        sound('CHAR_DELETE_ERROR');
        // A field-limit rejection rejects this insertion, not later editing
        // commands. In particular, a queued Backspace or normal close still runs.
        for (const pending of boundary.actions.slice(1)) {
          if (closed) break;
          pending(false);
        }
        return false;
      }
      const actions = boundary.actions;
      finishComposition();
      update(next);
      if (closed) return false;
      caret = start + replacement.length;
      for (let index = 0; index < actions.length && !closed; index++)
        actions[index](index === 0);
      return true;
    };
    if (request.state === 'loading') {
      // The native query is synchronous. This local async boundary owns only
      // its matching request; unrelated input below the limit never waits.
      // Preserve subsequent command order as well as typed units: cancelling
      // this wait on Backspace/Back would silently discard an accepted key.
      void request.settled.then(settle);
      return true;
    }
    return settle();
  }

  function displayInput() {
    const candidateIndex = /^key-candidate-\d+$/.test(focused || '')
      ? Number(focused.slice(14))
      : -1;
    const prediction = candidates();
    const hovered = candidateIndex >= 0 && !prediction.strip.snapshot().scrolling;
    const preview = hovered
      ? prediction.values[candidateIndex]
      : prediction.values.find((word) => word !== '>' && word.startsWith(prediction.prefix));
    const start = caret - prediction.prefix.length;
    const compositionColors = prediction.prefix
      ? [{ start, end: caret, color: [255, 50, 50, 255] }]
      : [];
    if (!preview || preview === '>') {
      return {
        displayText: text,
        displayCaret: caret,
        preview: null,
        textColorRanges: compositionColors,
      };
    }
    return {
      displayText: text.slice(0, start) + preview + text.slice(caret),
      displayCaret: hovered ? start + preview.length : caret,
      preview: { start, end: start + preview.length },
      textColorRanges: [
        { start, end: Math.min(caret, start + preview.length), color: [255, 50, 50, 255] },
        {
          start: caret,
          end: start + preview.length,
          color: hovered ? [50, 100, 50, 255] : [192, 192, 192, 255],
        },
      ],
    };
  }

  function projectedPaneRect(layout, name) {
    const projection = createDisplay(display.width > 700 ? '16:9' : '4:3');
    let corners;
    const visit = (pane, parent, root = false) => {
      const matrix = multiply(parent, paneMatrix(paneForDisplay(pane, projection, { root })));
      if (pane.name === name) corners = paneCorners(pane, matrix);
      for (const child of pane.children || []) visit(child, matrix);
    };
    visit(layout.root, identity, true);
    const left = Math.min(...corners.map(([x]) => x));
    const right = Math.max(...corners.map(([x]) => x));
    const top = Math.max(...corners.map(([, y]) => y));
    const bottom = Math.min(...corners.map(([, y]) => y));
    return { x: left + projection.width / 2, y: 228 - top, w: right - left, h: top - bottom };
  }

  function candidateClip(layout) {
    return { ...projectedPaneRect(layout, 'N_prdcTextArea'), y: 0, h: 456 };
  }

  function predictionTextLayer(layout, selectedName = null) {
    // Layouts retain the archive's shared animation table. Copy only mutable
    // presentation panes/materials, as poseLayout does for every other layer.
    const copy = poseLayout(layout);
    const retain = (pane) => {
      pane.children = (pane.children || []).filter(retain);
      // UITextArea::Draw (0x8142C114) redraws text panes, not their enclosing
      // prediction window. Keep ancestor transforms and inherited opacity,
      // but prevent W_predictWindow from painting over the earlier words.
      if (!/^T_prdc_Text_/.test(pane.name)) delete pane.material;
      return (
        pane.children.length > 0 ||
        (selectedName ? pane.name === selectedName : /^T_prdc_Text_/.test(pane.name))
      );
    };
    retain(copy.root);
    return copy;
  }

  // NW4R forceAddAnimation rebinds pane and material targets independently.
  function rebind(key, suffix, paneName, prototype = paneName) {
    return paneBindings.get(key)(animation(key, suffix), paneName, prototype);
  }

  function animate(item, suffix, next = null) {
    if (!item) return;
    const rebound = rebind(item.key, suffix, item.picture, item.prototype);
    if (rebound) motions.set(item.id, { ...item, animation: rebound, frame: 0, next });
  }

  function animationName(item, action) {
    if (isModifier(item) && selectedToggle(item)) {
      if (action === 'normal') return 'normal_toggle-ON';
      if (action === 'Roll_over') return 'toggle-ON';
      if (['Focus-IN', 'Focus-OUT', 'Pushed'].includes(action)) return `toggleON_${action}`;
    }
    if (item?.key === LANGUAGE) return `PRDC_${action}`;
    // Every control in the More window shares the SGN animation family. The
    // page arrows and Close button use the same prototype resources as the
    // symbol keytops, so keeping them on the generic Focus tracks prevents
    // their hover and pressed poses from being drawn.
    if (item?.key === SYMBOLS) return `SGN_${action}`;
    if ([PREDICTION, TEXTBOX, BIG_TEXTBOX].includes(item?.key)) {
      if (action === 'Focus-IN') return 'Foucus_IN';
      if (action === 'Focus-OUT' && item.key === PREDICTION) return 'Focus_OUT';
    }
    return action;
  }

  function selectedToggle(item) {
    if (item.id === 'key-qwerty') return layoutMode === 'qwerty';
    if (item.id === 'key-phone') return layoutMode === 'phone';
    if (item.id.startsWith('key-phone-mode-')) return Number(item.id.slice(15)) === phoneMode;
    if (item.id.startsWith('key-language-'))
      return item.id === `key-language-${dictionaryLanguage}`;
    return (
      (item.id === 'key-caps' && caps) || (item.id === 'key-shift' && (shift || hardwareShift))
    );
  }

  const isModifier = (item) => item?.id === 'key-caps' || item?.id === 'key-shift';
  const isCandidateArrow = (id) => id === 'key-candidates-prev' || id === 'key-candidates-next';
  const isLayoutChoice = (item) => item?.id === 'key-qwerty' || item?.id === 'key-phone';
  const isPhoneModeChoice = (item) => item?.id.startsWith('key-phone-mode-');
  const suppressFocus = (item) =>
    (isLayoutChoice(item) || isPhoneModeChoice(item)) && selectedToggle(item);

  function modifierChanged(item, enabled) {
    // ShiftCapsAnmPane (4.3U 0x81415F58) separates selected color from focus.
    // A nonfocused selected key settles at normal_toggle-ON, never toggle-ON.
    const suffix =
      focused === item?.id
        ? enabled
          ? 'Pushed'
          : 'toggleON_Pushed'
        : enabled
          ? 'toggleON_Focus-OUT'
          : 'Focus-OUT';
    animate(item, suffix, focused === item?.id ? 'rest' : 'normal');
  }

  const character = (index) => {
    if (shift || hardwareShift) return shiftedKeys[index];
    return caps ? lowerKeys[index]?.toUpperCase() : lowerKeys[index];
  };
  const phoneUppercase = () =>
    phoneMode === 2 || (phoneMode === 0 && (caret === 0 || /[.!?]\s*$/.test(text.slice(0, caret))));
  const phoneLabel = (index) => {
    if (inputProfile.numeric)
      return index < 9
        ? String(index + 1)
        : index === 10
          ? '0'
          : index === 11 && inputProfile.dotted
            ? '.'
            : '';
    if (phoneMode === 3) return index < 9 ? String(index + 1) : [',', '0', '*'][index - 9];
    return phoneUppercase() ? PHONE_LABELS[index].toUpperCase() : PHONE_LABELS[index];
  };

  function baseControls() {
    const items = [];
    if (layoutMode === 'qwerty') {
      for (let index = 0; index < lowerKeys.length; index++) {
        if (lowerKeys[index])
          items.push(
            control(
              index,
              ASCII,
              `B_key_${keyName(index)}`,
              character(index),
              `P_key_${keyName(index)}`,
              'P_key_00',
            ),
          );
      }
      for (const [id, suffix, label] of [
        ['delete', 'DELETE', 'Backspace'],
        ['return', 'LF', 'Return'],
        ['caps', 'CAPS', 'Caps'],
        ['shift', 'SHIFT', 'Shift'],
        ['space', 'SPACE', 'Space'],
      ]) {
        items.push(control(id, ASCII, `B_key_${suffix}`, label, `P_key_${suffix}`));
      }
      items.push(control('more', ASCII, 'B_USEU_Chng_sign', 'More', 'W_USEU_Chng_sign'));
      items.push(
        control('language', ASCII, 'B_USEU_prdc_lang', 'Dictionary language', 'W_USEU_prdc_lang'),
      );
    } else {
      for (let index = 0; index < 12; index++) {
        if (phoneLabel(index))
          items.push(
            control(
              `phone-${index}`,
              PHONE,
              `B_CPkey_${keyName(index)}`,
              phoneLabel(index),
              `W_CPkey_${keyName(index)}`,
              'W_CPkey_00',
            ),
          );
      }
      for (const [index, mode] of PHONE_MODES.entries())
        items.push(
          control(
            `phone-mode-${index}`,
            PHONE,
            `B_ChngTag_${keyName(index)}`,
            mode,
            `W_ChngTag_${keyName(index)}`,
            'W_ChngTag_00',
          ),
        );
      items.push(
        control('delete', PHONE, 'B_CPkey_DELETE', 'Backspace', 'W_CPkey_DELETE', 'W_CPkey_00'),
      );
      items.push(control('return', PHONE, 'B_CPkey_LF', 'Return', 'W_CPkey_LF', 'W_CPkey_00'));
      if (phoneMode !== 3) {
        items.push(control('more', PHONE, 'B_othersBT_EU', 'More', 'W_othersBT_EU'));
        items.push(
          control('language', PHONE, 'B_prdcModeBT_EU', 'Dictionary language', 'W_prdcModeBT_EU'),
        );
      }
    }
    if (textField) {
      const state = textField.snapshot();
      for (const direction of ['up', 'down']) {
        if (!(direction === 'up' ? state.previous : state.next)) continue;
        items.push(
          control(
            `text-${direction}`,
            textBoxKey,
            `B_txtScrll_${direction.toUpperCase()}`,
            `Scroll text ${direction}`,
            `P_txtScrll_${direction.toUpperCase()}`,
            'P_txtScrll_UP',
          ),
        );
      }
    }
    items.push(control('back', TOOLBAR, 'B_BT_cancel', cancelLabel, 'P_BT_cancel'));
    items.push(control('ok', TOOLBAR, 'B_BT_confirm', 'OK', 'P_BT_confirm', 'P_BT_cancel'));
    items.push(control('qwerty', TOOLBAR, 'B_kyChng_QWERTY', 'QWERTY keyboard', 'P_kyChng_QWERTY'));
    items.push(
      control(
        'phone',
        TOOLBAR,
        'B_kyChng_CP',
        'Cell phone keyboard',
        'P_kyChng_CP',
        'P_kyChng_QWERTY',
      ),
    );
    const enabled = predictionPhase?.from ?? predictionEnabled;
    items.push(
      control(
        'prediction',
        PREDICTION,
        enabled ? 'B_OnBtn' : 'B_OffBtn',
        enabled ? 'Turn dictionary off' : 'Turn dictionary on',
        enabled ? 'P_OnBtn' : 'P_OffBtn',
      ),
    );
    const prediction = candidates();
    const strip = prediction.strip.snapshot();
    for (const candidate of strip.entries) {
      items.push(
        control(
          `candidate-${candidate.index}`,
          PREDICTION,
          `B_prdc_Text_${keyName(candidate.index % 20)}`,
          candidate.value,
          `T_prdc_Text_${keyName(candidate.index % 20)}`,
          'T_prdc_Text_00',
        ),
      );
    }
    if (strip.previous)
      items.push(
        control(
          'candidates-prev',
          PREDICTION,
          'B_prdc_scrl_Left',
          'Previous suggestions',
          'P_prdc_scrl_Left',
        ),
      );
    if (strip.next)
      items.push(
        control(
          'candidates-next',
          PREDICTION,
          'B_prdc_scrl_Rght',
          'Next suggestions',
          'P_prdc_scrl_Rght',
          'P_prdc_scrl_Left',
        ),
      );
    // Native config type 6 disables the controls at their owners. Removing
    // only the prediction strip leaves an incorrect language/More hit target.
    return items.filter((item) => {
      if (!multiline && item.id === 'key-return') return false;
      if (inputProfile.numeric && item.id.startsWith('key-phone-mode-')) return false;
      if (!symbolsAllowed && item.id === 'key-more') return false;
      if (!languageSelectionAllowed && item.id === 'key-language') return false;
      if (!layoutSelectionAllowed && ['key-qwerty', 'key-phone'].includes(item.id)) return false;
      return predictionAllowed || item.key !== PREDICTION;
    });
  }

  function controls() {
    if (languageOpen)
      return DICTIONARY_LANGUAGES.map((entry) =>
        control(
          `language-${entry.id}`,
          LANGUAGE,
          `B_PRDC_US_${entry.pane}`,
          entry.label,
          `P_PRDC_US_${entry.pane}`,
          'P_PRDC_US_US',
        ),
      );
    if (!symbols) return baseControls();
    return [
      ...symbolPages[symbolPage].map((value, index) =>
        control(
          `symbol-${index}`,
          SYMBOLS,
          `B_SGNkey_${keyName(index)}`,
          value,
          `P_SGNkey_${keyName(index)}`,
          'P_SGNkey_00',
        ),
      ),
      control('symbols-close', SYMBOLS, 'B_SGNkey_close', 'Close', 'P_SGNkey_close'),
      control(
        'symbols-prev',
        SYMBOLS,
        'B_SGNkey_prev',
        'Previous symbol page',
        'P_SGNkey_prev',
        'P_SGNkey_close',
      ),
      control(
        'symbols-next',
        SYMBOLS,
        'B_SGNkey_next',
        'Next symbol page',
        'P_SGNkey_next',
        'P_SGNkey_close',
      ),
    ];
  }

  function update(next, { notify = true } = {}) {
    text = next;
    localPredictor.learn(text.replace(/[\p{L}\p{M}]+$/u, ''));
    candidateCache = null;
    age = 0;
    caretColumn = null;
    if (notify) onChange(text);
  }

  function insert(value, inputSound = value === ' ' ? 'CHAR_DECIDE' : 'CHAR_INPUT') {
    if (!multiline) value = value.replaceAll('\n', '');
    if (inputProfile.numeric)
      value = [...value]
        .filter(
          (character) => /[0-9]/.test(character) || (inputProfile.dotted && character === '.'),
        )
        .join('');
    if (allowedCharacters)
      value = [...value].filter((character) => allowedCharacters.includes(character)).join('');
    if (!value) return false;
    // WithZi keeps a literal run together until a delimiter is entered. This
    // includes digits, punctuation, brackets, and symbols from the More page;
    // restricting composition to letters made those characters disappear
    // from the dictionary strip after the first key press.
    const composing = predictionEnabled && !/\s/u.test(value);
    const next = text.slice(0, caret) + value + text.slice(caret);
    if (next.length > maxLength || (textField && !textField.accepts(next))) {
      sound('CHAR_DELETE_ERROR');
      return false;
    }
    if (compositionBoundary || (composing && compositionStart !== null &&
        caret - compositionStart >= MAX_COMPOSITION_UNITS)) {
      return continueAfterCompositionBoundary((first) =>
        insert(value, first ? 'CHAR_DECIDE' : inputSound));
    }
    if (composing) compositionStart ??= caret;
    else finishComposition();
    update(next);
    caret += value.length;
    sound(inputSound);
    return true;
  }

  function enter() {
    if (multiline) {
      // Return completes the current Memo line even while dictionary
      // composition is active. Advance the caret first; the dictionary reset
      // must follow the line feed so the next query starts on the new line.
      const activeComposition = compositionStart !== null || phonePrediction !== null;
      const next = text.slice(0, caret) + '\n' + text.slice(caret);
      if (next.length > maxLength || (textField && !textField.accepts(next))) {
        sound('CHAR_DELETE_ERROR');
        return false;
      }
      update(next, { notify: false });
      caret += 1;
      if (activeComposition) finishComposition();
      onChange(text);
      sound('CHAR_DECIDE');
      return true;
    }
    if (finishComposition()) {
      sound('CHAR_DECIDE');
      return true;
    }
    close('ok');
    return true;
  }

  function erase(forward = false) {
    if (phonePrediction && !forward) {
      const { digits, start, uppercase } = phonePrediction;
      writePhonePrediction(digits.slice(0, -1), start, uppercase);
      sound('CHAR_DELETE');
      return;
    }
    const unit = forward ? [...text.slice(caret)][0] : [...text.slice(0, caret)].at(-1);
    if (!unit) {
      sound('CHAR_DELETE_ERROR');
      return;
    }
    const from = forward ? caret : caret - unit.length;
    if (compositionStart !== null && (forward || from <= compositionStart))
      finishComposition();
    update(text.slice(0, from) + text.slice(from + unit.length));
    caret = from;
    sound('CHAR_DELETE');
  }

  function dispose() {
    if (closed) return false;
    closed = true;
    scrollRepeat.release();
    candidateHold.release();
    keytopHold.release();
    phonePending = null;
    symbolPhase = null;
    languagePhase = null;
    predictionPhase = null;
    focused = null;
    // Browser sessions are isolated per editor; native buffer ownership differs
    // (docs/dictionary-state.md). Invalidate responses before releasing ours.
    finishComposition(false);
    notifyDictionary('close');
    return true;
  }

  function close(reason) {
    if (closed) return;
    finishComposition();
    dispose();
    onClose(text, { reason });
    sound('CHAR_DECIDE');
  }

  function dismissOverlay() {
    api.releaseControl();
    if (languageOpen) languagePhase = { kind: 'out', frame: 0, frames: 13 };
    else if (symbols) symbolPhase = { kind: 'out', frame: 0, frames: 13 };
    else close('cancel');
    focused = null;
  }

  function press(item, physical = false) {
    lastPressed = item?.id || null;
    animate(item, animationName(item, 'Pushed'), physical ? 'normal' : 'rest');
  }

  function changeShift(enabled, hardware = false) {
    if (hardware) hardwareShift = enabled;
    else {
      shift = enabled;
      if (caps)
        modifierChanged(
          baseControls().find((item) => item.id === 'key-caps'),
          false,
        );
      caps = false;
    }
    const item = baseControls().find((entry) => entry.id === 'key-shift');
    modifierChanged(item, enabled);
    if (enabled || !hardware) sound('SK_SWITCHING_02');
  }

  function changeCaps(enabled) {
    if (caps === enabled) return;
    caps = enabled;
    if (shift)
      modifierChanged(
        baseControls().find((item) => item.id === 'key-shift'),
        false,
      );
    shift = false;
    modifierChanged(
      baseControls().find((item) => item.id === 'key-caps'),
      caps,
    );
    sound('SK_SWITCHING_02');
  }

  function synchronizeCaps(key, state) {
    if (typeof state !== 'boolean') return;
    // macOS can report enabling Caps Lock on keydown and disabling it on keyup.
    // Compare the OS state, rather than requiring a matching press/release pair.
    const previous = hardwareCapsLock;
    hardwareCapsLock = state;
    if (
      key === 'CapsLock' ||
      (previous !== undefined && previous !== state) ||
      (previous === undefined && state)
    )
      changeCaps(state);
  }

  function physicalControl(key, code) {
    const items = baseControls();
    const fixed = {
      Backspace: 'delete',
      Delete: 'delete',
      Enter: 'return',
      ' ': 'space',
      CapsLock: 'caps',
    };
    if (fixed[key]) return items.find((item) => item.id === `key-${fixed[key]}`);
    if (layoutMode === 'phone') {
      const index = inputProfile.numeric
        ? Array.from({ length: 12 }, (_, index) => phoneLabel(index)).indexOf(key)
        : PHONE_CYCLES.findIndex((cycle) => cycle.includes(key.toLowerCase()));
      return items.find((item) => item.id === `key-phone-${index}`);
    }
    let index = lowerKeys.indexOf(key);
    if (index < 0) index = shiftedKeys.indexOf(key);
    if (index < 0 && code?.startsWith('Key'))
      index = lowerKeys.indexOf(code.slice(3).toLowerCase());
    return items.find((item) => item.id === `key-${index}`);
  }

  function keyInput(
    key,
    {
      type = 'keydown',
      code,
      shiftKey,
      capsLock,
      ctrlKey = false,
      metaKey = false,
      repeat = false,
    } = {},
  ) {
    if (compositionBoundary?.closing) {
      if (type === 'blur') api.releaseControl();
      return false;
    }
    if (compositionBoundary) {
      const options = { type, code, shiftKey, capsLock, ctrlKey, metaKey, repeat };
      if (type === 'blur') {
        // Release physical ownership immediately, but apply modifier state in
        // input order after already accepted typing has reached the buffer.
        api.releaseControl();
        return queueBoundaryAction(() => keyInput(key, options));
      }
      if (type === 'keyup') {
        queueBoundaryAction(() => keyInput(key, options));
        return key === 'Shift' || key === 'CapsLock';
      }
      const supported = key === 'Escape' || (!ctrlKey && !metaKey && (
        ['Shift', 'CapsLock', 'Backspace', 'Delete', 'Enter',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key) ||
        [...key].length === 1
      ));
      if (!supported) return false;
      return queueBoundaryAction(() => keyInput(key, options), key === 'Escape');
    }
    if (type === 'blur') {
      scrollRepeat.release();
      candidateHold.release();
      keytopHold.release();
      phonePending = null;
      if (hardwareShift) changeShift(false, true);
      // Retain the last known Caps bit to detect changes while unfocused. The
      // onscreen toggle remains independent when that hardware bit is unchanged.
      return true;
    }
    if (type === 'keyup') {
      if (hardwareShift && (shiftKey === false || (key === 'Shift' && shiftKey === undefined)))
        changeShift(false, true);
      synchronizeCaps(key, capsLock);
      return key === 'Shift' || key === 'CapsLock';
    }
    if (locked()) return false;
    synchronizeCaps(key, capsLock);
    if (key === 'Escape') {
      dismissOverlay();
      return true;
    }
    if (languageOpen || symbols || ctrlKey || metaKey) return false;
    if (key === 'Shift') {
      if (!hardwareShift) changeShift(true, true);
      return true;
    }
    if (key === 'CapsLock') {
      // Browsers without modifier-state reporting fall back to one toggle per
      // nonrepeated keydown. A lost keyup cannot leave this path latched.
      if (typeof capsLock !== 'boolean' && !repeat) changeCaps(!caps);
      return true;
    }
    if (shiftKey !== undefined && shiftKey !== hardwareShift) changeShift(shiftKey, true);
    phonePending = null;
    if (key.startsWith('Arrow')) finishComposition();
    if ((key === 'ArrowUp' || key === 'ArrowDown') && textLayout) {
      const lines = textLayout(text).lines;
      const current = Math.max(
        0,
        lines.findLastIndex((line) => caret >= line.start),
      );
      const line = lines[current];
      const next =
        lines[Math.max(0, Math.min(lines.length - 1, current + (key === 'ArrowUp' ? -1 : 1)))];
      const positions = line.carets || [{ index: caret, x: caret - line.start }];
      caretColumn ??= positions.find((position) => position.index === caret)?.x ?? 0;
      const targetPositions =
        next.carets ||
        Array.from({ length: next.text.length + 1 }, (_, offset) => ({
          index: next.start + offset,
          x: offset,
        }));
      const target = targetPositions.reduce((best, position) =>
        Math.abs(position.x - caretColumn) < Math.abs(best.x - caretColumn) ? position : best,
      );
      if (target.index !== caret) sound('CHAR_CURSOR');
      caret = target.index;
      age = 0;
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      caretColumn = null;
      const before = caret;
      caret +=
        key === 'ArrowLeft'
          ? -([...text.slice(0, caret)].at(-1)?.length || 0)
          : [...text.slice(caret)][0]?.length || 0;
      if (caret !== before) sound('CHAR_CURSOR');
      age = 0;
    } else if (key === 'Backspace' || key === 'Delete') {
      press(physicalControl(key, code), true);
      erase(key === 'Delete');
    } else if (key === 'Enter') {
      press(physicalControl(key, code), true);
      enter();
    } else if ([...key].length === 1) {
      if (phonePrediction) finishComposition();
      press(physicalControl(key, code), true);
      insert(key);
    } else return false;
    return true;
  }

  function enterPhone(index, reverse = false, inputSound = 'CHAR_INPUT') {
    if (compositionBoundary || (phonePrediction?.digits.length >= MAX_COMPOSITION_UNITS &&
        predictionEnabled && phoneMode !== 3 && index >= 1 && index <= 8)) {
      const placeholder = PHONE_CYCLES[index]?.[0] || phoneLabel(index);
      const next = text.slice(0, caret) + placeholder + text.slice(caret);
      if (next.length > maxLength || (textField && !textField.accepts(next))) {
        sound('CHAR_DELETE_ERROR');
        return;
      }
      continueAfterCompositionBoundary((first) =>
        enterPhone(index, reverse, first ? 'CHAR_DECIDE' : inputSound));
      return;
    }
    if (predictionEnabled && phoneMode !== 3 && index >= 1 && index <= 8) {
      const previous = phonePrediction;
      const accepted = writePhonePrediction(
        (previous?.digits || '') + String(index + 1),
        previous?.start ?? caret,
        previous?.uppercase ?? phoneUppercase(),
      );
      sound(accepted ? inputSound : 'CHAR_DELETE_ERROR');
      return;
    }
    phonePrediction = null;
    if (phoneMode === 3) {
      phonePending = null;
      insert(phoneLabel(index));
      return;
    }
    const cycle = PHONE_CYCLES[index];
    if (!cycle) return;
    const continuing = phonePending?.index === index && phonePending.caret === caret;
    const direction = reverse ? -1 : 1;
    let position = reverse ? cycle.length - 1 : 0;
    if (continuing) position = (phonePending.position + direction + cycle.length) % cycle.length;
    const uppercase = continuing ? phonePending.uppercase : phoneUppercase();
    const value = uppercase ? cycle[position].toUpperCase() : cycle[position];
    if (continuing) {
      const from = caret - phonePending.length;
      update(text.slice(0, from) + value + text.slice(caret));
      caret = from + value.length;
      sound('CHAR_INPUT');
    } else if (!insert(value)) return;
    phonePending = { index, position, uppercase, caret, length: value.length, frames: 0 };
  }

  function writePhonePrediction(digits, start, uppercase) {
    const words = predict
      ? []
      : localPredictor.suggestDigits(digits, { language: dictionaryLanguage, uppercase });
    let value = (
      words[0] || [...digits].map((digit) => PHONE_CYCLES[Number(digit) - 1][0]).join('')
    ).slice(0, digits.length);
    if (uppercase && value) value = value[0].toUpperCase() + value.slice(1);
    const next = text.slice(0, start) + value + text.slice(caret);
    if (next.length > maxLength || (textField && !textField.accepts(next))) return false;
    update(next);
    caret = start + value.length;
    if (!digits) finishComposition();
    compositionStart = null;
    phonePrediction = digits ? { digits, start, value, uppercase } : null;
    return true;
  }

  function transitionOverlay(overlay, kind, frames, page) {
    const transition = { kind, frame: 0, frames, page };
    if (overlay === 'symbols') symbolPhase = transition;
    else languagePhase = transition;
    focused = null;
    phonePending = null;
  }

  const api = {
    dispose,
    holdControl(id, { secondary = false, primary = !secondary } = {}) {
      if (!primary) return false;
      if (id === 'key-delete' || (id === 'key-space' && layoutMode === 'qwerty')) {
        scrollRepeat.release();
        candidateHold.release();
        return keytopHold.hold(id);
      }
      if (isCandidateArrow(id)) {
        keytopHold.release();
        scrollRepeat.release();
        return candidateHold.hold(id);
      }
      if (locked() || !['key-text-up', 'key-text-down'].includes(id) ||
          !controls().some((control) => control.id === id)) return false;
      candidateHold.release();
      keytopHold.release();
      scrollRepeat.hold(id);
      return true;
    },
    releaseControl() {
      scrollRepeat.release();
      candidateHold.release();
      keytopHold.release();
    },
    selectTextAt(point) {
      if (locked() || !showTextBox || !measureTextLayout) return false;
      if (compositionBoundary) {
        const pendingPoint = { ...point };
        return queueBoundaryAction(() => api.selectTextAt(pendingPoint));
      }
      const layer = api.presentation().layers.findLast((entry) =>
        entry.prefix === 'keyboard-text:' &&
        indexLayout(entry.layout).panes.has('T_2l_TextBox'),
      );
      if (!layer) return false;
      const index = keyboardCaretAtPoint({
        layout: layer.layout,
        paneName: 'T_2l_TextBox',
        text: secret ? '*'.repeat(text.length) : text,
        point,
        display,
        measure: measureTextLayout,
        clip: layer.clip,
      });
      if (index === null) return false;
      api.setCaret(index, { pointer: true });
      return true;
    },
    setCaret(index, { pointer = false } = {}) {
      if (locked() || !Number.isFinite(index)) return false;
      if (compositionBoundary)
        return queueBoundaryAction(() => api.setCaret(index, { pointer }));
      if (pointer && (compositionStart !== null || phonePrediction !== null)) {
        // Base command E (0x8141DE0C) accepts the active WithZi string through
        // command 6 without measuring the clicked point. Only the next fresh
        // press moves the literal caret. Preserve that order for async queries.
        sound('CHAR_DECIDE');
        return continueAfterCompositionBoundary(() => {
          phonePending = null;
          caretColumn = null;
          age = 0;
        });
      }
      const requested = Math.max(0, Math.min(text.length, Math.trunc(index)));
      let position = 0;
      for (const character of text) {
        if (position + character.length > requested) break;
        position += character.length;
      }
      if (position === caret) return false;
      finishComposition();
      phonePending = null;
      caretColumn = null;
      caret = position;
      age = 0;
      sound('CHAR_CURSOR');
      return true;
    },
    advance(frames, repeated = false) {
      if (!repeated) return keytopHold.advance(frames);
      if (locked()) api.releaseControl();
      age += frames;
      if (phonePending && focused === `key-phone-${phonePending.index}`) {
        // tiCellPhone's hover counter is reset by each press. Event 1 commits
        // its preview at 90 updates (0x8141B98C), or on pointer departure below.
        phonePending.frames += frames;
        if (phonePending.frames >= 90) phonePending = null;
      }
      if (textField) {
        const input = displayInput();
        textField.update(input.displayText, input.displayCaret);
        textField.advance(frames);
        const fieldState = textField.snapshot();
        for (const direction of ['up', 'down']) {
          const visible = direction === 'up' ? fieldState.previous : fieldState.next;
          let arrow = fieldArrows.get(direction);
          if (!arrow || arrow.visible !== visible) {
            arrow = { visible, frame: visible ? 0 : 10 };
            if (fieldArrows.has(direction)) arrow.frame = 0;
            fieldArrows.set(direction, arrow);
            motions.delete(`key-text-${direction}`);
            if (!visible && focused === `key-text-${direction}`) focused = null;
          }
          arrow.frame = Math.min(arrow.visible ? 11 : 10, arrow.frame + frames);
        }
      }
      candidateCache?.strip.advance(frames);
      for (const motion of motions.values()) {
        motion.frame += frames;
        if (motion.next && motion.frame >= motion.animation.frames) {
          let next = 'normal';
          if (motion.next === 'rest' && focused === motion.id && !suppressFocus(motion))
            next = 'Roll_over';
          else if (selectedToggle(motion) && !isModifier(motion)) next = 'toggle-ON';
          animate(motion, animationName(motion, next));
        }
      }
      if (symbolPhase && (symbolPhase.frame += frames) >= symbolPhase.frames) {
        if (symbolPhase.kind === 'out') symbols = false;
        if (symbolPhase.page !== undefined) {
          symbolPage = symbolPhase.page;
          preferencesChanged({ symbolPage });
        }
        symbolPhase = null;
      }
      if (languagePhase && (languagePhase.frame += frames) >= languagePhase.frames) {
        if (languagePhase.kind === 'out') languageOpen = false;
        else {
          const selected = controls().find(
            (item) => item.id === `key-language-${dictionaryLanguage}`,
          );
          animate(selected, 'PRDC_Pushed', 'rest');
        }
        languagePhase = null;
      }
      if (predictionPhase && (predictionPhase.frame += frames) >= 12) predictionPhase = null;
    },
    keyInput,
    controls: () =>
      controls().map((item) => ({
        ...item,
        disabled: locked() || (isCandidateArrow(item.id) && Boolean(predictionPhase)) ||
          (Boolean(compositionBoundary) && item.id.startsWith('key-candidate')) ||
          (item.key === PREDICTION && candidates().strip.snapshot().scrolling),
      })),
    hover(id) {
      scrollRepeat.hover(id);
      candidateHold.hover(id);
      keytopHold.hover(id);
      if (phonePending && id !== `key-phone-${phonePending.index}`) phonePending = null;
      if (locked() || focused === id) return false;
      const items = controls();
      const old = items.find((item) => item.id === focused);
      const next = items.find((item) => item.id === id);
      if (compositionBoundary && next?.id.startsWith('key-candidate')) return false;
      if (next?.key === PREDICTION && candidates().strip.snapshot().scrolling &&
          !isCandidateArrow(id)) return false;
      if (isCandidateArrow(id) && predictionPhase) return false;
      if (!suppressFocus(old)) animate(old, animationName(old || {}, 'Focus-OUT'), 'normal');
      if (!suppressFocus(next)) animate(next, animationName(next || {}, 'Focus-IN'), 'rest');
      focused = next?.id || null;
      if (next?.id.startsWith('key-candidate-'))
        candidates().selectedIndex = Number(next.id.slice('key-candidate-'.length));
      if (next) {
        // More-page arrows are the same page controls as the Wii Menu footer:
        // use its target cue instead of the character-key focus sound.
        if (next.key === SYMBOLS && /key-symbols-(prev|next)$/.test(next.id))
          onSound('WIPL_SE_BT_TARGETTING');
        else sound('CHAR_FOCUS');
      }
      return true;
    },
    activate(id, { secondary = false, primary = !secondary } = {}) {
      if (locked()) return false;
      // The native B branch reaches only the twelve phone keytops. A wins when
      // both triggers are present; toolbar cancellation remains a primary action.
      if (!primary && (!secondary || !/^key-phone-\d+$/.test(id))) return false;
      const selected = controls().find((item) => item.id === id);
      if (!selected) return false;
      if (compositionBoundary && id.startsWith('key-candidate')) return false;
      if (selected.key === PREDICTION && candidates().strip.snapshot().scrolling) return false;
      if (isCandidateArrow(id) && predictionPhase) return false;
      if (id === 'key-prediction' && predictionPhase) return false;
      if (!repeatingKeytop) keytopHold.release();
      if (compositionBoundary) return queueBoundaryAction(
        () => api.activate(id, { secondary, primary }), id === 'key-back' || id === 'key-ok',
      );
      if (!isModifier(selected) && !(isLayoutChoice(selected) && selectedToggle(selected)))
        press(selected);
      if (!id.startsWith('key-phone-')) phonePending = null;
      if (!/^key-phone-\d+$/.test(id) && !id.startsWith('key-candidate') && id !== 'key-delete') {
        if (id !== 'key-return') phonePrediction = null;
      }
      if (id === 'key-text-up' || id === 'key-text-down')
        return textField?.scroll(id.endsWith('up') ? -1 : 1) || false;
      if (id === 'key-back' || id === 'key-ok') close(id === 'key-ok' ? 'ok' : 'cancel');
      else if (id === 'key-qwerty' || id === 'key-phone') {
        const next = id === 'key-qwerty' ? 'qwerty' : 'phone';
        if (next !== layoutMode) {
          animate(
            baseControls().find((item) => item.id === `key-${layoutMode}`),
            'toggle-OFF',
            'normal',
          );
          layoutMode = next;
          preferencesChanged({ layoutMode });
          sound(next === 'qwerty' ? 'SK_SWITCHING_01' : 'SK_SWITCH_TO_KETAI');
          focused = null;
        }
      } else if (id === 'key-caps') {
        changeCaps(!caps);
      } else if (id === 'key-shift') changeShift(!shift);
      else if (id === 'key-delete') erase();
      else if (id === 'key-return') {
        enter();
      } else if (id === 'key-space') insert(' ');
      else if (id === 'key-prediction') {
        const from = predictionEnabled;
        finishComposition();
        predictionEnabled = !predictionEnabled;
        preferencesChanged({ predictionEnabled });
        predictionPhase = { frame: 0, from };
        animate(selected, 'OnOffButton_Pushed', 'normal');
        sound(predictionEnabled ? 'SK_PREDICT_ON' : 'SK_PREDICT_OFF');
      } else if (id.startsWith('key-candidate-')) {
        const prediction = candidates();
        const value = prediction.values[Number(id.slice('key-candidate-'.length))];
        if (!value) return false;
        // Native Base command 0x15 inserts the selected UTF-16 string without
        // an added separator, including the telephone candidate '>'.
        const replacement = value;
        const from = caret - prediction.prefix.length;
        const next = text.slice(0, from) + replacement + text.slice(caret);
        if (next.length > maxLength || (textField && !textField.accepts(next))) {
          sound('CHAR_DELETE_ERROR');
          return false;
        }
        update(next);
        caret = from + replacement.length;
        notifyDictionary('accept', Number(id.slice('key-candidate-'.length)));
        finishComposition(false);
        sound('CHAR_DECIDE');
      } else if (id === 'key-candidates-prev' || id === 'key-candidates-next') {
        if (!candidates().strip.scroll(id.endsWith('prev') ? -1 : 1)) return false;
        if (focused !== id) focused = null;
        sound('LINE_SCROLL');
      } else if (id === 'key-language') {
        for (const [id, motion] of motions) {
          if (motion.key === LANGUAGE) motions.delete(id);
        }
        languageOpen = true;
        transitionOverlay('language', 'in', 18);
        sound('SYMBOL_PAGE_OPEN');
      } else if (id.startsWith('key-language-')) {
        finishComposition();
        dictionaryLanguage = id.slice('key-language-'.length);
        preferencesChanged({ dictionaryLanguage });
        transitionOverlay('language', 'out', 13);
        sound('SK_SWITCHING_02');
      } else if (id === 'key-more') {
        symbols = true;
        transitionOverlay('symbols', 'in', 18);
        sound('SYMBOL_PAGE_OPEN');
      } else if (id === 'key-symbols-close') {
        transitionOverlay('symbols', 'out', 13);
        sound('CHAR_DECIDE');
      } else if (id === 'key-symbols-prev' || id === 'key-symbols-next') {
        const direction = id.endsWith('prev') ? -1 : 1;
        transitionOverlay(
          'symbols',
          // The source BRLAN names the movement from the page being replaced:
          // its `prev` clip moves the current page left and its `next` clip
          // moves it right. The visible button direction is the inverse.
          direction < 0 ? 'next' : 'prev',
          20,
          (symbolPage + direction + symbolPages.length) % symbolPages.length,
        );
        // Match the Wii Menu footer's exact page-arrow cue.
        onSound('WSD_SELECT');
        // Keep the native arrow bubble focused until the pointer leaves it.
        focused = id;
      } else if (id.startsWith('key-symbol-'))
        insert(symbolPages[symbolPage][Number(id.slice(11))]);
      else if (id.startsWith('key-phone-mode-')) {
        const nextMode = Number(id.slice('key-phone-mode-'.length));
        if (nextMode !== phoneMode) {
          animate(
            baseControls().find((item) => item.id === `key-phone-mode-${phoneMode}`),
            'toggle-OFF',
            'normal',
          );
          phoneMode = nextMode;
          preferencesChanged({ phoneMode });
        }
        phonePending = null;
        sound('SK_SWITCHING_02');
      } else if (id.startsWith('key-phone-')) {
        enterPhone(Number(id.slice(10)), secondary && !primary);
      } else {
        insert(character(Number(id.slice(4))));
        if (shift) {
          shift = false;
          modifierChanged(
            baseControls().find((item) => item.id === 'key-shift'),
            false,
          );
        }
      }
      return true;
    },
    back() {
      if (locked()) return false;
      if (compositionBoundary) return queueBoundaryAction(() => api.back(), true);
      dismissOverlay();
      return true;
    },
    snapshot() {
      return {
        text,
        caret,
        caps,
        shift: shift || hardwareShift,
        symbols,
        symbolPage,
        languageOpen,
        dictionaryLanguage,
        predictionEnabled,
        layoutMode,
        phoneMode,
        preferences: { ...savedPreferences },
        composition: predictionPrefix()
          ? { start: phonePrediction?.start ?? compositionStart, end: caret }
          : null,
        caretVisible: !closed,
        caretOpacity: keyboardCaretOpacity(age),
        locked: locked(),
        profile,
        nativeType,
        textField: textField?.snapshot() || null,
        ...displayInput(),
        candidateStrip: candidates().strip.snapshot(),
        dictionary: {
          engine: candidates().engine,
          state: candidates().state,
          error: candidates().error,
        },
      };
    },
    presentation() {
      const view = (key, clips = []) => {
        const layout = poseLayout(layouts[key], [
          ...clips,
          ...[...motions.values()]
            .filter((motion) => motion.key === key)
            .map((motion) => ({
              ...motion,
              // AnmPane::calc (0x814371BC) never presents frame == frame count.
              // One-frame selected-normal resources must remain at frame zero.
              frame: Math.min(motion.frame, Math.max(0, motion.animation.frames - 1)),
              loop: false,
            })),
        ]);
        for (const pane of indexLayout(layout).panes.values())
          if (pane.type === 'txt1') pane.text = '';
        return layout;
      };
      const layer = (key, layout) => ({ layout, prefix: `keyboard-${PREFIXES[key]}:` });
      const toolbar = view(TOOLBAR, [
        {
          animation: rebind(
            TOOLBAR,
            layoutMode === 'qwerty' ? 'toggle-ON' : 'normal',
            'P_kyChng_QWERTY',
          ),
          frame: 0,
        },
        {
          animation: rebind(
            TOOLBAR,
            layoutMode === 'phone' ? 'toggle-ON' : 'normal',
            'P_kyChng_CP',
            'P_kyChng_QWERTY',
          ),
          frame: 0,
        },
      ]);
      const toolbarPanes = indexLayout(toolbar).panes;
      toolbarPanes.get('T_BT_cancel').text = cancelLabel;
      toolbarPanes.get('T_BT_confirm').text = 'OK';
      if (!layoutSelectionAllowed) {
        setVisible(toolbarPanes, 'P_kyChng_QWERTY', false);
        setVisible(toolbarPanes, 'P_kyChng_CP', false);
        setVisible(toolbarPanes, 'P_keyChange', false);
      }
      const keytop =
        layoutMode === 'qwerty'
          ? view(ASCII)
          : view(PHONE, [
              {
                animation: rebind(
                  PHONE,
                  'toggle-ON',
                  `W_ChngTag_${keyName(phoneMode)}`,
                  'W_ChngTag_00',
                ),
                frame: 0,
              },
            ]);
      const panes = indexLayout(keytop).panes;
      const displayedPrediction = predictionPhase?.from ?? predictionEnabled;
      if (layoutMode === 'qwerty') {
        for (const name of [
          'N_KeyChange_JP',
          'N_VK_grid',
          'N_modeSelect_all',
          'N_modeSelect_kr',
          'N_VK_grd_Bnd_ALL',
          'P_SHIFTMark',
          'P_CAPSMark',
          'P_key_HENKAN',
        ])
          setVisible(panes, name, false);
        for (let index = 0; index < 50; index++) {
          panes.get(`T_key_${keyName(index)}`).text = character(index) || '';
          if (!lowerKeys[index]) setVisible(panes, `P_key_${keyName(index)}`, false);
        }
        for (const [name, label] of Object.entries({
          T_key_CAPS: 'Caps',
          T_key_SHIFT: 'Shift',
          T_key_SPACE: 'Space',
          T_USEU_prdc_lang: language().short,
          T_USEU_Chng_sign: 'More',
        }))
          panes.get(name).text = label;
        setVisible(panes, 'P_prdc_ON', displayedPrediction);
        setVisible(panes, 'P_prdc_OFF', !displayedPrediction);
        setVisible(panes, 'W_USEU_prdc_lang', languageSelectionAllowed);
        setVisible(panes, 'W_USEU_Chng_sign', symbolsAllowed);
        setVisible(panes, 'P_key_LF', multiline);
      } else {
        for (const name of ['N_CP_onlyJP', 'W_smlCptChngeBT', 'P_CPkey_dakuten'])
          setVisible(panes, name, false);
        setVisible(panes, 'N_CP_onlyEU', phoneMode !== 3);
        for (let index = 0; index < 12; index++) {
          panes.get(`T_CPkey_${keyName(index)}`).text = phoneLabel(index);
          setVisible(panes, `W_CPkey_${keyName(index)}`, Boolean(phoneLabel(index)));
        }
        for (const [index, label] of PHONE_MODES.entries()) {
          panes.get(`T_ChngTag_${keyName(index)}`).text = label;
          if (inputProfile.numeric) setVisible(panes, `W_ChngTag_${keyName(index)}`, false);
        }
        setVisible(panes, 'W_CPkey_LF', multiline);
        setVisible(panes, 'W_prdcModeBT_EU', languageSelectionAllowed);
        setVisible(panes, 'W_othersBT_EU', symbolsAllowed);
        panes.get('T_othersBT_EU').text = 'More';
        panes.get('N_prdc_EU_lang').text = language().short;
        setVisible(panes, 'N_prdc_EU_ON', displayedPrediction);
        setVisible(panes, 'N_prdc_EU_OFF', !displayedPrediction);
      }
      const focusPicture = controls().find((item) => item.id === (focused || lastPressed))?.picture;
      if (focusPicture) raiseFocusedPane(keytop.root, focusPicture);
      const prediction = view(PREDICTION, [
        clip(PREDICTION, 'normal', 1),
        {
          animation: rebind(
            PREDICTION,
            predictionEnabled ? 'predict_ON' : 'Predict_OFF',
            'W_predictWindow',
          ),
          frame: predictionPhase?.frame ?? 12,
          loop: false,
        },
      ]);
      const predictionPanes = indexLayout(prediction).panes;
      for (const name of [
        'P_JPOffBtn',
        'P_CNOffBtn',
        'P_CNOnBtn',
        'P_prdc_scrl_Left',
        'P_prdc_scrl_Rght',
      ])
        setVisible(predictionPanes, name, false);
      setVisible(predictionPanes, 'P_OnBtn', displayedPrediction);
      setVisible(predictionPanes, 'P_OffBtn', !displayedPrediction);
      const strip = candidates().strip.snapshot();
      setVisible(predictionPanes, 'P_prdc_scrl_Left', strip.previous);
      setVisible(predictionPanes, 'P_prdc_scrl_Rght', strip.next);
      const area = predictionPanes.get('N_prdcTextArea');
      const areaX = area.translation[0];
      for (let index = 0; index < 20; index++) {
        predictionPanes.get(`B_prdc_Text_${keyName(index)}`).size[0] = 0;
      }
      for (const candidate of strip.entries) {
        const pane = predictionPanes.get(`T_prdc_Text_${keyName(candidate.index % 20)}`);
        const bounds = predictionPanes.get(`B_prdc_Text_${keyName(candidate.index % 20)}`);
        pane.text = candidate.value;
        pane.size[0] = candidate.width;
        pane.translation[0] = areaX + candidate.x + candidate.screenWidth / 2;
        bounds.size[0] = candidate.clippedRight - candidate.clippedLeft;
        bounds.translation[0] = areaX + (candidate.clippedLeft + candidate.clippedRight) / 2;
      }
      // The dictionary strip is part of the keytop surface. Submit it before
      // the key layout so a focused top-row key can draw its native hover
      // expansion over the strip instead of disappearing underneath it.
      const layers = [layer(TOOLBAR, toolbar)];
      if (predictionAllowed) {
        const textLayer = predictionTextLayer(prediction);
        const horizontalClip = candidateClip(prediction);
        const selectedName =
          !strip.scrolling && /^key-candidate-\d+$/.test(focused || '')
            ? `T_prdc_Text_${keyName(Number(focused.slice(14)) % 20)}`
            : null;
        if (selectedName) {
          const selectedLayer = predictionTextLayer(prediction, selectedName);
          setVisible(indexLayout(textLayer).panes, selectedName, false);
          layers.push(layer(PREDICTION, prediction));
          layers.push({ ...layer(PREDICTION, textLayer), clip: horizontalClip });
          layers.push({
            ...layer(PREDICTION, selectedLayer),
            // Focus-IN scales the first glyph beyond the authored text-area
            // edge for one or two frames. Keep a logical pixel of antialiasing
            // coverage on the left so that first frame is not scissored.
            clip: {
              ...horizontalClip,
              x: -1,
              w: horizontalClip.x + horizontalClip.w + 1,
            },
          });
        } else {
          layers.push(layer(PREDICTION, prediction));
          layers.push({ ...layer(PREDICTION, textLayer), clip: horizontalClip });
        }
        for (const pane of predictionPanes.values()) {
          if (/^T_prdc_Text_/.test(pane.name)) pane.text = '';
        }
      }
      layers.push(layer(layoutMode === 'qwerty' ? ASCII : PHONE, keytop));
      if (showBackground) layers.unshift(layer(BACKGROUND, view(BACKGROUND)));
      if (showTextBox) {
        const arrowClips = [...fieldArrows].map(([direction, arrow]) => ({
          animation: rebind(
            textBoxKey,
            arrow.visible ? 'Fade_IN' : 'Fade_OUT',
            `P_txtScrll_${direction.toUpperCase()}`,
            'P_txtScrll_UP',
          ),
          frame: arrow.frame,
          loop: false,
        }));
        const textbox = view(textBoxKey, arrowClips);
        const textboxPanes = indexLayout(textbox).panes;
        const input = textboxPanes.get('T_2l_TextBox');
        const inputState = displayInput();
        input.text = secret ? '*'.repeat(inputState.displayText.length) : inputState.displayText;
        input.caretIndex = inputState.displayCaret;
        input.showLineFeeds = multiline;
        const fieldState = textField?.snapshot();
        input.noWrap = rowLimit === 1;
        const fieldClip = projectedPaneRect(textbox, 'T_2l_TextBox');
        if (fieldState) {
          input.translation[0] -= fieldState.x;
          input.translation[1] += fieldState.y;
        }
        for (const direction of ['up', 'down']) {
          const arrow = fieldArrows.get(direction);
          setVisible(
            textboxPanes,
            `P_txtScrll_${direction.toUpperCase()}`,
            Boolean(arrow && (arrow.visible || arrow.frame < 10)),
          );
        }
        input.caretVisible = !closed;
        input.caretOpacity = keyboardCaretOpacity(age);
        textboxPanes.get('T_title_text').text = title;
        // TextBox::calc (0x814261A0) shows the authored separators for Wii
        // Number type 12. They are artwork; the stored text/caret stays raw.
        setVisible(textboxPanes, 'N_separateBarAll', inputProfile.separators);
        for (const name of [
          'N_KOR',
          'N_CHN',
          'N_separateBarKOR',
          'N_separateBarCHN',
        ])
          setVisible(textboxPanes, name, false);
        if (textField) {
          const textOnly = predictionTextLayer(textbox, 'T_2l_TextBox');
          input.text = '';
          input.caretVisible = false;
          layers.splice(showBackground ? 1 : 0, 0, layer(textBoxKey, textbox), {
            ...layer(textBoxKey, textOnly),
            clip: fieldClip,
            clipFollowsRoot: true,
          });
        } else layers.splice(showBackground ? 1 : 0, 0, layer(textBoxKey, textbox));
      }
      if (symbols) {
        const clips = [];
        const addSymbolClip = (suffix, frame) => {
          clips.push(clip(SYMBOLS, suffix, frame));
          for (const name of ['P_SGNkey_prev', 'P_SGNkey_next']) {
            clips.push({
              animation: rebind(SYMBOLS, suffix, name, 'P_SGNkey_close'),
              frame,
              loop: false,
            });
          }
        };
        addSymbolClip('SGN_FADE-IN', 18);
        if (symbolPhase) {
          let suffix = `SGN_scroll_${symbolPhase.kind}`;
          if (symbolPhase.kind === 'in') suffix = 'SGN_FADE-IN';
          else if (symbolPhase.kind === 'out') suffix = 'Scroll_FADE-OUT';
          addSymbolClip(suffix, symbolPhase.frame);
        }
        const symbolLayout = view(SYMBOLS, clips);
        const symbolPanes = indexLayout(symbolLayout).panes;
        for (let index = 0; index < 40; index++)
          symbolPanes.get(`T_SGNkey_${keyName(index)}`).text =
            symbolPages[index < 20 ? symbolPage : (symbolPhase?.page ?? symbolPage)][index % 20];
        symbolPanes.get('T_SGNkey_close').text = 'Close';
        symbolPanes.get('T_SGN_pageNumber').text = `${symbolPage + 1}/${symbolPages.length}`;
        symbolPanes.get('T_SGNkey_prev').text = '←';
        symbolPanes.get('T_SGNkey_next').text = '→';
        layers.push(layer(SYMBOLS, symbolLayout));
      }
      if (languageOpen) {
        const clips = [clip(LANGUAGE, 'PRDC_FADE-IN', 18)];
        if (languagePhase)
          clips.push(
            clip(
              LANGUAGE,
              languagePhase.kind === 'in' ? 'PRDC_FADE-IN' : 'PRDC_FADE-OUT',
              languagePhase.frame,
            ),
          );
        const languageLayout = view(LANGUAGE, clips);
        const languagePanes = indexLayout(languageLayout).panes;
        setVisible(languagePanes, 'N_PRDCkey_EU', false);
        languagePanes.get('T_PRDC_title').text = 'Dictionary';
        for (const entry of DICTIONARY_LANGUAGES)
          languagePanes.get(`T_PRDC_US_${entry.pane}`).text = entry.label;
        layers.push(layer(LANGUAGE, languageLayout));
      }
      return {
        layers,
        controls: api.controls(),
        caret,
        text,
        caretVisible: !closed,
        caretOpacity: keyboardCaretOpacity(age),
      };
    },
  };
  return api;
}
