const fs=require('node:fs/promises');
const path=require('node:path');
const { updateAppResources }=require('./app-resources.cjs');
async function main(){
  const root=path.resolve(__dirname,'..');
  const executable=require('electron');
  if(process.platform!=='win32'||process.arch!=='x64') throw new Error('Build requires Windows x64.');
  const release=process.argv.includes('--release');
  const out=path.join(root,'dist',release?`ProvidersBar-${require('../package.json').version}-win32-x64`:'ProvidersBar-win32-x64');
  if(release) { await fs.mkdir(path.dirname(out),{recursive:true}); await fs.mkdir(out,{recursive:false}); }
  else { await require('./update-portable.cjs').closeRunningApp(); await fs.mkdir(out,{recursive:true}); }
  await fs.cp(path.dirname(executable),out,{recursive:true});
  await updateAppResources(root,out);
  await fs.copyFile(path.join(out,'electron.exe'),path.join(out,'ProvidersBar.exe'));
  await fs.unlink(path.join(out,'electron.exe'));
  console.log(`Application portable : ${path.join(out,'ProvidersBar.exe')}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
