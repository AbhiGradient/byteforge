(function () {
  try {
    var s = JSON.parse(localStorage.getItem('byteforge:settings') || '{}');
    var theme = s.theme || 'system';
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (s.accent) root.setAttribute('data-accent', s.accent);
    if (s.density) root.setAttribute('data-density', s.density);
    if (s.motion) root.setAttribute('data-motion', s.motion);
  } catch (e) { /* defaults apply */ }
})();
