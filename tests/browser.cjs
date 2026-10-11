// Against the isolated server seeded by seed-demo.py, never a user's library.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/graphql')&&/mutation/.test(r.postData()||''))writes.push(r.postData());});
 const button=name=>page.getByRole('button',{name,exact:true});
 const idle=()=>page.waitForFunction(()=>!document.querySelector('[role=status]'));
 try{
  await page.request.post('http://127.0.0.1:19998/graphql',{data:{query:'mutation { configurePlugin(plugin_id: \"scene-score-advisor\", input: {}) }'}});
  writes.length=0;
  const ratingsQuery='{findScenes(filter:{per_page:-1,sort:\"id\"}){scenes{id rating100}}}';
  const ratingsBefore=await (await page.request.post('http://127.0.0.1:19998/graphql',{data:{query:ratingsQuery}})).json();
  await page.goto('http://127.0.0.1:19998/scene-score-advisor');
  try{await button('Close').last().waitFor({timeout:1500});await button('Close').last().click();}catch{}
  await page.getByRole('heading',{name:'Scene Score Advisor',exact:true}).waitFor();await idle();
  await button('Learn from my ratings').click();await page.getByText(/Learned from 48 rated scenes/).waitFor();await idle();
  assert.equal(await page.locator('tbody tr').count(),16);
  await page.locator('summary').first().click();await page.screenshot({path:'.test-runtime/dashboard.png',fullPage:true});
  await button('Tag weights').click();
  const input=page.getByRole('spinbutton',{name:'Adjustment for Natural light',exact:true});
  await input.fill('1.5');await input.press('Tab');await button('Save changes').click();await idle();
  await page.reload();await idle();await button('Tag weights').click();
  await page.getByRole('spinbutton',{name:'Adjustment for Natural light',exact:true}).waitFor();
  assert.equal(await page.getByRole('spinbutton',{name:'Adjustment for Natural light',exact:true}).inputValue(),'1.5');
  await page.screenshot({path:'.test-runtime/tags.png',fullPage:true});
  await page.goto('http://127.0.0.1:19998/scenes/49');
  await page.getByRole('tab',{name:'Suggested score',exact:true}).click();
  await page.getByRole('heading',{name:/Suggested score .*\/ 5/}).waitFor();
  await page.getByText('Why this score?',{exact:true}).click();await page.screenshot({path:'.test-runtime/scene.png',fullPage:true});
  await page.goto('http://127.0.0.1:19998/scene-score-advisor');await idle();await button('Tag weights').click();
  await page.getByRole('checkbox',{name:'Ignore Shaky camera',exact:true}).check();
  await page.getByText(/exclusions have changed since training/).waitFor();
  await button('Learn from my ratings').click();await idle();
  assert.equal(await page.getByText(/exclusions have changed since training/).count(),0);
  assert.equal(await page.locator('tr').filter({hasText:'Shaky camera'}).locator('td').nth(2).innerText(),'—');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.test-runtime/mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  assert.deepEqual(errors,[]);assert.ok(writes.length>=3);assert.ok(writes.every(body=>!body.includes('sceneUpdate')&&!body.includes('sceneCreate')&&!body.includes('bulkSceneUpdate')));
  assert.ok(writes.filter(body=>body.includes('AdvisorSave')).every(body=>body.includes('configurePlugin')));
  const ratingsAfter=await (await page.request.post('http://127.0.0.1:19998/graphql',{data:{query:ratingsQuery}})).json();
  assert.deepEqual(ratingsAfter,ratingsBefore);
  console.log('PASS: learning, stars, overrides, server persistence, scene tab, exclusions, mobile layout, and no rating writes.');
 }catch(e){await page.screenshot({path:'.test-runtime/failure.png',fullPage:true});throw e;}finally{await browser.close();}
})();
