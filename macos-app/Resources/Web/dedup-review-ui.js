(function(root){
 'use strict';
 const W=root.AssetTrackerWorkspace,D=root.AssetTrackerDedup,el=id=>document.getElementById(id);
 const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const levels={conflict:'来源冲突',exact:'相同来源',high:'较强线索',possible:'需要核对'};
 const kinds={duplicate:'疑似重复',related:'资金流对应',distinct:'有不同流水依据'};
 const providerNames={wechat:'微信',alipay:'支付宝',icbc:'工商银行',ocbc:'OCBC'};
 const asText=v=>v===undefined||v===null||v===''?'未提供':String(v);
 const source=t=>{
  const provider=['wechat','alipay','icbc','ocbc'].find(k=>t[k]&&typeof t[k]==='object');
  const data=provider?t[provider]:t.sourceIdentity||{};
  const name=String(provider||data.provider||'').normalize('NFKC').trim().toLowerCase();
  const derived=['icbc','ocbc'].includes(provider)||/derived|hash|fingerprint/i.test(String(data.kind||''));
  const unknown=['','statement','unknown'].includes(String(name).toLowerCase());
  const id=String(data.transactionId??data.id??'').normalize('NFKC').trim();
  return {provider:unknown?'':name,data,id,kind:!id?'未提供':unknown?'来源未明确（不作身份依据）':derived?'导入行指纹（非银行流水号）':'来源交易号'};
 };
 const signed=t=>Number.isFinite(Number(t.amount))?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:8,signDisplay:'exceptZero'}).format(Number(t.amount)):'待核对';
 const label=p=>p.kind==='duplicate'?levels[p.level]||kinds.duplicate:kinds[p.kind]||'无重复依据';
 const assess=(a,b,book)=>D.explainPair?D.explainPair(a,b,{book}):{kind:'duplicate',...(D.compare(a,b,{book})||{level:'possible',reasons:[],differences:[]})};
 root.AssetTrackerDedupReviewUI={install(Tracker){Object.assign(Tracker.prototype,{
  workspaceDuplicateRecords(){
   const records=(this.data.transactions||[]).map((transaction,index)=>({key:'ledger:'+index+':'+transaction.id,transaction,origin:'已入账记录'}));
   for(const draft of this.ws.drafts||[])if(draft.status==='pending')records.push({key:'draft:'+draft.id,transaction:W.draftTransaction(draft),draftId:draft.id,origin:'待核对草稿'});
   return records;
  },
  workspaceDuplicateBasis(){return W.duplicateReviewBasis(this.data,this.ws.drafts,this.ws.scope);},
  buildWorkspaceDuplicateView(){
   const old=this.ws.duplicateView,records=this.workspaceDuplicateRecords(),byObject=new Map(records.map(r=>[r.transaction,r]));
   const transactions=records.map(r=>r.transaction),duplicate=D.scan(transactions,{book:this.data,limit:5000}),related=D.scanRelated?.(transactions,{book:this.data,limit:2000})||[],distinct=D.scanDistinct?.(transactions,{book:this.data,limit:2000})||[];
   const pairs=[];
   for(const [kind,items] of [['duplicate',duplicate],['related',related],['distinct',distinct]])for(const item of items){
    const left=byObject.get(item.left),right=byObject.get(item.right);if(!left||!right)continue;
    pairs.push({...item,kind,leftEntry:left,rightEntry:right,key:JSON.stringify([left.key,right.key].sort())});
   }
   const rank={conflict:0,exact:1,high:2,possible:3};pairs.sort((a,b)=>(rank[a.level]??4)-(rank[b.level]??4)||String(b.left.date).localeCompare(String(a.left.date))||a.key.localeCompare(b.key));
   return {basis:this.workspaceDuplicateBasis(),scopeKey:JSON.stringify([this.ws.scope,this.data.workspaceScope||'legacy-local']),records,pairs,counts:{duplicate:duplicate.length,related:related.length,distinct:distinct.length},truncated:{duplicate:!!duplicate.truncated,related:!!related.truncated,distinct:!!distinct.truncated},kind:old?.kind||'duplicate',query:old?.query||'',page:old?.page||0,selectedKey:old?.selectedKey||'',onlyDifferences:!!old?.onlyDifferences,view:'compare',returnDraftId:old?.scopeKey===JSON.stringify([this.ws.scope,this.data.workspaceScope||'legacy-local'])?old.returnDraftId||'':''};
  },
  showWorkspaceDuplicates(){
   if(!this.ws?.ready)return;
   if(this.ws.duplicateView?.basis!==this.workspaceDuplicateBasis())this.ws.duplicateView=this.buildWorkspaceDuplicateView();
   this.ws.duplicateView.view='compare';this.ws.duplicateView.returnDraftId='';this.renderWorkspaceDuplicateView();this.showModal();
  },
  openWorkspaceDraftComparison(draftId,matchId){
   const draft=this.ws.drafts.find(d=>d.id===draftId&&d.status==='pending');if(!draft)return;
   this.refreshWorkspaceDuplicates();const matches=this.ws.duplicateReviews.get(draftId)?.matches.filter(m=>m.transactionId===matchId)||[];
   if(matches.length!==1){this.workspaceMessage('匹配已变化，请重新查看这条草稿的重复依据。');this.renderWorkspaceReview();return;}
   const state=this.buildWorkspaceDuplicateView(),left=state.records.find(r=>r.draftId===draftId),right=state.records.find(r=>r.transaction===matches[0].transaction)||state.records.find(r=>r.key!==left?.key&&r.transaction.id===matchId);
   if(!left||!right)return;
   const key=JSON.stringify([left.key,right.key].sort());let pair=state.pairs.find(p=>p.key===key);
   if(!pair){pair={...assess(left.transaction,right.transaction,this.data),left:left.transaction,right:right.transaction,leftEntry:left,rightEntry:right,key};state.pairs.unshift(pair);}
   state.kind=pair.kind;state.query='';state.selectedKey=key;state.page=Math.floor(state.pairs.filter(p=>p.kind===state.kind).findIndex(p=>p.key===key)/10);state.returnDraftId=draftId;
   this.ws.duplicateView=state;this.renderWorkspaceDuplicateView();this.showModal();
  },
  workspaceDuplicateFresh(){
   const state=this.ws.duplicateView;if(state?.basis===this.workspaceDuplicateBasis())return true;
   if(el('ws-dup-status'))el('ws-dup-status').textContent='账本、草稿或来源依据已有变化。请重新检查后继续查看，原选择会尽量保留。';
   return false;
  },
  workspaceDuplicateAccount(t){
   const norm=v=>String(v??'').normalize('NFKC').trim(),accounts=W.accounts(this.data),explicit=norm(t.accountId),legacy=norm(t.sourceCategoryId);
   const matched=explicit?accounts.filter(a=>norm(a.id)===explicit):legacy?accounts.filter(a=>norm(a.id)===legacy||norm(a.node.sourceCategoryId)===legacy):accounts.filter(a=>a.names[0]===t.category&&(a.names.length===1?!t.subcategory:a.names.at(-1)===t.subcategory));
   const unique=matched.length===1&&accounts.filter(a=>norm(a.id)===norm(matched[0].id)).length===1;
   return unique?matched[0].name:matched.length?'账户不唯一':'账户信息不足';
  },
  workspaceComparisonRows(pair){
   const a=pair.left,b=pair.right,sa=source(a),sb=source(b),project=t=>this.data.expenseProjects?.find(p=>p.id===t.projectId)?.name||t.projectId||'日常 · 无项目';
   const location=s=>s.data.sourcePage?`第 ${s.data.sourcePage} 页 / 第 ${s.data.sourceRow||'?'} 行`:'未提供';
   const balance=t=>{const s=source(t).data;return Number.isSafeInteger(s.bankBalanceCents)?(s.bankBalanceCents/100).toFixed(2)+' '+t.currency:'未提供';};
   const precision=t=>!t.date?'未提供':/[T ]\d{2}:\d{2}/i.test(t.date||'')?(/[T ]\d{2}:\d{2}:\d{2}/i.test(t.date)?'精确到秒':'精确到分钟'):'仅日期';
   const normalized=v=>asText(v).normalize('NFKC').trim().replace(/\s+/g,' ');
   const row=(field,name,left,right)=>({field,name,left:asText(left),right:asText(right),different:normalized(left)!==normalized(right)});
   return [row('date','交易时间',String(a.date||'').replace(/(\d)[T ](?=\d{2}:)/i,'$1\n'),String(b.date||'').replace(/(\d)[T ](?=\d{2}:)/i,'$1\n')),row('precision','时间精度',precision(a),precision(b)),row('amount','金额',signed(a),signed(b)),row('currency','币种',a.currency,b.currency),row('account','资金账户',this.workspaceDuplicateAccount(a),this.workspaceDuplicateAccount(b)),row('description','描述',a.description,b.description),row('purpose','用途分类',a.purpose,b.purpose),row('project','项目',project(a),project(b)),row('provider','来源',providerNames[sa.provider]||sa.provider,providerNames[sb.provider]||sb.provider),row('identity-kind','标识性质',sa.kind,sb.kind),row('identity','来源标识',sa.id,sb.id),row('balance','账后余额',balance(a),balance(b)),row('location','原始位置',location(sa),location(sb))];
  },
  renderWorkspaceDuplicateView(focusId){
   const state=this.ws.duplicateView;if(!state)return;
   const oldQuery=el('ws-dup-query'),selection=focusId==='ws-dup-query'&&oldQuery?[oldQuery.selectionStart,oldQuery.selectionEnd]:null;
   const opened=new Set([...document.querySelectorAll('[data-dup-disclosure][open]')].map(n=>n.dataset.dupDisclosure));
   const query=state.query.trim().toLocaleLowerCase(),filtered=state.pairs.filter(p=>p.kind===state.kind&&(!query||[p.left.description,p.right.description,p.left.date,p.right.date,p.left.amount,p.right.amount,this.workspaceDuplicateAccount(p.left),this.workspaceDuplicateAccount(p.right),label(p)].some(v=>String(v||'').toLocaleLowerCase().includes(query))));
   const pages=Math.max(1,Math.ceil(filtered.length/10));state.page=Math.max(0,Math.min(state.page,pages-1));const visible=filtered.slice(state.page*10,state.page*10+10);
   let pair=visible.find(p=>p.key===state.selectedKey)||visible[0];state.selectedKey=pair?.key||'';
   const rules=`<details class="ws-dup-rules" data-dup-disclosure="rules"><summary>本地规则与判断边界</summary><p>真实平台订单号、银行行指纹和账后余额分别核对。不同的银行指纹本身不能证明是两笔交易；完整且连续的中间流水可以解释同额相似。</p><p>同日同金额不是重复结论。等额反向且有支持文字的资金流，已知时刻仅看2小时内，只有日期时仅看同日。转账、还款与退款的账户和用途需分别核对；这里不会删除、合并或改变余额。</p></details>`;
   const returnButton=state.returnDraftId?'<button id="ws-dup-return-draft" class="ws-text-button" type="button">返回当前草稿</button>':'';
   if(state.view==='record'&&pair){
    const entry=state.recordSide==='right'?pair.rightEntry:pair.leftEntry,t=entry.transaction,s=source(t),raw=t.reviewSource?.text||(entry.draftId?this.ws.drafts.find(d=>d.id===entry.draftId)?.sourceText:'');
    el('modal-body').innerHTML=`<section class="ws-duplicate-browser"><div class="ws-dup-heading"><h3>账单与来源</h3><button id="ws-dup-back" type="button" class="btn btn-secondary">返回对比</button></div><p class="helper-text">${h(entry.origin)} · ${h(t.date)} · ${h(signed(t))} ${h(t.currency)}</p><dl class="ws-dup-record-fields">${this.workspaceComparisonRows(pair).map(r=>`<dt>${h(r.name)}</dt><dd>${h(state.recordSide==='right'?r.right:r.left)}</dd>`).join('')}</dl><details open><summary>保存的原始文字与来源注记</summary><pre class="ws-source-text">${h(raw||s.data.note||'这笔记录没有保存原始文字，可按上方来源位置核对原文件。')}</pre></details><p id="ws-dup-status" class="ws-status" role="status"></p><div class="ws-dup-footer"><button id="ws-dup-refresh" type="button" class="btn btn-secondary">重新检查</button>${returnButton}</div></section>`;
    el('ws-dup-back').onclick=()=>{if(this.workspaceDuplicateFresh()){state.view='compare';this.renderWorkspaceDuplicateView('ws-dup-selected-title');}};
   }else{
    const rows=pair?this.workspaceComparisonRows(pair):[],reasonLines=pair?(pair.kind==='related'?pair.reasons.slice(0,2):pair.reasons)||[]:[],differenceLines=(pair?.differences||[]).map(value=>pair.kind==='related'?value.replace('，可能是当天的另一笔消费',''):value);
    el('modal-body').innerHTML=`<section class="ws-duplicate-browser"><div class="ws-dup-heading"><div><h3>本地账单对比</h3><p class="helper-text">${state.records.length} 笔现账与待核对草稿 · 逐对查看依据</p></div><button id="ws-dup-refresh" type="button" class="btn btn-secondary">重新检查</button></div><div class="ws-dup-tools"><label>查看<select id="ws-dup-kind">${Object.entries(kinds).map(([value,name])=>`<option value="${value}" ${state.kind===value?'selected':''}>${name} · ${state.counts[value]||0}</option>`).join('')}</select></label><label class="ws-dup-search">搜索记录<input id="ws-dup-query" value="${h(state.query)}" placeholder="描述、账户、日期或金额"></label></div>${state.truncated[state.kind]?'<p class="ws-status">检查达到本次处理上限，下面不是完整扫描结果。请缩小账本范围后再检查。</p>':''}<div class="ws-duplicate-layout"><aside class="ws-dup-list-pane"><div class="ws-dup-list" aria-label="对比候选">${visible.length?visible.map(p=>`<button type="button" class="ws-dup-pair ${p.key===state.selectedKey?'selected':''}" data-dup-key="${h(p.key)}" aria-current="${p.key===state.selectedKey}"><span class="ws-dup-badge" data-level="${h(p.level||p.kind)}">${h(label(p))}</span><strong>${h(p.left.description||'无描述')}</strong>${String(p.left.description||'').trim()===String(p.right.description||'').trim()?'':`<span>${h(p.right.description||'无描述')}</span>`}<small>${h(String(p.left.date||'').replace('T',' '))} · ${h(signed(p.left))} ${h(p.left.currency)}</small></button>`).join(''):'<p class="ws-empty-small">没有符合当前条件的线索。</p>'}</div><nav class="ws-dup-pagination" aria-label="对比翻页"><button id="ws-dup-prev" type="button" class="btn btn-secondary" ${state.page===0?'disabled':''}>上一页</button><span>${state.page+1} / ${pages}</span><button id="ws-dup-next" type="button" class="btn btn-secondary" ${state.page+1>=pages?'disabled':''}>下一页</button></nav></aside><div class="ws-dup-detail">${pair?`<div class="ws-dup-detail-heading"><strong id="ws-dup-selected-title" tabindex="-1">${h(label(pair))}</strong><label class="ws-check"><input type="checkbox" id="ws-dup-differences" ${state.onlyDifferences?'checked':''}>只看差异</label></div><div class="ws-dup-reasons"><p>${h(reasonLines.join('；'))}</p>${differenceLines.length?`<p>差异：${h(differenceLines.join('；'))}</p>`:''}${pair.kind==='related'?'<p>资金用途尚未确认，请保留两边记录。</p>':''}</div><table class="ws-compare-table"><thead><tr><th scope="col">字段</th><th scope="col">记录一 <small>${h(pair.leftEntry.origin)}</small><button type="button" class="ws-text-button" data-dup-record="left" aria-label="查看记录一及来源">查看账单/来源</button></th><th scope="col">记录二 <small>${h(pair.rightEntry.origin)}</small><button type="button" class="ws-text-button" data-dup-record="right" aria-label="查看记录二及来源">查看账单/来源</button></th></tr></thead><tbody>${rows.map(r=>`<tr data-field="${r.field}" class="${r.different?'is-different':''}" ${state.onlyDifferences&&!r.different?'hidden':''}><th scope="row">${r.name}</th><td>${h(r.left)}</td><td>${h(r.right)}</td></tr>`).join('')}</tbody></table><p id="ws-dup-no-differences" class="helper-text" ${!state.onlyDifferences||rows.some(r=>r.different)?'hidden':''}>对照字段没有差异；请结合上方来源依据判断。</p>${pair.evidence&&['bank-balance-chain','different-bank-balances'].includes(pair.evidence.type)?`<details class="ws-dup-chain" data-dup-disclosure="chain"><summary>查看银行流水依据${pair.evidence.rows?' · '+pair.evidence.rows.length+' 条':''}</summary><p>${h(pair.evidence.limitation||'已有银行来源记录提供的不同入账依据，不代表确认交易用途。')}</p><div data-dup-chain-body></div></details>`:''}`:'<div class="ws-empty">未发现当前类型的线索。没有提示不代表任何输入都已证明不存在重复。</div>'}</div></div>${rules}<p id="ws-dup-status" class="ws-status" role="status"></p><div class="ws-dup-footer">${returnButton}<span class="helper-text">所有判断在本机完成；这里只查看，不改账。</span></div></section>`;
    el('ws-dup-kind').onchange=()=>{if(!this.workspaceDuplicateFresh())return;state.kind=el('ws-dup-kind').value;state.page=0;state.selectedKey='';this.renderWorkspaceDuplicateView('ws-dup-kind');};
    el('ws-dup-query').oninput=()=>{if(!this.workspaceDuplicateFresh())return;state.query=el('ws-dup-query').value;state.page=0;this.renderWorkspaceDuplicateView('ws-dup-query');};
    for(const node of document.querySelectorAll('[data-dup-key]'))node.onclick=()=>{if(!this.workspaceDuplicateFresh())return;state.selectedKey=node.dataset.dupKey;this.renderWorkspaceDuplicateView('ws-dup-selected-title');};
    el('ws-dup-prev').onclick=()=>{if(this.workspaceDuplicateFresh()){state.page--;state.selectedKey='';this.renderWorkspaceDuplicateView('ws-dup-prev');}};
    el('ws-dup-next').onclick=()=>{if(this.workspaceDuplicateFresh()){state.page++;state.selectedKey='';this.renderWorkspaceDuplicateView('ws-dup-next');}};
    if(el('ws-dup-differences'))el('ws-dup-differences').onchange=()=>{if(!this.workspaceDuplicateFresh()){el('ws-dup-differences').checked=state.onlyDifferences;return;}state.onlyDifferences=el('ws-dup-differences').checked;document.querySelectorAll('.ws-compare-table tbody tr').forEach(row=>row.hidden=state.onlyDifferences&&!row.classList.contains('is-different'));el('ws-dup-no-differences').hidden=!state.onlyDifferences||rows.some(r=>r.different);};
    for(const node of document.querySelectorAll('[data-dup-record]'))node.onclick=()=>{if(!this.workspaceDuplicateFresh())return;state.recordSide=node.dataset.dupRecord;state.view='record';this.renderWorkspaceDuplicateView('ws-dup-back');};
    const chain=document.querySelector('.ws-dup-chain');if(chain)chain.ontoggle=()=>{if(!chain.open||chain.dataset.loaded)return;const evidence=pair.evidence,rows=evidence.rows||[];chain.querySelector('[data-dup-chain-body]').innerHTML=rows.length?`<table class="ws-compare-table"><thead><tr><th>时间</th><th>金额</th><th>账后余额</th><th>页 / 行</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${h(r.date)}</td><td>${h(r.amount)} ${h(r.currency)}</td><td>${h(Number.isSafeInteger(r.bankBalanceCents)?(r.bankBalanceCents/100).toFixed(2):'未提供')}</td><td>${h(r.sourcePage)} / ${h(r.sourceRow)}</td></tr>`).join('')}</tbody></table>`:`<p>${h((pair.reasons||[]).join('；'))}</p>`;chain.dataset.loaded='true';};
    for(const node of document.querySelectorAll('[data-dup-disclosure]'))if(opened.has(node.dataset.dupDisclosure))node.open=true;
   }
   el('ws-dup-refresh').onclick=()=>{this.ws.duplicateView=this.buildWorkspaceDuplicateView();this.renderWorkspaceDuplicateView('ws-dup-refresh');};
   if(el('ws-dup-return-draft'))el('ws-dup-return-draft').onclick=()=>{if(!this.workspaceDuplicateFresh())return;const d=this.ws.drafts.find(d=>d.id===state.returnDraftId);if(!d){el('ws-dup-status').textContent='这条草稿已不在当前工作区。';return;}this.closeModal();this.ws.focusId=d.id;this.ws.filter=d.status;this.ws.reviewPane='detail';this.openWorkspaceSection('workspace-review');};
   const heading=el('modal-body').querySelector('h3');if(heading)heading.id='modal-title';
   if(focusId){const node=el(focusId);if(node&&!node.disabled){node.focus({preventScroll:true});if(selection)node.setSelectionRange(...selection);}else el('ws-dup-selected-title')?.focus({preventScroll:true});}
  }
 });}};
})(globalThis);
