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
