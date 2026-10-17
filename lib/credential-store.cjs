// Serialize the shared credentials file across providers. Publish a replacement
// in memory only after the atomic disk write succeeds.
function createCredentialStore({ write }) {
  let values = {}, queue = Promise.resolve();
  function load(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document) || Object.values(document).some(value => typeof value !== 'string' || !value)) throw new Error('Fichier de clés illisible. Les données existantes sont conservées.');
    values = { ...document };
  }
  function update(id, value) {
    const work = queue.catch(() => {}).then(async () => {
      const next = { ...values };
      if (value === null) delete next[id];
      else next[id] = value;
      await write(next);
      values = next;
    });
    queue = work;
    return work;
  }
  return { load, has: id => Object.hasOwn(values, id), get: id => Object.hasOwn(values, id) ? values[id] : undefined,
    set: (id, value) => update(id, value), delete: id => update(id, null), settled: () => queue.catch(() => {}) };
}
module.exports = { createCredentialStore };
