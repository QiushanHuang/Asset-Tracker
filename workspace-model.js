(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./ledger-dedup') : root.AssetTrackerDedup, typeof module === 'object' && module.exports ? require('./legacy-safety') : root.AssetTrackerLegacySafety);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AssetTrackerWorkspace = api;
})(globalThis, function (D, S) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const MODULES = [
    ['cashflow', '期间收支', 'full', true], ['assets', '资产状态', 'full', true],
    ['trend', '资产趋势', 'wide', true], ['review', '待核对', 'narrow', true],
    ['recent', '最近账单', 'wide', true], ['automation', '自动化摘要', 'narrow', true],
    ['assistant', '账本助手', 'full', true], ['allocation', '资产分布', 'half', false],
    ['projects', '项目概览', 'half', false], ['memo', '备忘录', 'full', false]
  ].map(([id, name, width, visible]) => Object.freeze({id, name, width, visible}));
  function preferences(input = {}) {
    input = input && typeof input === 'object' ? input : {};
    const modules = [], seen = new Set();
    for (const candidate of Array.isArray(input.modules) ? input.modules : []) {
      const base = MODULES.find(m => m.id === candidate?.id);
      if (!base || seen.has(base.id)) continue;
      seen.add(base.id);
      modules.push({id:base.id, visible:typeof candidate.visible === 'boolean' ? candidate.visible : base.visible,
        width:['full','half','wide','narrow'].includes(candidate.width) ? candidate.width : base.width,
        variant:candidate.variant === 'compact' ? 'compact' : 'standard'});
    }
    for (const base of MODULES) if (!seen.has(base.id)) modules.push({id:base.id,visible:base.visible,width:base.width,variant:'standard'});
    return {schemaVersion:1, theme:['light','dark','system'].includes(input.theme) ? input.theme : 'light',
      density:input.density === 'compact' ? 'compact' : 'comfortable',
      metricEmphasis:input.metricEmphasis === 'net-assets' ? 'net-assets' : 'cashflow',
      defaultPeriod:input.defaultPeriod === 'last-30-days' ? 'last-30-days' : 'month-to-date',
      recentCount:[2,3,5,10,20].includes(input.recentCount) ? input.recentCount : 2, modules};
  }
  function preset(name) {
    const p=preferences();
    const order=name==='analysis'?['assets','cashflow','trend','allocation','recent','assistant','review','automation','projects','memo']:
      name==='automation'?['cashflow','review','assistant','automation','recent','assets','trend','projects','allocation','memo']:MODULES.map(m=>m.id);
    p.modules.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    if(name==='analysis')p.modules.find(m=>m.id==='allocation').visible=true;
    return p;
  }
  function dateKey(value) {
    const s=String(value||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('日期无效');
    const [y,m,d]=s.split('-').map(Number), test=new Date(Date.UTC(y,m-1,d));
    if(test.toISOString().slice(0,10)!==s)throw Error('日期无效');
    return s;
  }
  const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  function accounts(book) {
    const result=[];
    function walk(nodes,path=[]) { for(const node of Object.values(nodes||{})) {
      const names=[...path,node.name];
      if(node.children&&Object.keys(node.children).length)walk(node.children,names);
      else result.push({id:node.id,name:names.join(' / '),names,currency:node.currency||book.settings.baseCurrency,isDebt:!!node.isDebt,node});
    }}
    walk(book.categories);return result;
  }
  function rate(book,currency) {const r=currency===book.settings.baseCurrency?1:book.settings.exchangeRates?.[currency];if(!(Number.isFinite(r)&&r>0))throw Error(`缺少 ${currency} 汇率`);return r;}
  function cashflow(book,at=today(),period='month-to-date') {
    at=dateKey(at);const d=new Date(at+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-29);
    const from=period==='last-30-days'?d.toISOString().slice(0,10):at.slice(0,8)+'01';
    const groups=new Map(), excluded=new Set();
    for(const t of book.transactions||[])if(t.transferId){const g=groups.get(t.transferId)||[];g.push(t);groups.set(t.transferId,g);}
    for(const g of groups.values())if(g.length===2&&g[0].accountId&&g[1].accountId&&g[0].accountId!==g[1].accountId&&g[0].currency===g[1].currency&&g[0].date===g[1].date&&g[0].amount!==0&&g[0].amount===-g[1].amount)g.forEach(t=>excluded.add(t));
    let income=0,expense=0;const missing=new Set(),transactions=[],categories=new Map();
    for(const t of book.transactions||[]){const key=dateKey(t.date);if(key<from||key>at||excluded.has(t))continue;transactions.push(t);
      let r;try{r=rate(book,t.currency||book.settings.baseCurrency);}catch{missing.add(t.currency);continue;}
      const n=t.amount*r;if(n<0){expense-=n;const name=t.purpose||'未分类';categories.set(name,(categories.get(name)||0)-n);}else income+=n;
    }
    return {from,to:at,income:round(income),expense:round(expense),net:round(income-expense),missing:[...missing].sort(),transactions,
      categories:[...categories].map(([name,amount])=>({name,amount:round(amount)})).sort((a,b)=>b.amount-a.amount)};
  }
  function proposal(book,input,{allowMissing=false}={}) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('建议结构无效');
    const get=(name,max=500)=>{const v=input[name]??'';if(typeof v!=='string'||v.length>max)throw Error('建议字段或长度无效');return v.trim();};
    const result={date:get('date',40),amount:get('amount',40),direction:get('direction',16),currency:get('currency',3),accountId:get('accountId',200),purpose:get('purpose',100),description:get('description'),projectId:get('projectId',200),expenseCategoryId:get('expenseCategoryId',200)};
    if(result.date){dateKey(result.date);if(!/^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?)?$/.test(result.date))throw Error('日期时间格式无效');}else if(!allowMissing)throw Error('请选择日期');
    if(result.amount&&!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(result.amount))throw Error('金额须为有效正数');
    if((result.amount&&!(Number(result.amount)>0&&Number(result.amount)<=1e12))||(!allowMissing&&!result.amount))throw Error('请填写正数金额');
    if(!['expense','income'].includes(result.direction))throw Error('请选择收支方向');
    if(result.currency&&!/^[A-Z]{3}$/.test(result.currency))throw Error('币种无效');
    if(!result.currency&&!allowMissing)throw Error('请选择币种');
    const account=accounts(book).find(a=>a.id===result.accountId);
    if(result.accountId&&!account||!allowMissing&&!account)throw Error('请选择有效资金账户');
    if(result.purpose&&!(book.purposeCategories||[]).includes(result.purpose))throw Error('用途分类无效');
    if(result.projectId){const project=(book.expenseProjects||[]).find(p=>p.id===result.projectId);if(!project)throw Error('项目不存在');
      if(result.expenseCategoryId&&!project.categories.some(c=>c.id===result.expenseCategoryId))throw Error('消费分类不属于所选项目');
    }else if(result.expenseCategoryId)throw Error('请先选择项目');
    return result;
  }
  function transactionId(draft) {
    if(typeof draft.id!=='string'||!/^[a-zA-Z0-9:_-]{1,180}$/.test(draft.id))throw Error('草稿身份无效');
    return draft.source==='import'&&typeof draft.sourceId==='string'&&draft.sourceId.length<=200?draft.sourceId:'draft:'+draft.id;
  }
  function draftTransaction(draft) {
    const p=draft.proposal||{};
    return {id:transactionId(draft),date:p.date,accountId:p.accountId,amount:p.amount?Number(p.amount)*(p.direction==='expense'?-1:1):NaN,currency:p.currency,description:p.description||'',purpose:p.purpose||'',projectId:p.projectId||'',expenseCategoryId:p.expenseCategoryId||'',...(draft.sourceIdentity?{sourceIdentity:clone(draft.sourceIdentity)}:{})};
  }
  function duplicateReviewBasis(book,pendingDrafts=[],scope) {
    // Recompute this value on every check: ledger objects and account trees can
    // change in place. Decisions and presentation-only draft fields are excluded.
    return JSON.stringify([D.RULE_VERSION||'1',scope??null,book.workspaceScope||'legacy-local',book.categories,book.settings?.baseCurrency,book.importAudits||[],
      book.transactions||[],pendingDrafts.filter(d=>d.status==='pending').map(d=>[d.id,draftTransaction(d)])]);
  }
  function createDuplicateReviewer(book,pendingDrafts=[]) {
    const known=new Set((book.transactions||[]).map(t=>t.id)),positions=new Map(),index=D.createIndex(book.transactions||[],{book});
    const auditContext=book.importAudits?.length?S.sha256Hex(new TextEncoder().encode(JSON.stringify(book.importAudits))):'';
    const accountContext=[D.RULE_VERSION||'1',auditContext,book.workspaceScope||'legacy-local',book.settings?.baseCurrency,
      accounts(book).map(a=>[a.id,a.name,a.currency,a.isDebt,a.node?.sourceCategoryId??null])];
    for(const d of pendingDrafts)if(d.status==='pending'&&!known.has(transactionId(d)))positions.set(d.id,index.add(draftTransaction(d)));
    return draft=>{
      const candidate=draftTransaction(draft),matches=index.findMatches(candidate,{excludePosition:positions.get(draft.id)});
      const signature=JSON.stringify([accountContext,candidate,matches.total,matches.map(m=>[m.level,m.transaction,m.kind,m.evidence,m.reasons,m.differences]).sort((a,b)=>String(a[1].id).localeCompare(String(b[1].id)))]);
      return {matches,matchCount:matches.total,signature,blocked:matches.total>20||matches.some(m=>m.level==='exact'||m.level==='conflict')};
    };
  }
  function reviewDuplicates(book,draft,pendingDrafts=[]) {return createDuplicateReviewer(book,pendingDrafts)(draft);}
  function applyDrafts(book,drafts,expectedSource,{pendingDrafts=drafts}={}) {
    if(expectedSource!==undefined&&JSON.stringify(book)!==expectedSource)throw Error('账本已有变化，请重新核对');
    if(!Array.isArray(drafts)||!drafts.length||drafts.length>1000)throw Error('请选择 1–1000 笔草稿');
    const next=clone(book),existing=new Set([...next.transactions.map(t=>t.id),...(next.workspaceReceipts||[])]),map=new Map(accounts(next).map(a=>[a.id,a]));
    next.workspaceReceipts=[...new Set(next.workspaceReceipts||[])];
    const reviewDraft=createDuplicateReviewer(book,pendingDrafts);
    for(const draft of drafts){const id=transactionId(draft);
      const stored=next.transactions.find(t=>t.id===id);
      if(stored){if(D.compare(draftTransaction(draft),stored,{book:next})?.level!=='exact')throw Error('记录ID内容冲突，请重新核对');continue;}
      if(existing.has(id))continue;
      const review=reviewDraft(draft);
      if(review.blocked)throw Error('来源或记录ID已有记录或内容冲突，请核对重复来源，不能重复入账');
      if(review.matches.length&&!(draft.duplicateDecision?.action==='keep'&&draft.duplicateDecision.signature===review.signature))throw Error('请重新核对疑似重复记录及其匹配依据');
      if(draft.status!=='pending')throw Error('草稿状态不能提交');if(draft.error)throw Error(draft.error);
      const p=proposal(next,draft.proposal),a=map.get(p.accountId),amount=Number(p.amount)*(p.direction==='expense'?-1:1);
      const converted=amount*rate(next,p.currency)/rate(next,a.currency);
      a.node.balance+=a.isDebt?-converted:converted;if(!Number.isFinite(a.node.balance)||Math.abs(a.node.balance)>1e15)throw Error('余额超出范围');
      next.transactions.push({id,date:p.date,accountId:a.id,category:a.names[0],subcategory:a.names.length>1?a.names.at(-1):'',amount,currency:p.currency,type:'单次',purpose:p.purpose,description:p.description,projectId:p.projectId,expenseCategoryId:p.expenseCategoryId,
        ...(draft.sourceIdentity?{sourceIdentity:clone(draft.sourceIdentity)}:{}),sourceDraftId:draft.id,reviewSource:{kind:String(draft.source||'manual'),text:String(draft.sourceText||''),evidence:String(draft.evidence||'')},...(draft.sourceAutomationRuleId?{sourceAutomationRuleId:draft.sourceAutomationRuleId}: {})});
      existing.add(id);
      next.workspaceReceipts.push(id);
      if(draft.sourceAutomationRuleId){const rule=(next.automationRules||[]).find(r=>r.id===draft.sourceAutomationRuleId);if(rule&&(!rule.lastExecuted||String(rule.lastExecuted).slice(0,10)<p.date.slice(0,10)))rule.lastExecuted=p.date;}
    }
    return next;
  }
  function reconcile(book,drafts) {
    const existing=new Map((book.transactions||[]).map(t=>[t.id,t])),receipts=new Set(book.workspaceReceipts||[]);
    return drafts.map(d=>{const id=transactionId(d),t=existing.get(id);
      if(t&&D.compare(draftTransaction(d),t,{book})?.level!=='exact')return d.status==='pending'&&d.error==='记录ID内容冲突，请核对原记录'?d:{...d,status:'pending',error:'记录ID内容冲突，请核对原记录'};
      const status=t||receipts.has(id)?'committed':d.status;return status===d.status?d:{...d,status};
    });
  }
  function compactDrafts(drafts){return [...drafts.filter(d=>d.status==='pending'),...drafts.filter(d=>d.status!=='pending').slice(-200)];}
  function duplicateGroups(book) { return D.scan(book.transactions||[],{book}).map(m=>[m.left,m.right]); }
  function fromTransaction(t,id,source='import') {return {id,source,sourceId:t.id,status:'pending',...(t.sourceIdentity?{sourceIdentity:clone(t.sourceIdentity)}:{}),sourceAutomationRuleId:t.sourceAutomationRuleId,
    proposal:{date:t.date,amount:String(Math.abs(t.amount)),direction:t.amount<0?'expense':'income',currency:t.currency||'CNY',accountId:t.accountId||'',purpose:t.purpose||'',description:t.description||'',projectId:t.projectId||'',expenseCategoryId:t.expenseCategoryId||''}};}
  function ruleDrafts(book,rule,at,schedule){
    if(!rule.active)return [];let day=dateKey(rule.startDate);at=dateKey(at);const end=rule.endDate&&rule.endDate<at?dateKey(rule.endDate):at;
    const candidates=accounts(book).filter(a=>rule.accountId?a.id===rule.accountId:a.names[0]===rule.category&&(!rule.subcategory||a.names.at(-1)===rule.subcategory));
    const ruleKey=Array.from(String(rule.id)).map(c=>c.codePointAt(0).toString(16)).join('_');if(ruleKey.length>130)throw Error('规则标识过长，请新建规则后核对历史项');
    const known=new Set([...(book.workspaceReceipts||[]),...book.transactions.map(t=>t.id)]),result=[];let days=0;
    const oldDays=new Set(book.transactions.filter(t=>t.sourceAutomationRuleId===rule.id||t.category===rule.category&&String(t.description||'').includes(`[${rule.name}]`)).map(t=>dateKey(t.date)));
    while(day<=end){if(++days>20000)throw Error('规则起始日期过早，请缩小范围');
      const id=`rule-${ruleKey}:${day}`;
      const old=oldDays.has(day);
      if(schedule(rule,day)&&!known.has('draft:'+id)&&!old){result.push({id,status:'pending',source:'rule',sourceAutomationRuleId:rule.id,sourceText:`周期规则：${rule.name}\n预计日期：${day}`,proposal:{date:day,amount:String(Math.abs(rule.amount)),direction:rule.amount<0?'expense':'income',currency:rule.currency||book.settings.baseCurrency,accountId:candidates.length===1?candidates[0].id:'',purpose:(book.purposeCategories||[]).includes(rule.purpose)?rule.purpose:'',description:`[${rule.name}] 周期记录`,projectId:'',expenseCategoryId:''}});if(result.length>1000)throw Error('补齐范围超过 1,000 笔，请调整规则开始日期后预览');}
      const next=new Date(day+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);day=next.toISOString().slice(0,10);
    }return result;
  }
  return Object.freeze({MODULES,preferences,preset,dateKey,today,accounts,cashflow,proposal,applyDrafts,reconcile,transactionId,draftTransaction,duplicateReviewBasis,reviewDuplicates,createDuplicateReviewer,duplicateGroups,fromTransaction,ruleDrafts,compactDrafts});
});
