// Applique le thème enregistré avant le chargement des styles pour éviter tout flash.
// « system » résout immédiatement la préférence Windows ; l'état chargé ensuite fait foi.
(function () {
  var preference = 'light';
  try {
    var stored = localStorage.getItem('providersbar-theme');
    if (stored === 'dark' || stored === 'light' || stored === 'system') preference = stored;
  } catch (error) {
    preference = 'light';
  }
  var systemDark = false;
  try {
    systemDark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (error) {
    systemDark = false;
  }
  var resolved = preference === 'dark' || (preference === 'system' && systemDark) ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  try {
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (event) {
        if (document.documentElement.dataset.themePreference !== 'system') return;
        document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
      });
    }
  } catch (error) {}
})();
