(() => {
  const storageKey = 'wii-menu-tools-theme';
  const options = ['dark', 'light', 'system'];
  const systemPrefersLight = window.matchMedia?.('(prefers-color-scheme: light)');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  let choice = 'dark';
  let selector;

  function apply(value) {
    choice = options.includes(value) ? value : 'dark';
    const light = choice === 'light' || (choice === 'system' && systemPrefersLight?.matches);
    document.documentElement.dataset.toolTheme = choice;
    document.documentElement.dataset.toolPalette = light ? 'light' : 'dark';
    if (themeColor) {
      themeColor.content = light ? '#f5f8fb' : '#111820';
    }
    if (selector) selector.value = choice;
  }

  try {
    apply(localStorage.getItem(storageKey));
  } catch {
    apply('dark');
  }

  systemPrefersLight?.addEventListener?.('change', () => apply(choice));

  function mount() {
    const toolbar = document.querySelector('[data-tool-toolbar]');
    if (!toolbar) return;
    const label = document.createElement('label');
    label.className = 'tool-appearance';
    label.append(document.createTextNode('Appearance'));
    selector = document.createElement('select');
    selector.setAttribute('aria-label', 'Appearance');
    for (const value of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value[0].toUpperCase() + value.slice(1);
      selector.append(option);
    }
    selector.value = choice;
    selector.addEventListener('change', () => {
      apply(selector.value);
      try {
        localStorage.setItem(storageKey, choice);
      } catch {
        // The selection still applies when browser storage is unavailable.
      }
    });
    label.append(selector);
    toolbar.append(label);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) apply(event.newValue);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
