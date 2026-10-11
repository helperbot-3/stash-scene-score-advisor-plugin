const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const M=require('../plugins/scene-score-advisor/ui/model.js');
(async()=>{
 const url='http://127.0.0.1:19998/graphql';
 async function query(query,variables={}){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})});const d=await r.json();if(d.errors)throw new Error(JSON.stringify(d.errors));return d.data;}
 const data=await query('{findScenes(filter:{per_page:-1}){scenes{id title rating100 tags{id name}}}}');
 const original={version:1,model:await M.train(data.findScenes.scenes),rules:{'1':{weight:80,review:'corrected'},'3':{weight:-5,review:'corrected',locked:true}},history:[]};
 await query('mutation($input:Map!){configurePlugin(plugin_id:"scene-score-advisor",input:$input)}',{input:{state:JSON.stringify(original)}});
 const stored=async()=>JSON.parse((await query('{configuration{plugins}}')).configuration.plugins['scene-score-advisor'].state);
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const b=name=>page.getByRole('button',{name,exact:true});
 const idle=()=>page.waitForFunction(()=>!document.querySelector('[role=status]'));
 try{
  await page.goto('http://127.0.0.1:19998/scene-score-advisor');
  try{await b('Close').last().waitFor({timeout:1000});await b('Close').last().click();}catch{}
  await page.getByRole('heading',{name:'Scene Score Advisor',exact:true}).waitFor();await idle();
  await b('Recalibrate from my ratings').click();await page.getByRole('heading',{name:'Recalibration preview',exact:true}).waitFor();await idle();
  assert.deepEqual(await stored(),original,'preview must not write');
  await page.screenshot({path:'.test-runtime/recalibration.png',fullPage:true});
  await b('Keep current model').click();assert.deepEqual(await stored(),original);
  await b('Recalibrate from my ratings').click();await idle();await b('Apply recalibration').click();await idle();
  const applied=await stored();assert.ok(applied.model.guided);assert.ok(applied.rules['1'].weight<80);assert.equal(applied.rules['3'].weight,-5);
  await page.reload();await page.getByRole('heading',{name:'Scene Score Advisor',exact:true}).waitFor();await idle();
  await b('Undo recalibration').click();await idle();
  const undone=await stored();assert.deepEqual(undone.model,original.model);assert.deepEqual(undone.rules,original.rules);
  await b('Review labels').click();await page.getByRole('combobox',{name:'Review filter'}).selectOption('reviewed');await page.getByRole('searchbox',{name:'Search tags'}).fill('Natural');
  await page.getByRole('checkbox',{name:'Lock exact contribution during recalibration'}).click();await page.waitForFunction(()=>document.querySelector('.ssa-lock input')?.checked);await idle();assert.equal((await stored()).rules['1'].locked,true);
  await page.setViewportSize({width:390,height:844});await b('Recalibrate from my ratings').click();await idle();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.test-runtime/recalibration-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: preview writes nothing, discard, apply, persisted undo, exact lock, mobile.');
 }catch(e){await page.screenshot({path:'.test-runtime/recalibration-failure.png',fullPage:true});throw e;}finally{await browser.close();}
})();
