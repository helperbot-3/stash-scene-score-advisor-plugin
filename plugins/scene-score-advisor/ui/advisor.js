(function () {
  'use strict';
  const api=window.PluginApi, M=window.SceneScoreAdvisorModel;
  if (!api || !M) return;
  const R=api.React, h=R.createElement, {useState,useEffect,useMemo}=R;
  const {gql,useApolloClient}=api.libraries.Apollo, Link=api.libraries.ReactRouterDOM.Link;
  const ID='scene-score-advisor';
  const CONFIG=gql`query AdvisorConfig { configuration { plugins(include:["scene-score-advisor"]) } }`;
  const SAVE=gql`mutation AdvisorSave($input:Map!) { configurePlugin(plugin_id:"scene-score-advisor",input:$input) }`;
  const SCENES=gql`query AdvisorScenes($page:Int!) { findScenes(filter:{page:$page,per_page:500,sort:"id",direction:ASC}) { count scenes { id title rating100 tags { id name } } } }`;
  const empty=()=>({version:1,model:null,rules:{},metaIds:[],history:[]});
  const PLUGINS=gql`query AdvisorPlugins { plugins { id enabled } }`;
  const META=gql`mutation AdvisorReadMeta { runPluginOperation(plugin_id:"marker-compilations",args:{action:"screening_list"}) }`;
  async function discoverMeta(client,known=[]) {
    const {data}=await client.query({query:PLUGINS,fetchPolicy:'network-only'});
    if(!data.plugins.some(p=>p.id==='marker-compilations'&&p.enabled))return known;
    const result=await client.mutate({mutation:META});
    const projects=result.data.runPluginOperation;
    if(!Array.isArray(projects))throw new Error('Unexpected screening metadata response.');
    const ids=new Set(known);
    projects.forEach(p=>(p.targets||[]).forEach(t=>['screened_tag_id','absent_tag_id'].forEach(k=>{if(t[k])ids.add(String(t[k]));})));
    return [...ids].sort();
  }
  const stars=n=>(n/20).toFixed(1);
  const delta=n=>{const value=Math.round(n*5)/100;return (value>=0?'+':'')+value.toFixed(2);};
  const button=(label,onClick,disabled=false,props={})=>h('button',{type:'button',onClick,disabled,...props},label);
  async function loadState(client) {
    const {data}=await client.query({query:CONFIG,fetchPolicy:'network-only'});
    const config=data.configuration.plugins[ID] || {};
    return config.state ? M.validateState(JSON.parse(config.state)) : empty();
  }
  async function saveState(client,state) {
    M.validateState(state);
    await client.mutate({mutation:SAVE,variables:{input:{state:JSON.stringify(state)}}});
    window.dispatchEvent(new Event('scene-score-advisor-saved'));
  }
  function Breakdown({result}) {
    return h('div',{className:'ssa-breakdown'},
      h('p',null,'Starting score ',h('strong',null,stars(result.baseline),' / 5')),
      result.contributions.length ? h('ul',null,result.contributions.map(t=>h('li',{key:t.id},
        h('span',null,t.name,t.manual && h('small',null,' · manual')),
        h('strong',{className:t.value>=0?'ssa-positive':'ssa-negative'},delta(t.value))))) : h('p',null,'No weighted tags. This suggestion uses the starting score.'),
      result.raw!==result.score && h('p',null,'Adjusted to stay within 1–5.'),
      result.unknown.length>0 && h('p',null,'No learned weight: ',result.unknown.join(', ')),
      result.limited && h('p',{className:'ssa-muted'},'Limited tag evidence. This is an estimate, not a confidence percentage.'));
  }
  function EffectScale({value}) {
    const effect=value/20, shown=Math.max(-1,Math.min(1,effect));
    const magnitude=Math.abs(effect), label=magnitude<0.1?'Very small':magnitude<0.25?'Small':magnitude<0.5?'Moderate':magnitude<1?'Large':'Very large';
    return h('div',{className:'ssa-effect'},
      h('div',{className:'ssa-effect-heading'},h('strong',null,delta(value),' stars'),h('span',null,label,' effect')),
      h('div',{className:'ssa-effect-track',role:'img','aria-label':delta(value)+' stars; '+label.toLowerCase()+' effect, on a scale from minus one to plus one star'},
        h('span',{className:'ssa-effect-fill '+(value<0?'negative':'positive'),style:{left:(value<0?50+shown*50:50)+'%',width:Math.abs(shown)*50+'%'}}),
        h('span',{className:'ssa-effect-zero'})),
      h('div',{className:'ssa-effect-labels'},h('span',null,'−1 star'),h('span',null,'No effect'),h('span',null,'+1 star')),
      magnitude>1&&h('small',null,'Beyond the displayed scale; exact effect shown above.'),
      h('p',null,'For a scene otherwise scoring 3.0: ',h('strong',null,'3.0 → ',stars(M.clamp(60+value)),' / 5'),'. ',60+value!==M.clamp(60+value)&&'Limited to the 1–5 range.'));
  }
  function ReviewQueue({tags,weights,rules,scenes,busy,onDecision,onUndo,canUndo,query}) {
    const [filter,setFilter]=useState('pending'),[focus,setFocus]=useState(null),[direction,setDirection]=useState(null),[draft,setDraft]=useState(0);
    const eligible=tags.filter(t=>!t.blocked);
    const status=t=>M.reviewStatus(rules[t.id],weights.get(t.id)?.weight||0);
    const pending=eligible.filter(t=>['unreviewed','changed'].includes(status(t))).length;
    const queue=eligible.filter(t=>t.name.toLowerCase().includes(query.toLowerCase()) && (filter==='all'||(filter==='pending'?['unreviewed','changed'].includes(status(t)):filter==='reviewed'?['accepted','corrected','ignored'].includes(status(t)):status(t)==='skipped')))
      .sort((a,b)=>Math.abs(weights.get(b.id)?.weight||0)-Math.abs(weights.get(a.id)?.weight||0)||a.name.localeCompare(b.name));
    const current=queue.find(t=>t.id===focus)||queue[0];
    const learned=current?weights.get(current.id):null, rule=current?(rules[current.id]||{}):{};
    const value=rule.ignore?0:Number.isFinite(rule.weight)?rule.weight:learned?.weight||0;
    useEffect(()=>setDirection(null),[current?.id]);
    async function decide(kind,correction) {
      const index=queue.findIndex(t=>t.id===current.id),next=queue[index+1]||queue[0];
      if(await onDecision(current.id,kind,learned?.weight||0,correction)){setFocus(next?.id);setDirection(null);}
    }
    const examples=current?scenes.filter(s=>M.rated(s)&&s.tags.some(t=>String(t.id)===current.id)).sort((a,b)=>b.rating100-a.rating100):[];
    const samples=[...examples.slice(0,2),...examples.slice(-2)].filter((s,i,all)=>all.findIndex(t=>t.id===s.id)===i);
    return h('section',{className:'ssa-review'},
      h('div',{className:'ssa-toolbar'},h('div',null,h('h2',null,'Review your labels'),h('p',null,pending,' to review · ',eligible.length-pending,' accepted, corrected, ignored or deferred · ',tags.length-eligible.length,' automatically excluded')),
        h('select',{'aria-label':'Review filter',value:filter,onChange:e=>{setFilter(e.target.value);setFocus(null);setDirection(null);}},h('option',{value:'pending'},'Needs review'),h('option',{value:'skipped'},'Skipped for now'),h('option',{value:'reviewed'},'Reviewed'),h('option',{value:'all'},'All eligible labels')),
        button('Undo last decision',onUndo,busy||!canUndo)),
      current?h('article',{className:'ssa-review-card',key:current.id},
        h('div',{className:'ssa-eyebrow'},status(current)==='changed'?'Changed since you accepted it':status(current)),
        h('h2',null,current.name),h('p',{className:'ssa-muted'},current.count,' rated examples · ',learned?'Learned contribution '+delta(learned.weight)+' stars':'Not enough evidence for a learned weight',rule.ignore?' · Currently ignored':Number.isFinite(rule.weight)?' · Your correction is active':''),
        h(EffectScale,{value:direction?draft:value}),
        h('div',{className:'ssa-actions'},
          button('Accept',()=>decide('accept'),busy,{className:'ssa-primary',title:'Use the learned contribution and mark it reviewed'}),
          button('Ignore',()=>decide('ignore'),busy),
          button('Score lower',()=>{setDirection('lower');setDraft(Math.max(-100,value-5));},busy||value<=-100),
          button('Score higher',()=>{setDirection('higher');setDraft(Math.min(100,value+5));},busy||value>=100),
          button('Skip for now',()=>decide('skip'),busy),
          status(current)!=='unreviewed'&&button('Reset decision',()=>decide('reset'),busy)),
        direction&&h('div',{className:'ssa-adjustment'},
          h('label',null,'Your contribution in stars',h('input',{type:'range',min:-5,max:5,step:0.05,value:draft/20,disabled:busy,'aria-label':'Contribution slider',onChange:e=>setDraft(Number(e.target.value)*20)})),
          h('label',null,'Exact contribution',h('input',{type:'number',min:-5,max:5,step:0.05,value:Math.round(draft*5)/100,disabled:busy,'aria-label':'Exact contribution',onChange:e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))setDraft(Math.max(-100,Math.min(100,n*20)));}})),
          button('Save correction and next',()=>decide('correct',draft),busy||(direction==='lower'?draft>=value:draft<=value)),button('Cancel correction',()=>setDirection(null),busy),
          h('p',{className:'ssa-muted'},'This replaces the learned contribution and survives retraining. Move across zero to reverse its direction.')),
        h('details',null,h('summary',null,'Examples with this label (',examples.length,' rated scenes)'),samples.length?h('ul',null,samples.map(s=>h('li',{key:s.id},h(Link,{to:'/scenes/'+s.id,target:'_blank',rel:'noopener noreferrer'},s.title||'Scene '+s.id),' · ',stars(s.rating100),' / 5'))):h('p',null,'No rated examples.')),
        h('p',{className:'ssa-muted'},'Decisions save automatically. Accept follows future learning; changes of 0.25 stars, or a direction reversal of at least 0.10 stars, return for review. Effect sizes describe score movement, not statistical confidence.')):
        h('p',{className:'ssa-empty'},filter==='pending'?'No labels left in this review queue. Check skipped labels or review your earlier decisions.':'No labels match this filter.'));
  }
  function TagRule({tag,learned,rule,onChange,disabled}) {
    const [value,setValue]=useState(rule.weight==null?'':String(rule.weight/20));
    useEffect(()=>setValue(rule.weight==null?'':String(rule.weight/20)),[rule.weight]);
    function commit(e) {
      const text=e.currentTarget.value;
      if (text!=='' && (!Number.isFinite(Number(text)) || Math.abs(Number(text))>5)) {
        e.currentTarget.setCustomValidity('Use an adjustment between −5 and +5 stars.');
        e.currentTarget.reportValidity(); setValue(rule.weight==null?'':String(rule.weight/20)); return;
      }
      e.currentTarget.setCustomValidity('');
      onChange({...rule,weight:text===''?null:Number(text)*20});
    }
    return h('tr',null,h('td',null,tag.name,tag.blocked && h('small',{className:'ssa-muted'},' · '+tag.reason+'; excluded')),
      h('td',null,tag.count),h('td',{className:learned && learned.weight<0?'ssa-negative':'ssa-positive'},learned?delta(learned.weight):'—'),
      h('td',null,h('input',{type:'number',min:-5,max:5,step:0.05,value,placeholder:'Learned',disabled:disabled||tag.blocked||rule.ignore,
        'aria-label':'Adjustment for '+tag.name,onChange:e=>{e.target.setCustomValidity('');setValue(e.target.value);},onBlur:commit,onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur();}})),
      h('td',null,h('input',{type:'checkbox',checked:tag.blocked||!!rule.ignore,disabled:disabled||tag.blocked,'aria-label':'Ignore '+tag.name,onChange:e=>onChange({...rule,ignore:e.target.checked})})));
  }
  function Advisor() {
    const client=useApolloClient();
    const [state,setState]=useState(empty),[scenes,setScenes]=useState([]),[ready,setReady]=useState(false);
    const [busy,setBusy]=useState('Loading library…'),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
    const [tab,setTab]=useState('scenes'),[search,setSearch]=useState(''),[unrated,setUnrated]=useState(true),[page,setPage]=useState(1);
    const [sort,setSort]=useState('score'),[metaWarning,setMetaWarning]=useState('');
    async function refresh() {
      setBusy('Loading library…');setError('');
      try {
        const saved=await loadState(client);
        setMetaWarning('');
        try{saved.metaIds=await discoverMeta(client,saved.metaIds||[]);}catch(e){setMetaWarning('Could not read custom compilation status labels: '+e.message+'. Default names and previously discovered IDs remain excluded.');}
        let rows=[],current=1,total=Infinity;
        while(rows.length<total) {
          const {data}=await client.query({query:SCENES,variables:{page:current++},fetchPolicy:'network-only'});
          const result=data.findScenes;total=result.count;
          if(!result.scenes.length && rows.length<total)throw new Error('The library changed during loading. Reload and try again.');
          rows.push(...result.scenes);setBusy('Loading scenes: '+rows.length+' / '+total);
        }
        if(new Set(rows.map(s=>s.id)).size!==rows.length)throw new Error('The library changed during loading. Reload and try again.');
        setState(saved);setScenes(rows);setReady(true);setDirty(false);
      } catch(e){setError(e.message);} finally{setBusy('');}
    }
    useEffect(()=>{refresh();},[]);
    async function save(next=state) {
      setBusy('Saving settings…');setError('');
      try{await saveState(client,next);setState(next);setDirty(false);}catch(e){setError(e.message);}finally{setBusy('');}
    }
    async function learn() {
      setBusy('Learning and checking tag weights…');setError('');
      try {
        const model=await M.train(scenes,M.effectiveRules(state)), next={...state,model};
        setState(next);setDirty(true);
        await saveState(client,next);setDirty(false);
      }catch(e){setError(e.message);}finally{setBusy('');}
    }
    async function persistDecision(next) {
      setBusy('Saving review decision…');setError('');
      try{await saveState(client,next);setState(next);setDirty(false);return true;}
      catch(e){setError('Decision not saved: '+e.message);return false;}
      finally{setBusy('');}
    }
    async function reviewDecision(id,decision,learned,correction) {
      const history=[...(state.history||[]),{id,previous:state.rules[id]||null}].slice(-30);
      const nextRule=M.decisionRule(state.rules[id]||{},decision,learned,correction);
      return persistDecision({...state,history,rules:{...state.rules,[id]:nextRule}});
    }
    async function undoDecision() {
      const history=(state.history||[]).slice(),entry=history.pop();if(!entry)return;
      const rules={...state.rules};if(entry.previous)rules[entry.id]=entry.previous;else delete rules[entry.id];
      await persistDecision({...state,rules,history});
    }
    function rule(id,value){setState(s=>({...s,rules:{...s.rules,[id]:value}}));setDirty(true);}
    const tags=useMemo(()=>M.catalog(scenes,state.metaIds),[scenes,state.metaIds]);
    const ratedCount=useMemo(()=>scenes.filter(M.rated).length,[scenes]);
    const fingerprint=useMemo(()=>M.fingerprint(scenes),[scenes]);
    const weights=new Map((state.model?.tags||[]).map(t=>[t.id,t]));
    const results=useMemo(()=>{const predict=M.createPredictor(state.model,M.effectiveRules(state));return scenes.map(scene=>({scene,result:predict(scene)}));},[scenes,state]);
    const filtered=useMemo(()=>{
      const query=search.toLowerCase();
      return results.filter(({scene})=>(!unrated||!M.rated(scene)) && (scene.title||'Scene '+scene.id).toLowerCase().includes(query))
        .sort((a,b)=>sort==='title'?(a.scene.title||'').localeCompare(b.scene.title||''):(b.result?.score||0)-(a.result?.score||0));
    },[results,search,unrated,sort]);
    const filteredTags=tags.filter(t=>t.name.toLowerCase().includes(search.toLowerCase()));
    const total=tab==='scenes'?filtered.length:filteredTags.length, pages=Math.max(1,Math.ceil(total/50)), currentPage=Math.min(page,pages);
    const validation=state.model?.validation;
    const ignored=Object.entries(M.effectiveRules(state)).filter(([,r])=>r.ignore).map(([id])=>id).sort();
    const outdated=state.model && (state.model.exclusionRevision!==2 || state.model.fingerprint!==fingerprint || JSON.stringify(ignored)!==JSON.stringify(state.model.ignored));
    return h('main',{className:'ssa'},
      h('header',{className:'ssa-header'},h('div',null,h('span',{className:'ssa-eyebrow'},'YOUR LIBRARY · YOUR TASTE'),h('h1',null,'Scene Score Advisor'),h('p',null,'Discover what your tags suggest. Your own ratings stay yours.')),
        h('div',{className:'ssa-actions'},button('Reload library',refresh,!!busy||dirty),button('Learn from my ratings',learn,!!busy||!ready||ratedCount<10,{className:'ssa-primary'}),dirty&&button('Save changes',()=>save(),!!busy))),
      metaWarning&&h('p',{className:'ssa-notice'},metaWarning),
      error&&h('p',{role:'alert',className:'ssa-error'},error),
      busy&&h('p',{role:'status'},busy),
      dirty&&h('p',{role:'status'},'Unsaved changes. Suggestions below preview these adjustments.'),
      outdated&&h('p',{className:'ssa-notice'},'Ratings, tags, or exclusions have changed since training. Learn again to update the model.'),
      h('section',{className:'ssa-stats','aria-label':'Model summary'},
        h('div',null,h('strong',null,ratedCount.toLocaleString()),h('span',null,'rated scenes available')),
        h('div',null,h('strong',null,state.model?stars(state.model.baseline):'—'),h('span',null,'starting score / 5')),
        h('div',null,h('strong',null,state.model?.tags.length||0),h('span',null,'learned tag weights')),
        h('div',null,h('strong',null,validation?stars(validation.mae):'—'),h('span',null,'held-out error in stars'))),
      !state.model&&h('section',{className:'ssa-notice'},h('h2',null,'Start with the ratings you already trust'),h('p',null,ratedCount<10?'Rate at least 10 scenes to start learning. At 20 rated scenes, the advisor can also test its predictions.':'Review the Tag weights tab for rating-derived tags, then choose “Learn from my ratings”.'),h('p',null,'Weights are learned from scene tags only. Rare tags need at least 3 rated examples.')),
      state.model&&h('section',{className:'ssa-validation'},h('p',null,'Learned from ',state.model.ratedCount,' rated scenes · ',new Date(state.model.trainedAt).toLocaleString()),
        validation?h('p',null,'Held-out check on ',validation.count,' scenes: average error ',stars(validation.mae),' stars; predicting your average rating: ',stars(validation.baselineMae),' stars. ',validation.mae<validation.baselineMae?'Tags improved this check.':'Tags did not improve this check; treat suggestions cautiously.',' This check evaluates learned weights before manual adjustments.'):h('p',null,'Not enough rated scenes for a held-out check (20 required).')),
      h('div',{className:'ssa-toolbar'},h('div',{className:'ssa-tabs'},['scenes','review','tags'].map(key=>button(key==='scenes'?'Scene suggestions':key==='review'?'Review labels':'Tag weights',()=>{setTab(key);setSearch('');setPage(1);},false,{'aria-pressed':tab===key,key}))),
        h('input',{type:'search','aria-label':tab==='scenes'?'Search scenes':'Search tags',placeholder:tab==='scenes'?'Search scenes…':'Search tags…',value:search,onChange:e=>{setSearch(e.target.value);setPage(1);}}),
        tab==='scenes'&&h('label',null,h('input',{type:'checkbox',checked:unrated,onChange:e=>{setUnrated(e.target.checked);setPage(1);}}),' Unrated only'),
        tab==='scenes'&&h('select',{'aria-label':'Sort scenes',value:sort,onChange:e=>{setSort(e.target.value);setPage(1);}},h('option',{value:'score'},'Suggested score: highest first'),h('option',{value:'title'},'Title'))),
      tab==='tags'&&h('p',{className:'ssa-muted'},'Adjustments add or subtract stars, replacing the learned weight. Leave blank to use learning. Ignore excludes a tag; learn again after changing exclusions. Compilation status labels and rating-derived names are blocked automatically; also exclude any custom tags that encode your scene rating.'),
      tab==='review'&&h(ReviewQueue,{tags,weights,rules:state.rules,scenes,busy:!!busy,query:search,onDecision:reviewDecision,onUndo:undoDecision,canUndo:!!state.history?.length}),
      tab!=='review'&&h('div',{className:'ssa-table-wrap'},tab==='scenes'?
        h('table',null,h('thead',null,h('tr',null,['Scene','Your rating','Suggested','Why this score?'].map(label=>h('th',{key:label,scope:'col'},label)))),
          h('tbody',null,filtered.slice((currentPage-1)*50,currentPage*50).map(({scene,result})=>h('tr',{key:scene.id},
            h('td',null,h(Link,{to:'/scenes/'+scene.id},scene.title||'Scene '+scene.id)),h('td',null,M.rated(scene)?stars(scene.rating100)+' / 5':'Unrated'),
            h('td',{className:'ssa-score'},result?stars(result.score)+' / 5':'—'),
            h('td',null,result&&h('details',null,h('summary',null,result.limited?'Limited evidence · breakdown':'Score breakdown'),h(Breakdown,{result}))))))):
        h('table',null,h('thead',null,h('tr',null,['Tag','Rated examples','Learned (stars)','Override (stars)','Ignore'].map(label=>h('th',{key:label,scope:'col'},label)))),
          h('tbody',null,filteredTags.slice((currentPage-1)*50,currentPage*50).map(tag=>h(TagRule,{key:tag.id,tag,learned:weights.get(tag.id),rule:state.rules[tag.id]||{},disabled:!!busy,onChange:value=>rule(tag.id,value)}))))),
      tab!=='review'&&!total&&h('p',{className:'ssa-empty'},'No matching ',tab==='scenes'?'scenes':'tags','.'),
      tab!=='review'&&h('footer',{className:'ssa-pagination'},h('span',null,total,' ',tab==='scenes'?'scenes':'tags',' · Page ',currentPage,' of ',pages),button('Previous',()=>setPage(currentPage-1),currentPage===1),button('Next',()=>setPage(currentPage+1),currentPage===pages)),
      h('p',{className:'ssa-muted'},'Suggestions are calculated from the saved model and current tags. Model and overrides are stored in Stash plugin settings; scene ratings are never written. Reload to pick up library changes.'));
  }
  function SceneSuggestion({scene}) {
    const client=useApolloClient(),[state,setState]=useState(null),[error,setError]=useState('');
    useEffect(()=>{
      let active=true;
      const update=()=>loadState(client).then(s=>{if(active){setState(s);setError('');}}).catch(e=>{if(active)setError(e.message);});
      update();window.addEventListener('scene-score-advisor-saved',update);
      return()=>{active=false;window.removeEventListener('scene-score-advisor-saved',update);};
    },[client]);
    const result=state?.model?M.predict(scene,state.model,M.effectiveRules(state)):null;
    return h('section',{className:'ssa ssa-inline'},h('h3',null,'Suggested score ',result&&h('strong',null,stars(result.score),' / 5')),
      error?h('p',{role:'alert'},error):result?h('details',null,h('summary',null,'Why this score?'),h(Breakdown,{result})):h('p',null,'Learn tag weights to see a suggestion.'),
      h(Link,{to:'/scene-score-advisor'},'Open Scene Score Advisor'));
  }
  api.register.route('/scene-score-advisor',Advisor);
  api.patch.before('MainNavBar.MenuItems',props=>[{...props,children:h(R.Fragment,null,props.children,
    h(api.libraries.Bootstrap.Nav.Link,{as:'div',eventKey:'/scene-score-advisor',className:'col-4 col-sm-3 col-md-2 col-lg-auto'},
      h(api.libraries.Bootstrap.Button,{as:api.libraries.ReactRouterDOM.NavLink,to:'/scene-score-advisor',exact:true,className:'minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center'},
        h('span',{'aria-hidden':true,className:'d-block d-xl-inline mb-2 mb-xl-0'},'☆ '),h('span',null,'Score Advisor'))))}]);
  api.patch.before('SettingsToolsSection',props=>{
    const Setting=api.components.Setting;
    return [{...props,children:h(R.Fragment,null,props.children,Setting?h(Setting,{heading:h(Link,{to:'/scene-score-advisor'},'Open Scene Score Advisor')}):h(Link,{to:'/scene-score-advisor'},'Open Scene Score Advisor'))}];
  });
  api.patch.before('ScenePage.Tabs',props=>[{...props,children:h(R.Fragment,null,props.children,h(api.libraries.Bootstrap.Nav.Item,null,h(api.libraries.Bootstrap.Nav.Link,{eventKey:'scene-score-advisor'},'Suggested score')))}]);
  api.patch.before('ScenePage.TabContent',props=>[{...props,children:h(R.Fragment,null,props.children,h(api.libraries.Bootstrap.Tab.Pane,{eventKey:'scene-score-advisor'},h(SceneSuggestion,{scene:props.scene})))}]);
})();
