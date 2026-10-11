const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../plugins/scene-score-advisor/ui/model.js');
function samples(n=100) {
  return Array.from({length:n},(_,i)=>({id:String(i+1),rating100:60+(i%2?20:0)-(i%4>=2?20:0),tags:[...(i%2?[{id:'positive',name:'Positive'}]:[]),...(i%4>=2?[{id:'negative',name:'Negative'}]:[])]}));
}
test('learns positive and negative contributions and beats a mean prediction on unseen rows',async()=>{
  const scenes=samples(), original=JSON.stringify(scenes), model=await M.train(scenes);
  assert.equal(JSON.stringify(scenes),original);
  assert.ok(model.tags.find(t=>t.id==='positive').weight>10);
  assert.ok(model.tags.find(t=>t.id==='negative').weight< -10);
  assert.ok(model.validation.mae<model.validation.baselineMae);
  assert.equal(model.validation.count,20);
  assert.ok(Math.abs(M.predict(scenes[1],model).score-80)<10);
});
test('unrated scenes do not influence the model; rare and answer-derived tags are excluded',async()=>{
  const scenes=samples();scenes[0].tags.push({id:'rare',name:'Rare'});
  scenes.forEach(s=>s.tags.push({id:'answer'+s.rating100,name:'scene-rated-'+s.rating100}));
  const a=await M.train(scenes),b=await M.train([...scenes,{id:'unrated',rating100:null,tags:[{id:'rare',name:'Rare'}]}]);
  assert.equal(a.baseline,b.baseline);assert.deepEqual(a.tags,b.tags);
  assert.ok(!a.tags.some(t=>t.id==='rare'||t.id.startsWith('answer')));
});
test('manual overrides replace learned weights, ignore wins, duplicate tags do not double count, scores clamp',()=>{
  const model={baseline:60,tags:[{id:'a',weight:10,count:25}]};
  const scene={tags:[{id:'a',name:'A'},{id:'a',name:'A'}]};
  assert.equal(M.predict(scene,model).score,70);
  assert.equal(M.predict(scene,model,{a:{weight:-20}}).score,40);
  assert.equal(M.predict(scene,model,{a:{weight:100}}).score,100);
  assert.equal(M.predict(scene,model,{a:{weight:-100}}).score,20);
  assert.equal(M.predict(scene,model,{a:{weight:100,ignore:true}}).score,60);
});
test('too little training data is explicit and under 20 rows skips validation',async()=>{
  await assert.rejects(()=>M.train(samples(9)),/at least 10/);
  assert.equal((await M.train(samples(12))).validation,null);
});
test('constant ratings and co-occurring tags stay finite',async()=>{
  const scenes=samples().map(s=>({...s,rating100:80,tags:[{id:'a',name:'A'},{id:'b',name:'B'}]}));
  const model=await M.train(scenes);
  assert.equal(model.baseline,80);assert.ok(model.tags.every(t=>t.weight===0));
});
test('ignored tags never enter training and unknown tags are disclosed',async()=>{
  const model=await M.train(samples(),{positive:{ignore:true}});
  assert.ok(!model.tags.some(t=>t.id==='positive'));
  const prediction=M.predict({tags:[{id:'new',name:'New'}]},model);
  assert.deepEqual(prediction.unknown,['New']);assert.ok(prediction.limited);
});
test('fingerprint tracks rating/tag changes but not order or unrated scenes',()=>{
  const scenes=samples();const before=M.fingerprint(scenes);
  assert.equal(M.fingerprint(scenes.slice().reverse()),before);
  assert.equal(M.fingerprint([...scenes,{id:'x',rating100:null,tags:[]}]),before);
  scenes[0].rating100=100;assert.notEqual(M.fingerprint(scenes),before);
});
test('persisted state survives round trip and rejects bad numbers or versions',async()=>{
  const state={version:1,model:await M.train(samples()),rules:{positive:{weight:20}}};
  assert.deepEqual(M.validateState(JSON.parse(JSON.stringify(state))),state);
  assert.throws(()=>M.validateState({...state,version:2}));
  assert.throws(()=>M.validateState({...state,rules:{x:{weight:'20'}}}));
});
test('compilation status labels never enter learning or predictions, including custom IDs',async()=>{
  const scenes=samples().map(s=>({...s,tags:[...s.tags,{id:'meta1',name:'Screened: Project / label'},{id:'meta2',name:'Absent: Project / label'},{id:'meta3',name:'Marker Compilations · Rendered'},{id:'custom',name:'My custom done label'}]}));
  const state={rules:{custom:{weight:100}},metaIds:['custom']};
  const rules=M.effectiveRules(state),model=await M.train(scenes,rules);
  assert.ok(model.tags.every(t=>!t.id.startsWith('meta')&&t.id!=='custom'));
  assert.ok(M.catalog(scenes,state.metaIds).find(t=>t.id==='custom').blocked);
  const oldModel={baseline:60,tags:[{id:'meta1',weight:40,count:100},{id:'custom',weight:40,count:100}]};
  assert.equal(M.predict({tags:[{id:'meta1',name:'Screened: Project / label'},{id:'custom',name:'My custom done label'}]},oldModel,rules).score,60);
});
test('accept follows learning and reopens after substantial change or sign reversal',()=>{
  const rule=M.decisionRule({},'accept',10);
  assert.equal(M.reviewStatus(rule,12),'accepted');
  assert.equal(M.reviewStatus(rule,16),'changed');
  assert.equal(M.reviewStatus(M.decisionRule({},'accept',1),-1),'changed');
  assert.equal(rule.weight,null);
});
test('correction reverses direction, survives learning, and skip preserves its contribution',async()=>{
  const rule=M.decisionRule({},'correct',-10,20);
  assert.equal(M.reviewStatus(rule,-50),'corrected');
  const rules={negative:rule},model=await M.train(samples(),rules);
  assert.equal(M.predict({tags:[{id:'negative',name:'Negative'}]},model,rules).contributions[0].value,20);
  const skipped=M.decisionRule(rule,'skip');
  assert.equal(M.reviewStatus(skipped),'skipped');assert.equal(skipped.weight,20);
  assert.equal(M.decisionRule(rule,'ignore').ignore,true);
  assert.deepEqual(M.decisionRule(rule,'reset'),{});
  assert.throws(()=>M.decisionRule({},'correct',0,101));
});
test('guided recalibration reduces saturation while preserving direction and the original state',async()=>{
 const scenes=samples();
 const model=await M.train(scenes);
 const state={version:1,model,rules:{positive:{weight:80,review:'corrected'},negative:{weight:-5,review:'corrected'}}};
 const original=JSON.stringify(state),preview=await M.recalibrate(scenes,state);
 assert.equal(JSON.stringify(state),original);
 assert.ok(preview.rules.positive.weight>=0&&preview.rules.positive.weight<80);
 assert.ok(preview.rules.negative.weight<=0);
 assert.equal(preview.rules.positive.guidanceWeight,80);
 assert.ok(preview.after.above<preview.before.above);
 assert.ok(preview.heldOut.after<preview.heldOut.before);
 assert.equal(preview.model.guided,true);
 assert.equal(preview.heldOut.count,20);
 M.validateState({...state,model:preview.model,rules:preview.rules});
});
test('recalibration respects locks, zero corrections, exclusions and unsupported corrections',async()=>{
 const scenes=samples();scenes[0].tags.push({id:'rare',name:'Rare'});
 const state={version:1,model:await M.train(scenes),metaIds:['positive'],rules:{positive:{weight:50},negative:{weight:-12,locked:true},rare:{weight:17},missing:{weight:29}}};
 const p=await M.recalibrate(scenes,state);
 assert.equal(p.rules.negative.weight,-12);assert.equal(p.rules.rare.weight,17);assert.equal(p.rules.missing.weight,29);
 assert.ok(!p.model.tags.some(t=>t.id==='positive'));
 const zero=await M.recalibrate(scenes,{...state,metaIds:[],rules:{positive:{weight:0}}});
 assert.equal(zero.rules.positive.weight,0);
 await assert.rejects(()=>M.recalibrate(samples(19),state),/at least 20/);
});
test('fresh correction replaces prior guidance; repeated recalibration retains its direction',async()=>{
 const scenes=samples(),state={version:1,model:await M.train(scenes),rules:{positive:{weight:50}}};
 const p=await M.recalibrate(scenes,state);
 const second=await M.recalibrate(scenes,{...state,model:p.model,rules:p.rules});
 assert.equal(second.rules.positive.guidanceWeight,50);
 assert.ok(second.rules.positive.weight>=0);
 const corrected=M.decisionRule(second.rules.positive,'correct',0,-10);
 assert.equal(corrected.guidanceWeight,-10);
 assert.equal(M.decisionRule(corrected,'lock',0,true).locked,true);
});
