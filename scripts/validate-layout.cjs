const { chromium } = require('playwright')
const { expect } = require('@playwright/test')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')

async function run() {
  const directory=resolve('.validation/ui')
  mkdirSync(directory,{recursive:true})
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
  const checks=[]
  const errors=[]
  for(const width of [1440,960,760,390]) {
    const context=await browser.newContext({viewport:{width,height:1000},colorScheme:'light'})
    const page=await context.newPage()
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto('http://127.0.0.1:5190/')
    await page.getByRole('heading',{level:1,name:'Vereinsübersicht',exact:true}).waitFor()
    const openSidebar=async()=>{
      if(!(await page.locator('#app-sidebar').isVisible()))await page.getByRole('button',{name:'Seitenleiste einblenden',exact:true}).click()
    }
    const chooseAccount=async(id)=>{
      await openSidebar()
      const selector=page.getByLabel('Konto wählen',{exact:true})
      await selector.scrollIntoViewIfNeeded()
      await selector.selectOption(id)
      await expect(selector).toHaveValue(id)
      await openSidebar()
      await page.getByRole('navigation',{name:'Hauptnavigation',exact:true}).waitFor({state:'visible'})
    }
    const check=async(name)=>{
      const geometry=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,main:document.querySelector('.main').scrollWidth,client:document.querySelector('.main').clientWidth}))
      assert.ok(geometry.document<=width+1,`${width}px ${name}: document overflows ${JSON.stringify(geometry)}`)
      assert.ok(geometry.main<=geometry.client+1,`${width}px ${name}: main overflows ${JSON.stringify(geometry)}`)
      checks.push({width,name})
      if(width===1440)await page.screenshot({path:join(directory,`${name}.png`),fullPage:true})
    }
    for(const [label,title] of [['Vereinsübersicht','Vereinsübersicht'],['Tätigkeitsbereiche','Tätigkeitsbereiche'],['Berichte','Berichte'],['Einstellungen','Gemeinsame Einstellungen']]){
      await openSidebar()
      await page.getByRole('navigation',{name:'Verein',exact:true}).getByRole('button',{name:label,exact:true}).click()
      await page.getByRole('heading',{level:1,name:title,exact:true}).waitFor()
      if(label==='Berichte') {
        const landing=page.getByRole('navigation',{name:'Berichtsarten',exact:true})
        await expect(landing.getByRole('button')).toHaveCount(5)
        await expect(page.locator('iframe')).toHaveCount(0)
        await expect(page.getByLabel('Von',{exact:true})).toHaveCount(0)
      }
      await check(title)
    }
    await chooseAccount('haupt')
    for(const label of ['Übersicht','Buchungen','Chronologisch','Veranstaltungen','Umsätze importieren','Kontoeinstellungen']){
      await openSidebar()
      const item=page.getByRole('navigation',{name:'Hauptnavigation',exact:true}).getByRole('button',{name:label,exact:true})
      await item.scrollIntoViewIfNeeded()
      await item.click()
      if(label==='Kontoeinstellungen')await page.getByRole('heading',{level:1,name:'Kontoeinstellungen',exact:true}).waitFor()
      else await page.getByRole('heading',{level:1,name:new RegExp(label)}).waitFor()
      await check(label)
    }
    await openSidebar()
    await page.getByRole('navigation',{name:'Verein',exact:true}).getByRole('button',{name:'Berichte',exact:true}).click()
    const catalog=page.getByRole('navigation',{name:'Berichtsarten',exact:true})
    await catalog.waitFor()
    for(const title of ['Einnahmenüberschussrechnung (EÜR)','Buchungsübersicht','Veranstaltungsauswertung','Kassenprüfbericht','Jahrespräsentation']){
      await catalog.getByRole('button',{name:title,exact:true}).click()
      await page.getByRole('heading',{level:1,name:'Berichte',exact:true}).waitFor()
      if(title==='Kassenprüfbericht'||title==='Jahrespräsentation')await page.getByRole('heading',{level:2,name:`${title} 2026`,exact:true}).waitFor()
      else await page.frameLocator('iframe').getByRole('heading',{level:1,name:title,exact:true}).waitFor()
      await expect(catalog).toHaveCount(0)
      await expect(page.getByRole('button',{name:'Alle Berichte',exact:true})).toBeVisible()
      if(width===1440&&title==='Einnahmenüberschussrechnung (EÜR)') {
        const reportPage=await context.newPage()
        await reportPage.setContent(await page.locator('iframe').getAttribute('srcdoc'))
        await reportPage.pdf({path:resolve('.validation/Einnahmenueberschussrechnung-Beispiel.pdf'),printBackground:true,preferCSSPageSize:true})
        await reportPage.close()
      }
      await check(`Berichte-${title}`)
      await page.getByRole('button',{name:'Alle Berichte',exact:true}).click()
      await expect(catalog.getByRole('button')).toHaveCount(5)
    }
    if(width===1440){
      await openSidebar()
      await page.getByRole('navigation',{name:'Verein',exact:true}).getByRole('button',{name:'Vereinsübersicht',exact:true}).click()
      await page.emulateMedia({colorScheme:'dark'})
      await page.screenshot({path:join(directory,'Vereinsübersicht-dunkel.png'),fullPage:true})
    }
    await context.close()
  }
  assert.equal(errors.length,0,errors.join('\n'))
  const result={checks:checks.length,pageErrors:errors,views:checks}
  writeFileSync('.validation/layout.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify({checks:checks.length,pageErrors:errors},null,2))
  await browser.close()
}
run().catch(error=>{console.error(error);process.exit(1)})
