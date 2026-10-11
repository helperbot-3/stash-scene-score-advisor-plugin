// Synthetic responses against the disposable Stash on port 19998 only.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const M=require('../plugins/scene-score-advisor/ui/model.js');
(async()=>{
 const scenes=Array.from({length:200},(_,i)=>({id:String(i+1),title:'Input demo '+(i+1),rating100:i<180?40+(i%2?35:0)+(i%4>=2?10:0):null,tags:[{id:'1',name:'Common'}],performers:[{id:String(i%2+1),name:i%2?'Preferred':'Other'}],studio:{id:String(i%4>=2?2:1),name:i%4>=2?'Studio B':'Studio A'}}));
 const original={version:1,model:await M.train(scenes),rules:{'1':{weight:0,locked:true,review:'corrected'}}};
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const api=async(query,variables={})=>{const r=await page.request.post('http://127.0.0.1:19998/graphql',{data:{query,variables}});const d=await r.json();if(d.errors)throw new Error(JSON.stringify(d.errors));return d.data;};
 const stored=async()=>JSON.parse((await api('{configuration{plugins}}')).configuration.plugins['scene-score-advisor'].state);
 await api('mutation($input:Map!){configurePlugin(plugin_id:"scene-score-advisor",input:$input)}',{input:{state:JSON.stringify(original)}});
 await page.route('**/graphql',async route=>{
  const q=route.request().postDataJSON()?.query||'';
  if(q.includes('query AdvisorScenes'))return route.fulfill({json:{data:{findScenes:{count:scenes.length,scenes}}}});
  return route.continue();
 });
 const b=name=>page.getByRole('button',{name,exact:true}),idle=()=>page.waitForFunction(()=>!document.querySelector('[role=status]'));
 try{
  await page.goto('http://127.0.0.1:19998/scene-score-advisor');
  try{await b('Close').last().waitFor({timeout:1000});await b('Close').last().click();}catch{}
  await page.getByRole('heading',{name:'Scene Score Advisor',exact:true}).waitFor();await idle();
  await b('Compare prediction inputs').click();await page.getByRole('heading',{name:'Compare prediction inputs',exact:true}).waitFor();await idle();
  assert.equal(await page.getByRole('radio').count(),4);assert.deepEqual(await stored(),original);
  await page.screenshot({path:'.test-runtime/inputs-comparison.png',fullPage:true});
  await page.getByRole('radio',{name:'Labels + performers + studios',exact:true}).check();
  assert.ok(await b('Apply selected model').isEnabled());await b('Apply selected model').click();await idle();
  assert.deepEqual((await stored()).model.inputs,{performers:true,studios:true});
  assert.equal((await stored()).rules['1'].weight,0);
  await page.reload();await page.getByRole('heading',{name:'Scene Score Advisor',exact:true}).waitFor();await idle();
  await page.getByText(/Active inputs: Labels \+ performers \+ studios/).waitFor();
  assert.equal(await page.getByText(/prediction inputs, or exclusions have changed/).count(),0);
  await page.locator('tbody details summary').first().click();
  await page.locator('.ssa-breakdown').filter({hasText:'Performer:'}).first().waitFor();
  await b('Undo recalibration').click();await idle();assert.deepEqual((await stored()).model,original.model);
  await b('Compare prediction inputs').click();await idle();
  await page.getByRole('radio',{name:'Labels',exact:true}).check();await b('Apply selected model').click();await idle();
  assert.deepEqual((await stored()).model.inputs,{performers:false,studios:false});
  await b('Compare prediction inputs').click();await idle();await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.test-runtime/inputs-mobile.png',fullPage:true});
  await b('Cancel comparison').click();assert.deepEqual(errors,[]);
  console.log('PASS: four-way comparison, no preview writes, apply, saved input mode, contributions, locks, undo, labels-only, mobile.');
 }catch(e){await page.screenshot({path:'.test-runtime/inputs-failure.png',fullPage:true});throw e;}finally{await browser.close();}
})();
