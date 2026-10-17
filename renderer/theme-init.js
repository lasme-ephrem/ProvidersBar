// Apply the last chosen theme before styles load; saved account settings take
// precedence once the renderer receives its state.
try {
  document.documentElement.dataset.theme = localStorage.getItem('providersbar-theme') === 'dark' ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}
