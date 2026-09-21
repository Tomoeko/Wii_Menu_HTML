const LANGUAGES = new Set(['JPN', 'ENG', 'GER', 'FRA', 'SPA', 'ITA', 'NED', 'CHN', 'CHT', 'KOR']);

/** Panes in the selected language remain visible even if other groups share them. */
export function languageMask(layout, language = 'ENG') {
  const excluded = new Set();
  for (const [name, panes] of Object.entries(layout.groups || {})) {
    if (LANGUAGES.has(name) && name !== language) {
      for (const pane of panes) excluded.add(pane);
    }
  }
  for (const pane of layout.groups?.[language] || []) excluded.delete(pane);
  return excluded;
}
