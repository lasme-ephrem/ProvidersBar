const fs=require('node:fs/promises');
const path=require('node:path');
async function main(){
  const root=path.resolve(__dirname,'..');
  const executable=require('electron');
  const out=path.join(root,'dist','ProvidersBar-win32-x64');
  const appDir=path.join(out,'resources','app');
  await fs.mkdir(appDir,{recursive:true});
  await fs.cp(path.dirname(executable),out,{recursive:true});
  for(const name of ['main.cjs','preload.cjs','lib','renderer','assets','docs','README.md']) await fs.cp(path.join(root,name),path.join(appDir,name),{recursive:true});
  await fs.writeFile(path.join(appDir,'package.json'),JSON.stringify({name:'providersbar',productName:'ProvidersBar',version:require('../package.json').version,main:'main.cjs'}));
  await fs.copyFile(path.join(out,'electron.exe'),path.join(out,'ProvidersBar.exe'));
  await fs.unlink(path.join(out,'electron.exe'));
  console.log(`Application portable : ${path.join(out,'ProvidersBar.exe')}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
