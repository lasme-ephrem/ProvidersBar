'use strict';

// Icône et informations de version de LasmiumTokensHub.exe. Sans cela,
// l'exécutable copié d'Electron garde l'icône et le nom génériques d'Electron
// (Explorateur, barre des tâches, Gestionnaire des tâches, propriétés).
// resedit (bibliothèque de @electron/packager) réécrit les ressources Windows
// en JavaScript pur : aucun binaire externe.

const fs = require('node:fs/promises');

const PRODUCT_NAME = 'Lasmium TOKENS-HUB';
const COMPANY_NAME = 'Lasmium';

function versionParts(version) {
  const parts = String(version).split('.').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isSafeInteger(part) || part < 0 || part > 65535)) {
    throw new Error(`Version invalide pour l'exécutable : ${version}`);
  }
  return parts;
}

async function brandExecutable(exePath, { iconPath, version, year = new Date().getFullYear() }) {
  const ResEdit = await import('resedit');
  const PE = await import('pe-library');
  const [major, minor, patch] = versionParts(version);
  const executable = PE.NtExecutable.from(await fs.readFile(exePath), { ignoreCert: true });
  const resources = PE.NtExecutableResource.from(executable);

  const icon = ResEdit.Data.IconFile.from(await fs.readFile(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  if (!groups.length) throw new Error('Aucun groupe d’icônes dans l’exécutable Electron.');
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, groups[0].id, groups[0].lang,
    icon.icons.map(item => item.data));

  const [info] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!info) throw new Error('Aucune information de version dans l’exécutable Electron.');
  const language = info.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
  // Versions numériques d'abord : elles réécrivent aussi les chaînes (x.y.z.0).
  info.setFileVersion(major, minor, patch, 0, language.lang);
  info.setProductVersion(major, minor, patch, 0, language.lang);
  info.setStringValues(language, {
    ProductName: PRODUCT_NAME,
    FileDescription: PRODUCT_NAME,
    CompanyName: COMPANY_NAME,
    LegalCopyright: `© ${year} ${COMPANY_NAME}`,
    InternalName: 'LasmiumTokensHub',
    OriginalFilename: 'LasmiumTokensHub.exe',
    FileVersion: `${major}.${minor}.${patch}`,
    ProductVersion: `${major}.${minor}.${patch}`,
  });
  info.outputToResourceEntries(resources.entries);

  resources.outputResource(executable);
  await fs.writeFile(exePath, Buffer.from(executable.generate()));
}

// Lecture des informations écrites (tests et contrôle de release).
async function readExecutableInfo(exePath) {
  const ResEdit = await import('resedit');
  const PE = await import('pe-library');
  const executable = PE.NtExecutable.from(await fs.readFile(exePath), { ignoreCert: true });
  const resources = PE.NtExecutableResource.from(executable);
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  const language = info.getAllLanguagesForStringValues()[0];
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  return {
    strings: info.getStringValues(language),
    iconSizes: groups[0]?.icons.map(item => item.width || 256) || [],
  };
}

module.exports = { PRODUCT_NAME, COMPANY_NAME, brandExecutable, readExecutableInfo, versionParts };
