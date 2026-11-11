const {existsSync,lstatSync,mkdirSync,readdirSync,writeFileSync}=require('node:fs')
const {join,resolve}=require('node:path')
const {buildDemoData}=require('./demo-data.cjs')
if(process.env.BUCHFUEHRUNG_BUILD_MODE==='production')throw Error('Im Produktionsmodus werden keine Beispieldaten angelegt.')
const root=resolve(__dirname,'..')
const local=join(root,'.local-data')
const directory=join(local,'kassenwart','daten')
for(const folder of [local,join(local,'kassenwart'),directory])if(existsSync(folder)&&lstatSync(folder).isSymbolicLink())throw Error('Der lokale Datenordner darf kein Verweis sein.')
mkdirSync(directory,{recursive:true})
if(readdirSync(directory).some(name=>name.endsWith('.json'))){console.log('Lokale Daten bleiben erhalten.');process.exit(0)}
const {files,settings}=buildDemoData()
for(const file of files){const prefix=file.konto==='haupt'?'kassenbuch':`kassenbuch-${file.konto==='zweit'?'k2':file.konto}`;writeFileSync(join(directory,`${prefix}-${file.year}.json`),JSON.stringify(file,null,2))}
writeFileSync(join(directory,'einstellungen.json'),JSON.stringify(settings,null,2))
console.log('Isolierte Beispieldaten angelegt.')
