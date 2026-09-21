(() => {
  const storageKey = 'wii-menu-tools-theme';
  const options = ['system', 'light', 'dark'];
  let choice = 'system';
  let selector;

  function apply(value) {
    choice = options.includes(value) ? value : 'system';
    document.documentElement.dataset.toolTheme = choice;
    if (selector) selector.value = choice;
  }

  try {
    apply(localStorage.getItem(storageKey));
  } catch {
    apply('system');
  }

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
      option.textContent = value === 'system' ? 'System' : value === 'dark' ? 'Dark' : 'Light';
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
