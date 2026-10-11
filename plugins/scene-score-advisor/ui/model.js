(function (root) {
  'use strict';
  const clamp = n => Math.max(20, Math.min(100, n));
  const rated = s => Number.isFinite(s.rating100) && s.rating100 > 0 && s.rating100 <= 100;
  const ids = s => [...new Set((s.tags || []).map(t => String(t.id)))];
  const metaName = name => /^(?:Screened|Absent):\s*/i.test(name) || /^Marker Compilations\s*[·:]/i.test(name);
  const excluded = name => metaName(name) || /^(?:scene[\s/_-]*)?(?:rated|rating|score)[\s:/_-]*\d+(?:\.\d+)?(?:\s*(?:stars?|\/\s*(?:5|100)))?$/i.test(name) || /^suggested[\s/_-]*(?:score|rating)/i.test(name);
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  function catalog(scenes, metaIds = []) {
    const meta = new Set(metaIds);
    const tags = new Map();
    scenes.forEach(s => (s.tags || []).forEach(t => {
      const key = String(t.id);
      if (!tags.has(key)) tags.set(key, {id:key, name:t.name, count:0, blocked:excluded(t.name)||meta.has(key), reason:metaName(t.name)||meta.has(key)?'Compilation status label':'Rating-derived name'});
    }));
    scenes.filter(rated).forEach(s => ids(s).forEach(id => { tags.get(id).count++; }));
    return [...tags.values()].sort((a,b) => a.name.localeCompare(b.name));
  }
  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
    return result >>> 0;
  }
  function entityFeatures(scene,inputs={}) {
    const result=[];
    if(inputs.performers)for(const p of scene.performers||[])result.push({id:'@performer:'+p.id,name:'Performer: '+(p.name||p.id),kind:'performer'});
    if(inputs.studios && scene.studio)result.push({id:'@studio:'+scene.studio.id,name:'Studio: '+(scene.studio.name||scene.studio.id),kind:'studio'});
    return [...new Map(result.map(e=>[e.id,e])).values()];
  }
  function inputName(inputs={}) {
    return 'Labels'+(inputs.performers?' + performers':'')+(inputs.studios?' + studios':'');
  }
  async function fit(scenes, ignored = {}, lambda = 10, guidance = null, inputs = {}) {
    if (!scenes.length) throw new Error('No rated scenes available.');
    const source=scenes;
    const entityMap=new Map(source.flatMap(s=>entityFeatures(s,inputs)).map(e=>[e.id,e]));
    scenes=source.map(s=>({...s,tags:[...(s.tags||[]),...entityFeatures(s,inputs)]}));
    const tags = catalog(scenes).filter(t => !t.blocked && !ignored[t.id] && (t.count >= (entityMap.has(t.id)?5:3) || (!entityMap.has(t.id)&&Number.isFinite(guidance?.[t.id]?.weight))));
    const index = new Map(tags.map((t,i) => [t.id,i]));
    const columns = tags.map(() => []);
    scenes.forEach((s,row) => ids(s).forEach(id => { if (index.has(id)) columns[index.get(id)].push(row); }));
    let baseline = scenes.reduce((sum,s) => sum+s.rating100,0)/scenes.length;
    const weights = new Float64Array(tags.length);
    const residual = Float64Array.from(scenes, s => s.rating100-baseline);
    let converged = false;
    for (let sweep=0; sweep<600; sweep++) {
      const shift = residual.reduce((sum,n) => sum+n,0)/residual.length;
      baseline += shift;
      for (let row=0; row<residual.length; row++) residual[row]-=shift;
      let maxChange = Math.abs(shift);
      columns.forEach((rows,col) => {
        const previous = weights[col];
        let sum = 0;
        rows.forEach(row => { sum += residual[row]+previous; });
        const entity=entityMap.has(tags[col].id);
        const penalty=entity?40:lambda;
        const rule=entity?null:guidance?.[tags[col].id];
        const manual=Number.isFinite(rule?.weight);
        const target=manual?(rule.guidanceWeight ?? rule.weight):0;
        let next = manual ? (sum+2*target)/(rows.length+penalty+2) : sum/(rows.length+penalty);
        if(manual) {
          if(rule.locked || rows.length<3 || target===0) next=rule.weight;
          else next=target>0?Math.min(100,Math.max(0,next)):Math.max(-100,Math.min(0,next));
        }
        weights[col] = next;
        const change = next-previous;
        rows.forEach(row => { residual[row]-=change; });
        maxChange = Math.max(maxChange,Math.abs(change));
      });
      if (maxChange < 0.0001) { converged=true; break; }
      if (sweep%5===0) await pause();
    }
    if (!converged) throw new Error('The model did not converge. Exclude redundant tags and try again.');
    const fitted=tags.map((t,i)=>({...t,weight:weights[i]}));
    return {baseline,tags:fitted.filter(t=>!entityMap.has(t.id)),entities:fitted.filter(t=>entityMap.has(t.id)).map(t=>({...t,kind:entityMap.get(t.id).kind})),inputs:{performers:!!inputs.performers,studios:!!inputs.studios}};
  }
  function createPredictor(model, rules = {}) {
    if (!model) return () => null;
    const learned = new Map(model.tags.map(t => [t.id,t]));
    const entities=new Map((model.entities||[]).map(t=>[t.id,t]));
    return function (scene) {
    const contributions = [], unknown = [];
    let raw = model.baseline;
    for (const id of ids(scene)) {
      const tag = (scene.tags || []).find(t => String(t.id)===id);
      const rule = rules[id] || {}, entry = learned.get(id);
      if (excluded(tag.name) || rule.ignore) continue;
      const manual = Number.isFinite(rule.weight);
      if (!manual && !entry) { unknown.push(tag.name); continue; }
      const value = manual ? rule.weight : entry.weight;
      raw += value;
      contributions.push({id, name:tag.name, value, count:entry ? entry.count : 0, manual});
    }
    if(model.inputs?.performers && !(scene.performers||[]).length)unknown.push('Performer metadata unavailable');
    if(model.inputs?.studios && !scene.studio)unknown.push('Studio metadata unavailable');
    for(const entity of entityFeatures(scene,model.inputs)) {
      const entry=entities.get(entity.id);
      if(!entry){unknown.push(entity.name);continue;}
      raw+=entry.weight;contributions.push({...entity,value:entry.weight,count:entry.count,manual:false});
    }
    contributions.sort((a,b) => Math.abs(b.value)-Math.abs(a.value));
    return {score:clamp(raw), raw, baseline:model.baseline, contributions, unknown,
      limited:contributions.length===0 || unknown.length>0 || contributions.some(t=>!t.manual && t.count<10)};
    };
  }
  function predict(scene, model, rules = {}) { return createPredictor(model,rules)(scene); }
  async function train(scenes, rules = {}) {
    const rows = scenes.filter(rated);
    if (rows.length<10) throw new Error('Rate at least 10 scenes before learning tag weights.');
    const ignored = Object.fromEntries(Object.entries(rules).filter(([,r]) => r.ignore).map(([id])=>[id,true]));
    let validation = null;
    if (rows.length>=20) {
      const sorted = rows.slice().sort((a,b)=>hash(a.id)-hash(b.id) || String(a.id).localeCompare(String(b.id)));
      const size = Math.max(4,Math.floor(sorted.length*0.2));
      const test = sorted.slice(0,size), training = sorted.slice(size);
      const candidate = await fit(training,ignored);
      const mean = training.reduce((sum,s)=>sum+s.rating100,0)/training.length;
      const predictTest = createPredictor(candidate);
      const mae = test.reduce((sum,s)=>sum+Math.abs(predictTest(s).score-s.rating100),0)/test.length;
      const baselineMae = test.reduce((sum,s)=>sum+Math.abs(clamp(mean)-s.rating100),0)/test.length;
      validation = {count:size, mae, baselineMae};
    }
    const fitted = await fit(rows,ignored);
    return {...fitted, version:1, trainedAt:new Date().toISOString(), ratedCount:rows.length, validation,
      exclusionRevision:2, ignored:Object.keys(ignored).sort(), fingerprint:fingerprint(scenes)};
  }
  function adjustedRules(rules, model) {
    const result=JSON.parse(JSON.stringify(rules));
    for(const tag of model.tags) {
      const rule=result[tag.id];
      if(rule && !rule.ignore && Number.isFinite(rule.weight) && !rule.locked && tag.count>=3) {
        rule.guidanceWeight=rule.guidanceWeight ?? rule.weight;
        rule.weight=tag.weight;
      }
    }
    return result;
  }
  function scoreSummary(scenes,model,rules) {
    const predict=createPredictor(model,rules);
    let above=0,top=0,maxRaw=-Infinity,error=0,count=0;
    for(const scene of scenes) {
      const p=predict(scene);if(!p)continue;
      if(p.raw>100)above++;if(p.score>=99)top++;
      maxRaw=Math.max(maxRaw,p.raw);
      if(rated(scene)){error+=Math.abs(p.score-scene.rating100);count++;}
    }
    return {count:scenes.length,above,top,maxRaw:Number.isFinite(maxRaw)?maxRaw:null,mae:count?error/count:null};
  }
  async function recalibrate(scenes,state) {
    const rows=scenes.filter(rated);
    if(rows.length<20)throw new Error('Rate at least 20 scenes for a recalibration preview with a held-out check.');
    const rules=effectiveRules(state);
    const ignored=Object.fromEntries(Object.entries(rules).filter(([,r])=>r.ignore).map(([id])=>[id,true]));
    const sorted=rows.slice().sort((a,b)=>hash(a.id)-hash(b.id)||String(a.id).localeCompare(String(b.id)));
    const size=Math.max(4,Math.floor(rows.length*0.2)), test=sorted.slice(0,size), training=sorted.slice(size);
    const fixed=Object.fromEntries(Object.entries(rules).map(([id,r])=>[id,{...r,locked:true}]));
    const beforeFit=await fit(training,ignored,10,state.model?.guided?fixed:null,state.model?.inputs);
    const afterFit=await fit(training,ignored,10,rules,state.model?.inputs);
    const beforeCheck=scoreSummary(test,beforeFit,rules);
    const afterCheck=scoreSummary(test,afterFit,adjustedRules(rules,afterFit));
    const fitted=await fit(rows,ignored,10,rules,state.model?.inputs);
    const mean=training.reduce((sum,r)=>sum+r.rating100,0)/training.length;
    const baselineMae=test.reduce((sum,s)=>sum+Math.abs(clamp(mean)-s.rating100),0)/test.length;
    const model={...fitted,version:1,trainedAt:new Date().toISOString(),ratedCount:rows.length,
      validation:{count:size,mae:afterCheck.mae,baselineMae,guided:true},
      exclusionRevision:2,ignored:Object.keys(ignored).sort(),fingerprint:fingerprint(scenes,fitted.inputs),guided:true};
    const proposed=adjustedRules(state.rules,model);
    const effective=effectiveRules({...state,rules:proposed});
    const oldWeights=new Map((state.model?.tags||[]).map(t=>[t.id,t.weight]));
    const changes=model.tags.map(tag=>({id:tag.id,name:tag.name,before:Number.isFinite(state.rules[tag.id]?.weight)?state.rules[tag.id].weight:oldWeights.get(tag.id)||0,after:tag.weight})).filter(t=>Math.abs(t.after-t.before)>=0.01).sort((a,b)=>Math.abs(b.after-b.before)-Math.abs(a.after-a.before));
    return {model,rules:proposed,changes,heldOut:{count:size,before:beforeCheck.mae,after:afterCheck.mae},
      before:scoreSummary(scenes,state.model,rules),after:scoreSummary(scenes,model,effective)};
  }
  async function compareInputs(scenes,state) {
    const rows=scenes.filter(rated);
    if(rows.length<20)throw new Error('Rate at least 20 scenes to compare prediction inputs.');
    const rules=effectiveRules(state),ignored=Object.fromEntries(Object.entries(rules).filter(([,r])=>r.ignore).map(([id])=>[id,true]));
    const sorted=rows.slice().sort((a,b)=>hash(a.id)-hash(b.id)||String(a.id).localeCompare(String(b.id)));
    const size=Math.max(4,Math.floor(rows.length*0.2)),test=sorted.slice(0,size),training=sorted.slice(size);
    const mean=training.reduce((n,s)=>n+s.rating100,0)/training.length;
    const baselineMae=test.reduce((n,s)=>n+Math.abs(clamp(mean)-s.rating100),0)/test.length;
    const candidates=[];
    for(const inputs of [{},{performers:true},{studios:true},{performers:true,studios:true}]) {
      const trial=await fit(training,ignored,10,rules,inputs);
      const error=scoreSummary(test,trial,adjustedRules(rules,trial)).mae;
      const fitted=await fit(rows,ignored,10,rules,inputs);
      const model={...fitted,version:1,guided:true,trainedAt:new Date().toISOString(),ratedCount:rows.length,
        validation:{count:size,mae:error,baselineMae,guided:true,comparison:true},exclusionRevision:2,
        ignored:Object.keys(ignored).sort(),fingerprint:fingerprint(scenes,inputs)};
      const proposed=adjustedRules(state.rules,model);
      candidates.push({name:inputName(inputs),model,rules:proposed,error,entityCount:fitted.entities.length,
        summary:scoreSummary(scenes,model,effectiveRules({...state,rules:proposed}))});
    }
    candidates.forEach((c,i)=>{c.improved=i===0||c.error<candidates[0].error-0.000001;});
    let best=0;candidates.forEach((c,i)=>{if(c.error<candidates[best].error-0.000001)best=i;});
    return {count:size,candidates,best};
  }
  function fingerprint(scenes,inputs={}) {
    if(inputs.performers||inputs.studios)return hash(JSON.stringify([fingerprint(scenes),scenes.filter(rated).map(s=>[String(s.id),entityFeatures(s,inputs).map(e=>e.id).sort()]).sort((a,b)=>a[0].localeCompare(b[0]))]));
    return hash(JSON.stringify(scenes.filter(rated).map(s=>[String(s.id),s.rating100,(s.tags||[]).map(t=>[String(t.id),t.name]).sort((a,b)=>a[0].localeCompare(b[0]))]).sort((a,b)=>a[0].localeCompare(b[0]))));
  }
  function effectiveRules(state) {
    const rules={...state.rules};
    for (const id of state.metaIds || []) rules[id]={...rules[id],ignore:true};
    return rules;
  }
  function reviewStatus(rule = {}, weight = 0) {
    if (rule.review==='skipped') return 'skipped';
    if (rule.ignore) return 'ignored';
    if (Number.isFinite(rule.weight)) return 'corrected';
    if (rule.review==='accepted' && Number.isFinite(rule.acceptedWeight)) {
      const changed=Math.abs(weight-rule.acceptedWeight)>=5 || (weight*rule.acceptedWeight<0 && Math.abs(weight-rule.acceptedWeight)>=2);
      return changed?'changed':'accepted';
    }
    return 'unreviewed';
  }
  function decisionRule(rule, decision, learnedWeight = 0, correction) {
    const next={...rule,reviewedAt:new Date().toISOString()};
    if (decision==='accept') return {...next,ignore:false,weight:null,locked:false,guidanceWeight:null,review:'accepted',acceptedWeight:learnedWeight};
    if (decision==='ignore') return {...next,ignore:true,review:'ignored'};
    if (decision==='skip') return {...next,review:'skipped'};
    if (decision==='correct') {
      if (!Number.isFinite(correction) || Math.abs(correction)>100) throw new Error('Use a contribution between −5 and +5 stars.');
      return {...next,ignore:false,weight:correction,guidanceWeight:correction,review:'corrected'};
    }
    if (decision==='lock') return {...next,locked:!!correction};
    if (decision==='reset') return {};
    throw new Error('Unknown review decision.');
  }
  function validateState(state) {
    if (!state || state.version!==1 || !state.rules || typeof state.rules!=='object' || Array.isArray(state.rules)) throw new Error('Unsupported saved advisor settings.');
    Object.values(state.rules).forEach(r=>{
      if (!r || (r.guidanceWeight!=null && (!Number.isFinite(r.guidanceWeight)||Math.abs(r.guidanceWeight)>100)) || (r.locked!=null && typeof r.locked!=='boolean') || (r.weight!=null && (!Number.isFinite(r.weight) || Math.abs(r.weight)>100)) || (r.ignore!=null && typeof r.ignore!=='boolean')) throw new Error('Invalid saved tag rule.');
    });
    if (state.metaIds && (!Array.isArray(state.metaIds) || !state.metaIds.every(id=>typeof id==='string'))) throw new Error('Invalid automatic exclusions.');
    const m=state.model;
    if (m && (m.version!==1 || !Number.isFinite(m.baseline) || !Array.isArray(m.tags) || !m.tags.every(t=>typeof t.id==='string' && Number.isFinite(t.weight) && Number.isFinite(t.count)))) throw new Error('Invalid saved model.');
    if(m?.inputs && ['performers','studios'].some(k=>typeof m.inputs[k]!=='boolean'))throw new Error('Invalid model inputs.');
    if(m?.entities && (!Array.isArray(m.entities)||!m.entities.every(t=>typeof t.id==='string'&&Number.isFinite(t.weight)&&Number.isFinite(t.count)&&['performer','studio'].includes(t.kind))))throw new Error('Invalid entity weights.');
    return state;
  }
  const api = {compareInputs,entityFeatures,inputName,recalibrate,adjustedRules,scoreSummary,effectiveRules,reviewStatus,decisionRule,metaName,clamp,rated,excluded,catalog,fit,createPredictor,predict,train,fingerprint,validateState};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.SceneScoreAdvisorModel=api;
})(typeof window!=='undefined' ? window : globalThis);
