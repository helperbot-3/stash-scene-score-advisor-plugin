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
  const empty=()=>({version:1,model:null,rules:{}});
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
    return h('tr',null,h('td',null,tag.name,tag.blocked && h('small',{className:'ssa-muted'},' · rating-derived name; excluded')),
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
    const [sort,setSort]=useState('score');
    async function refresh() {
      setBusy('Loading library…');setError('');
      try {
        const saved=await loadState(client);
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
        const model=await M.train(scenes,state.rules), next={...state,model};
        setState(next);setDirty(true);
        await saveState(client,next);setDirty(false);
      }catch(e){setError(e.message);}finally{setBusy('');}
    }
    function rule(id,value){setState(s=>({...s,rules:{...s.rules,[id]:value}}));setDirty(true);}
    const tags=useMemo(()=>M.catalog(scenes),[scenes]);
    const ratedCount=useMemo(()=>scenes.filter(M.rated).length,[scenes]);
    const fingerprint=useMemo(()=>M.fingerprint(scenes),[scenes]);
    const weights=new Map((state.model?.tags||[]).map(t=>[t.id,t]));
    const results=useMemo(()=>{const predict=M.createPredictor(state.model,state.rules);return scenes.map(scene=>({scene,result:predict(scene)}));},[scenes,state]);
    const filtered=useMemo(()=>{
      const query=search.toLowerCase();
      return results.filter(({scene})=>(!unrated||!M.rated(scene)) && (scene.title||'Scene '+scene.id).toLowerCase().includes(query))
        .sort((a,b)=>sort==='title'?(a.scene.title||'').localeCompare(b.scene.title||''):(b.result?.score||0)-(a.result?.score||0));
    },[results,search,unrated,sort]);
    const filteredTags=tags.filter(t=>t.name.toLowerCase().includes(search.toLowerCase()));
    const total=tab==='scenes'?filtered.length:filteredTags.length, pages=Math.max(1,Math.ceil(total/50)), currentPage=Math.min(page,pages);
    const validation=state.model?.validation;
    const ignored=Object.entries(state.rules).filter(([,r])=>r.ignore).map(([id])=>id).sort();
    const outdated=state.model && (state.model.fingerprint!==fingerprint || JSON.stringify(ignored)!==JSON.stringify(state.model.ignored));
    return h('main',{className:'ssa'},
      h('header',{className:'ssa-header'},h('div',null,h('span',{className:'ssa-eyebrow'},'YOUR LIBRARY · YOUR TASTE'),h('h1',null,'Scene Score Advisor'),h('p',null,'Discover what your tags suggest. Your own ratings stay yours.')),
        h('div',{className:'ssa-actions'},button('Reload library',refresh,!!busy||dirty),button('Learn from my ratings',learn,!!busy||!ready||ratedCount<10,{className:'ssa-primary'}),dirty&&button('Save changes',()=>save(),!!busy))),
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
      h('div',{className:'ssa-toolbar'},h('div',{className:'ssa-tabs'},['scenes','tags'].map(key=>button(key==='scenes'?'Scene suggestions':'Tag weights',()=>{setTab(key);setSearch('');setPage(1);},false,{'aria-pressed':tab===key,key}))),
        h('input',{type:'search','aria-label':tab==='scenes'?'Search scenes':'Search tags',placeholder:tab==='scenes'?'Search scenes…':'Search tags…',value:search,onChange:e=>{setSearch(e.target.value);setPage(1);}}),
        tab==='scenes'&&h('label',null,h('input',{type:'checkbox',checked:unrated,onChange:e=>{setUnrated(e.target.checked);setPage(1);}}),' Unrated only'),
        tab==='scenes'&&h('select',{'aria-label':'Sort scenes',value:sort,onChange:e=>{setSort(e.target.value);setPage(1);}},h('option',{value:'score'},'Suggested score: highest first'),h('option',{value:'title'},'Title'))),
      tab==='tags'&&h('p',{className:'ssa-muted'},'Adjustments add or subtract stars, replacing the learned weight. Leave blank to use learning. Ignore excludes a tag; learn again after changing exclusions. Rating-derived names are blocked automatically; also exclude any custom tags that encode your scene rating.'),
      h('div',{className:'ssa-table-wrap'},tab==='scenes'?
        h('table',null,h('thead',null,h('tr',null,['Scene','Your rating','Suggested','Why this score?'].map(label=>h('th',{key:label,scope:'col'},label)))),
          h('tbody',null,filtered.slice((currentPage-1)*50,currentPage*50).map(({scene,result})=>h('tr',{key:scene.id},
            h('td',null,h(Link,{to:'/scenes/'+scene.id},scene.title||'Scene '+scene.id)),h('td',null,M.rated(scene)?stars(scene.rating100)+' / 5':'Unrated'),
            h('td',{className:'ssa-score'},result?stars(result.score)+' / 5':'—'),
            h('td',null,result&&h('details',null,h('summary',null,result.limited?'Limited evidence · breakdown':'Score breakdown'),h(Breakdown,{result}))))))):
        h('table',null,h('thead',null,h('tr',null,['Tag','Rated examples','Learned (stars)','Override (stars)','Ignore'].map(label=>h('th',{key:label,scope:'col'},label)))),
          h('tbody',null,filteredTags.slice((currentPage-1)*50,currentPage*50).map(tag=>h(TagRule,{key:tag.id,tag,learned:weights.get(tag.id),rule:state.rules[tag.id]||{},disabled:!!busy,onChange:value=>rule(tag.id,value)}))))),
      !total&&h('p',{className:'ssa-empty'},'No matching ',tab==='scenes'?'scenes':'tags','.'),
      h('footer',{className:'ssa-pagination'},h('span',null,total,' ',tab==='scenes'?'scenes':'tags',' · Page ',currentPage,' of ',pages),button('Previous',()=>setPage(currentPage-1),currentPage===1),button('Next',()=>setPage(currentPage+1),currentPage===pages)),
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
    const result=state?.model?M.predict(scene,state.model,state.rules):null;
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
