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
  async function fit(scenes, ignored = {}, lambda = 10) {
    if (!scenes.length) throw new Error('No rated scenes available.');
    const tags = catalog(scenes).filter(t => !t.blocked && !ignored[t.id] && t.count >= 3);
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
        const next = sum/(rows.length+lambda);
        weights[col] = next;
        const change = next-previous;
        rows.forEach(row => { residual[row]-=change; });
        maxChange = Math.max(maxChange,Math.abs(change));
      });
      if (maxChange < 0.0001) { converged=true; break; }
      if (sweep%5===0) await pause();
    }
    if (!converged) throw new Error('The model did not converge. Exclude redundant tags and try again.');
    return {baseline, tags:tags.map((t,i) => ({...t, weight:weights[i]}))};
  }
  function createPredictor(model, rules = {}) {
    if (!model) return () => null;
    const learned = new Map(model.tags.map(t => [t.id,t]));
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
  function fingerprint(scenes) {
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
    if (decision==='accept') return {...next,ignore:false,weight:null,review:'accepted',acceptedWeight:learnedWeight};
    if (decision==='ignore') return {...next,ignore:true,review:'ignored'};
    if (decision==='skip') return {...next,review:'skipped'};
    if (decision==='correct') {
      if (!Number.isFinite(correction) || Math.abs(correction)>100) throw new Error('Use a contribution between −5 and +5 stars.');
      return {...next,ignore:false,weight:correction,review:'corrected'};
    }
    if (decision==='reset') return {};
    throw new Error('Unknown review decision.');
  }
  function validateState(state) {
    if (!state || state.version!==1 || !state.rules || typeof state.rules!=='object' || Array.isArray(state.rules)) throw new Error('Unsupported saved advisor settings.');
    Object.values(state.rules).forEach(r=>{
      if (!r || (r.weight!=null && (!Number.isFinite(r.weight) || Math.abs(r.weight)>100)) || (r.ignore!=null && typeof r.ignore!=='boolean')) throw new Error('Invalid saved tag rule.');
    });
    if (state.metaIds && (!Array.isArray(state.metaIds) || !state.metaIds.every(id=>typeof id==='string'))) throw new Error('Invalid automatic exclusions.');
    const m=state.model;
    if (m && (m.version!==1 || !Number.isFinite(m.baseline) || !Array.isArray(m.tags) || !m.tags.every(t=>typeof t.id==='string' && Number.isFinite(t.weight) && Number.isFinite(t.count)))) throw new Error('Invalid saved model.');
    return state;
  }
  const api = {effectiveRules,reviewStatus,decisionRule,metaName,clamp,rated,excluded,catalog,fit,createPredictor,predict,train,fingerprint,validateState};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.SceneScoreAdvisorModel=api;
})(typeof window!=='undefined' ? window : globalThis);
