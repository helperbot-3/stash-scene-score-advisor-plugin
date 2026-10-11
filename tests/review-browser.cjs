// Only the disposable synthetic Stash instance on port 19998.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const b=name=>page.getByRole('button',{name,exact:true});
 const idle=()=>page.waitForFunction(()=>!document.querySelector('[role=status]'));
 await page.route('**/graphql',async route=>{
  const q=route.request().postDataJSON()?.query||'';
  if(q.includes('query AdvisorPlugins'))return route.fulfill({json:{data:{plugins:[{id:'marker-compilations',enabled:true}]}}});
  if(q.includes('mutation AdvisorReadMeta'))return route.fulfill({json:{data:{runPluginOperation:[{targets:[{screened_tag_id:'4',absent_tag_id:'999'}]}]}}});
  return route.continue();
 });
 try{
  await page.request.post('http://127.0.0.1:19998/graphql',{data:{query:'mutation {configurePlugin(plugin_id:"scene-score-advisor",input:{})}'}});
  await page.goto('http://127.0.0.1:19998/scene-score-advisor');
  try{await b('Close').last().waitFor({timeout:1200});await b('Close').last().click();}catch{}
  await page.getByRole('heading',{name:'Scene Score Advisor',exact:true}).waitFor();await idle();
  await b('Learn from my ratings').click();await idle();await b('Review labels').click();
  await page.getByText(/1 automatically excluded/).waitFor();
  const search=page.getByRole('searchbox',{name:'Search tags',exact:true});await search.fill('Natural');
  await page.getByRole('heading',{name:'Natural light',exact:true}).waitFor();
  assert.equal(await page.locator('.ssa-effect-zero').count(),1);
  await b('Accept').click();await idle();await page.getByText(/No labels left in this review queue/).waitFor();
  await b('Undo last decision').click();await idle();await page.getByRole('heading',{name:'Natural light',exact:true}).waitFor();
  await b('Skip for now').click();await idle();await page.getByRole('combobox',{name:'Review filter'}).selectOption('skipped');
  await page.getByRole('heading',{name:'Natural light',exact:true}).waitFor();
  await b('Score lower').click();const exact=page.getByRole('spinbutton',{name:'Exact contribution'});
  await exact.fill('-0.5');await page.getByText('3.0 → 2.5 / 5',{exact:true}).waitFor();
  await page.screenshot({path:'.test-runtime/review-scale.png',fullPage:true});
  await b('Save correction and next').click();await idle();
  await page.reload();await page.getByRole('heading',{name:'Scene Score Advisor',exact:true}).waitFor();await idle();
  await b('Review labels').click();await page.getByRole('combobox',{name:'Review filter'}).selectOption('reviewed');
  await search.fill('Natural');await page.getByText('-0.50 stars',{exact:true}).waitFor();
  await b('Learn from my ratings').click();await idle();await page.getByText('-0.50 stars',{exact:true}).waitFor();
  // A failed save must keep the current label and decision visible, without advancing.
  await page.route('**/graphql',async route=>{
   const q=route.request().postDataJSON()?.query||'';
   if(q.includes('mutation AdvisorSave'))return route.fulfill({json:{errors:[{message:'Test save failure'}]}});
   return route.fallback();
  });
  await b('Ignore').click();await page.getByRole('alert').filter({hasText:'Decision not saved'}).waitFor();
  await page.getByText('-0.50 stars',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.test-runtime/review-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: review, scale, accept, undo, skip, correction, persistence, retraining, custom metadata, save failure, mobile.');
 }catch(e){await page.screenshot({path:'.test-runtime/review-failure.png',fullPage:true});throw e;}finally{await browser.close();}
})();
