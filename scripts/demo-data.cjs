const categories = [
  { id:'beitrag', name:'Mitgliedsbeiträge', code:'B' },
  { id:'spenden', name:'Spenden & Zuschüsse', code:'S' },
  { id:'allgemein', name:'Allgemein', code:'A' },
  { id:'freizeit', name:'Ferienfreizeit', code:'F' },
  { id:'karneval', name:'Karneval', code:'K' },
].map((category,index)=>({...category,sortOrder:(index+1)*10,active:true}))

function buildDemoData() {
  const rows = [
    ['b01','2026-01-15','haupt','Mitgliedsbeiträge',960000,'beitrag','I'],
    ['b02','2026-02-10','haupt','Spenden',320000,'spenden','I'],
    ['b03','2026-03-20','haupt','Zuschüsse',450000,'spenden','I'],
    ['b04','2026-01-20','haupt','Versicherung',-120000,'allgemein','I'],
    ['b05','2026-10-31','haupt','Bankgebühren',-12000,'allgemein','I'],
    ['b06','2026-10-31','haupt','Zinsen',18000,'allgemein','V'],
    ['b07','2026-06-12','haupt','Teilnehmendenbeiträge',1250000,'freizeit','Z'],
    ['b08','2026-07-28','haupt','Unterkunft',-1060000,'freizeit','Z'],
    ['b09','2026-10-24','haupt','Gemeinschaftliche Anschaffung',-240000,'allgemein'],
    ['b10','2026-02-17','zweit','Eintritt',1860000,'karneval','W'],
    ['b11','2026-02-20','zweit','Saalmiete',-420000,'karneval','W'],
    ['b12','2026-02-21','zweit','Verpflegung',-680000,'karneval','W'],
    ['b13','2026-02-17','k3','Getränkeverkauf',94000,'karneval','W'],
    ['b14','2026-02-19','k3','Material',-32000,'karneval','W'],
    ['b15','2026-10-28','haupt','Erstattung',18000,'allgemein'],
    ['b16','2026-11-02','haupt','Software',-36000,'allgemein'],
    ['b17','2026-02-01','haupt','Umbuchung Karnevalskonto',-200000,'allgemein',null,'t1'],
    ['b18','2026-02-01','zweit','Umbuchung vom Hauptkonto',200000,'allgemein',null,'t1'],
    ['b19','2026-02-15','haupt','Bargeldabhebung',-50000,'allgemein',null,'t2'],
    ['b20','2026-02-15','k3','Einzahlung vom Hauptkonto',50000,'allgemein',null,'t2'],
  ]
  const createYear=(konto,year,name,openingBalance,fiscalStartMonth=1)=>({schemaVersion:1,year,konto,kontoName:name,fiscalStartMonth,openingBalance,clubName:'KLJB Herzfeld · Beispiel',treasurerName:'Kassenführung',categories:categories.map(category=>({...category})),bookings:[]})
  const files=[createYear('haupt',2026,'Hauptkonto',1000000),createYear('zweit',2025,'Karnevalskonto',250000,11),createYear('zweit',2026,'Karnevalskonto',1210000,11),createYear('k3',2026,'Barkasse',50000)]
  const organization={name:'KLJB Herzfeld · Beispiel',treasurerName:'Kassenführung',rules:[],assignments:{},transfers:[]}
  const references={}
  const transferRows={}
  for(const [index,row] of rows.entries()) {
    const [id,date,konto,description,signed,categoryId,area,transfer]=row
    const year=konto==='zweit'?2025:2026
    const file=files.find(file=>file.konto===konto&&file.year===year)
    const refNo=file.bookings.filter(booking=>booking.categoryId===categoryId).length+1
    const booking={id,date,categoryId,name:'',description,type:signed>0?'einnahme':'ausgabe',amount:Math.abs(signed),isUmsatz:!transfer,nonUmsatzAmount:0,subcategory:description,receiptStatus:'vorhanden',receiptAvailable:true,note:'',seq:index+1,refNo,source:'manuell'}
    file.bookings.push(booking)
    const reference={konto,year,bookingId:id}
    references[id]=reference
    if(area)organization.assignments[JSON.stringify([konto,year,id])]={amount:booking.amount,type:booking.type,date,categoryId,allocations:[{area,amount:booking.amount}]}
    if(transfer)(transferRows[transfer]??=[]).push({booking,reference})
  }
  organization.rules=[{id:'rule-beitrag',konto:'haupt',categoryId:'beitrag',area:'I'},{id:'rule-spenden',konto:'haupt',categoryId:'spenden',area:'I'},{id:'rule-freizeit',konto:'haupt',categoryId:'freizeit',area:'Z'}]
  organization.transfers=Object.entries(transferRows).map(([id,pair])=>{const from=pair.find(row=>row.booking.type==='ausgabe');const to=pair.find(row=>row.booking.type==='einnahme');return{id,from:from.reference,to:to.reference,amount:from.booking.amount,fromDate:from.booking.date,toDate:to.booking.date}})
  return{files,settings:{theme:'system',organization},references}
}
module.exports={buildDemoData}
