const fs=require('node:fs/promises');
const path=require('node:path');
const { updateAppResources }=require('./app-resources.cjs');
const { brandExecutable }=require('./exe-resources.cjs');
async function main(){
  const root=path.resolve(__dirname,'..');
  const executable=require('electron');
  if(process.platform!=='win32'||process.arch!=='x64') throw new Error('Build requires Windows x64.');
  const release=process.argv.includes('--release');
  // Le dossier personnel garde son nom historique pour préserver data/ (comptes, historique).
  const out=path.join(root,'dist',release?`LasmiumTokensHub-${require('../package.json').version}-win32-x64`:'ProvidersBar-win32-x64');
  if(release) { await fs.mkdir(path.dirname(out),{recursive:true}); await fs.mkdir(out,{recursive:false}); }
  else { await require('./update-portable.cjs').closeRunningApp(); await fs.mkdir(out,{recursive:true}); }
  await fs.cp(path.dirname(executable),out,{recursive:true});
  await updateAppResources(root,out);
  await fs.copyFile(path.join(out,'electron.exe'),path.join(out,'LasmiumTokensHub.exe'));
  await fs.unlink(path.join(out,'electron.exe'));
  // Icône Lasmium et nom du produit dans l'exécutable (sinon ceux d'Electron).
  // Seuls les tests de packaging, qui utilisent un faux Electron, s'en passent.
  if(process.env.LASMIUM_FAKE_ELECTRON!=='1') await brandExecutable(path.join(out,'LasmiumTokensHub.exe'),{ iconPath: path.join(root,'assets','icon.ico'), version: require('../package.json').version });
  console.log(`Application : ${path.join(out,'LasmiumTokensHub.exe')}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
