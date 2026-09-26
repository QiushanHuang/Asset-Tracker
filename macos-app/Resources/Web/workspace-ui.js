(function (root) {
  'use strict';
  const W=root.AssetTrackerWorkspace, P=root.AssetTrackerAgent, el=id=>document.getElementById(id);
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const storageKey='assetTracker.workspace.v1';
  const uid=()=>{if(root.crypto?.randomUUID)return root.crypto.randomUUID();if(root.crypto?.getRandomValues){const b=new Uint8Array(16);root.crypto.getRandomValues(b);return Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');}throw Error('当前环境缺少安全随机数，请使用桌面 App 或现代浏览器');};
  const money=(n,currency='CNY')=>new Intl.NumberFormat('zh-CN',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const native=()=>!!window.AssetTrackerHost?.isNative;
  const button=(action,label,cls='ws-text-button')=>`<button type="button" class="${cls}" data-ws-action="${action}">${label}</button>`;
  const options=(items,value,empty='请选择')=>`<option value="">${empty}</option>`+items.map(x=>`<option value="${h(x.id)}" ${x.id===value?'selected':''}>${h(x.name)}</option>`).join('');
  root.AssetTrackerWorkspaceUI={install(Tracker){
    const oldDashboard=Tracker.prototype.updateDashboard;
    Tracker.prototype.updateDashboard=function(...args){oldDashboard.apply(this,args);if(this.ws?.ready)this.renderWorkspace();};
    const oldProjects=Tracker.prototype.renderProjectWorkspace;
    Tracker.prototype.renderProjectWorkspace=function(...args){oldProjects.apply(this,args);if(this.ws?.ready){const badge=el('active-project-status');if(badge)badge.hidden=!this.activeProjectId||!!el('nas')?.classList.contains('active');}};
    const oldTransactions=Tracker.prototype.renderTransactions;
    Tracker.prototype.renderTransactions=function(...args){oldTransactions.apply(this,args);if(!this.ws?.ready)return;el('transactions-tbody').querySelectorAll('[data-edit-transaction]').forEach(node=>{const t=this.data.transactions.find(t=>t.id===node.dataset.editTransaction);if(!t?.reviewSource)return;const source=document.createElement('button');source.type='button';source.className='btn btn-sm';source.dataset.wsAction='source-record';source.dataset.id=t.id;source.textContent='来源';node.parentElement.append(source);});};
    const oldTrend=Tracker.prototype.updateAssetTrendChart,oldPie=Tracker.prototype.updateAssetPieChart,oldFill=Tracker.prototype.fillToToday;
    Tracker.prototype.updateAssetTrendChart=function(){
      if(!this.ws?.ready)return oldTrend.call(this);
      this.charts.assetTrend?.destroy();delete this.charts.assetTrend;
      const canvas=el('assetTrendChart');canvas.setAttribute('aria-label','净资产历史趋势，按当前设置汇率折算');if(canvas.closest('[data-ws-module]')?.hidden)return;
      if(!this.data.transactions.length){canvas.hidden=true;let empty=el('workspace-trend-empty');if(!empty){empty=document.createElement('p');empty.id='workspace-trend-empty';empty.className='chart-empty';canvas.parentElement.append(empty);}empty.textContent='记录第一笔账单后，这里会显示资金变化。';empty.hidden=false;return;}
      if(el('workspace-trend-empty'))el('workspace-trend-empty').hidden=true;canvas.hidden=false;
      const days=Math.min(365,Number(el('trend-time-range').value)||365),snapshot=root.AssetTrackerAnalytics.snapshot(this.data,{asOf:W.today(),trendDays:days,forecastDays:1});
      this.charts.assetTrend=new Chart(canvas.getContext('2d'), {
        type:'line',
        data:{labels:snapshot.trend.map(r=>r.date.slice(5).replace('-','/')),datasets:[{label:'净资产',data:snapshot.trend.map(r=>r.missing.length?null:r.net),borderColor:'#8776df',backgroundColor:'rgba(135,118,223,.09)',fill:true,borderWidth:2,pointRadius:2,pointHoverRadius:5,tension:.15}]},
        options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{
          x:{grid:{color:'rgba(140,150,175,.1)'},ticks:{maxTicksLimit:8,maxRotation:0,color:'#7c87a0',font:{size:11}}},
          y:{grid:{color:'rgba(140,150,175,.13)'},ticks:{maxTicksLimit:5,color:'#7c87a0',font:{size:11},callback:v=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0}).format(v)}}
        }}
      });
    };
    Tracker.prototype.updateAssetPieChart=function(){if(this.ws?.ready&&el('assetPieChart')?.closest('[data-ws-module]')?.hidden){this.charts.assetPie?.destroy();delete this.charts.assetPie;return;}return oldPie.call(this);};
    Tracker.prototype.fillToToday=async function(ruleId){if(!this.ws?.ready)return oldFill.call(this,ruleId);try{this.assertWorkspaceWritable();const rule=this.data.automationRules.find(r=>r.id===ruleId);if(!rule)throw Error('规则不存在');const candidates=W.ruleDrafts(this.data,rule,W.today(),root.AssetTrackerAnalytics.scheduled);const known=new Set(this.ws.drafts.map(d=>d.id));const drafts=candidates.filter(d=>!known.has(d.id));if(this.ws.drafts.filter(d=>d.status==='pending').length+drafts.length>1000)throw Error('请先处理已有草稿');this.ws.drafts.push(...drafts);await this.persistWorkspace();this.workspaceMessage(`已准备 ${drafts.length} 笔周期草稿，确认前不会改变余额。`);this.ws.focusId=drafts[0]?.id;this.openWorkspaceSection('workspace-review');this.renderWorkspace();}catch(e){this.workspaceMessage(e.message);this.showMessage(e.message,'error');}};
    for(const method of ['importFullBook','resetToDefaultData'])if(Tracker.prototype[method]){
      const original=Tracker.prototype[method];
      Tracker.prototype[method]=async function(...args){
        if(this.ws?.ready&&this.ws.draftTimer){clearTimeout(this.ws.draftTimer);this.ws.draftTimer=null;try{await this.persistWorkspace();}catch(e){this.workspaceMessage('请先保存当前草稿，再替换账本。'+e.message);return false;}}
        const committed=await original.apply(this,args);
        if(this.ws?.ready&&committed===true){
          this.cancelWorkspaceAgent();
          try{await this.ws.writeChain;await this.archiveWorkspaceStorage();this.ws.scope=this.data.workspaceScope||'legacy-local';this.ws.drafts=[];this.ws.runs=[];this.ws.rules=[];this.ws.connection={...this.ws.connection,enabled:false,allowText:false,allowExamples:false};this.ws.storageReadOnly=false;await this.persistWorkspace();}
          catch(e){this.ws.drafts=[];this.ws.connection.enabled=false;this.ws.storageReadOnly=true;this.workspaceMessage('账本已替换；旧工作区未套用，原暂存保留。'+e.message);}
          this.renderWorkspace();
        }
        return committed;
      };
    }
    Object.assign(Tracker.prototype,{
      async setupWorkspace(){
        if(!el('workspace-cashflow')?.ownerDocument||this.ws)return;
        this.ws={ready:false,scope:this.data.workspaceScope||'legacy-local',storageReadOnly:false,loadedText:native()?'{}':null,rawReadable:false,prefs:W.preferences(),drafts:[],runs:[],rules:[],connection:P.connection(),selected:new Set(),filter:'pending',message:'',writeChain:Promise.resolve(),sessionKeys:new Map()};
        try{const raw=native()?await window.AssetTrackerHost.invoke('workspace.load'):localStorage.getItem(storageKey);
          this.ws.loadedText=raw;this.ws.rawReadable=true;
          const saved=JSON.parse(typeof raw==='string'?raw:'{}');
          if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('暂存格式无效');
          this.ws.prefs=W.preferences(saved.prefs);
          if(Object.keys(saved).length&&(saved.scope||'legacy-local')!==this.ws.scope)throw Error('账本已更换，旧草稿与模型授权已隔离');
          if(saved.drafts!==undefined&&(!Array.isArray(saved.drafts)||saved.drafts.some(d=>!d||typeof d.id!=='string'||!/^[a-zA-Z0-9:_-]{1,180}$/.test(d.id)||!['pending','dismissed','committed'].includes(d.status))))throw Error('草稿暂存格式无效');
          this.ws.drafts=W.compactDrafts(saved.drafts||[]);
          this.ws.runs=Array.isArray(saved.runs)?saved.runs.filter(r=>r&&typeof r==='object').slice(-100):[];
          this.ws.rules=Array.isArray(saved.rules)?saved.rules.filter(r=>r&&typeof r.match==='string'&&typeof r.purpose==='string').slice(0,200):[];
          try{this.ws.connection=P.connection(saved.connection);}catch{this.ws.connection=P.connection();}
          this.ws.drafts=W.reconcile(this.data,this.ws.drafts);
        }catch(e){this.ws.storageReadOnly=true;this.ws.connection.enabled=false;this.ws.drafts=[];this.ws.message='工作区暂存未能安全打开，原内容已保留；正式账本不受影响。'+e.message;}
        this.ws.ready=true;this.workspaceReady=true;
        this.ws.period=this.ws.prefs.defaultPeriod;
        el('workspace-period').value=this.ws.period;
        el('workspace-period').addEventListener('change',()=>{this.ws.period=el('workspace-period').value;this.renderWorkspace();});
        el('workspace-edit-layout').addEventListener('click',()=>this.openWorkspaceSettings('layout'));

        el('workspace-agent-form').addEventListener('submit',event=>{event.preventDefault();this.runWorkspaceAgent(el('workspace-agent-input').value);});
        document.addEventListener('click',event=>{const node=event.target.closest?.('[data-ws-action]');if(!node)return;this.workspaceAction(node.dataset.wsAction,node);});
        document.addEventListener('keydown',event=>{if(event.defaultPrevented)return;
          if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();this.focusWorkspaceAssistant();}
          else if(event.key.toLowerCase()==='n'&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.target.closest?.('input,textarea,select,[contenteditable="true"],#modal')){event.preventDefault();this.showTransactionModal();}
        });
        this.applyWorkspacePreferences(this.ws.prefs);this.renderWorkspace();this.updateAssetTrendChart();this.updateAssetPieChart();this.renderWorkspaceReview();this.renderWorkspaceSettings();
      },
      workspaceScopeId(){return 'book-'+uid();},
      assertWorkspaceWritable(){if(this.ws.scope!==(this.data.workspaceScope||'legacy-local'))throw Error('账本正在切换，工作区修改已暂停，请完成恢复后继续');if(this.ws.storageReadOnly)throw Error('工作区暂存处于保护状态，请在设置中恢复后再操作');},
      workspaceState(prefs=this.ws.prefs){return {schemaVersion:1,scope:this.ws.scope,prefs:W.preferences(prefs),connection:P.connection(this.ws.connection),drafts:W.compactDrafts(this.ws.drafts),runs:this.ws.runs.slice(-100),rules:this.ws.rules};},
      persistWorkspace(prefs){
        const write=async()=>{
          this.assertWorkspaceWritable();const text=JSON.stringify(this.workspaceState(prefs));if(text.length>2*1024*1024)throw Error('草稿存储已满，请导出暂存并处理待核对记录');
          if(native())await window.AssetTrackerHost.invoke('workspace.save',{text,expectedText:this.ws.loadedText});
          else{if(!window.navigator?.locks?.request)throw Error('当前浏览器缺少跨窗口保护，请使用支持 Web Locks 的浏览器或桌面 App');
            await window.navigator.locks.request(storageKey,()=>{if(localStorage.getItem(storageKey)!==this.ws.loadedText)throw Error('工作区已在其他窗口更改，请重新打开后继续；本次没有覆盖');localStorage.setItem(storageKey,text);});}
          this.ws.loadedText=text;this.ws.drafts=W.compactDrafts(this.ws.drafts);
        };
        const next=this.ws.writeChain.then(write,write);this.ws.writeChain=next.catch(()=>{});return next;
      },
      async archiveWorkspaceStorage(){
        if(!this.ws.rawReadable)throw Error('原暂存无法读取，请打开数据目录保留原文件后恢复');
        if(native()){await window.AssetTrackerHost.invoke('workspace.reset',{expectedText:this.ws.loadedText});}
        else{if(!window.navigator?.locks?.request)throw Error('当前浏览器缺少跨窗口保护');await window.navigator.locks.request(storageKey,()=>{const raw=localStorage.getItem(storageKey);if(raw!==this.ws.loadedText)throw Error('工作区已在其他窗口更改，请重新打开后再恢复');if(raw!==null)localStorage.setItem(storageKey+'.recovery.'+uid(),raw);localStorage.setItem(storageKey,'{}');});}
        this.ws.loadedText='{}';
      },
      async recoverWorkspace(){if(!window.confirm('将先保留原工作区副本，再重新建立布局、草稿和连接设置；正式账本不变。是否继续？'))return;
        try{await this.ws.writeChain;await this.archiveWorkspaceStorage();this.ws.scope=this.data.workspaceScope||'legacy-local';this.ws.drafts=[];this.ws.runs=[];this.ws.rules=[];this.ws.connection=P.connection();this.ws.storageReadOnly=false;this.ws.commitUncertain=false;await this.persistWorkspace();this.workspaceMessage('工作区已恢复，原暂存副本已保留。');this.renderWorkspace();this.renderWorkspaceSettings();}
        catch(e){this.ws.storageReadOnly=true;this.workspaceMessage(e.message);}
      },
      renderWorkspaceRecovery(){let node=el('workspace-recovery');if(!node){node=document.createElement('div');node.id='workspace-recovery';el('workspace-settings-status')?.after(node);}if(!node)return;node.hidden=!this.ws.storageReadOnly;node.className='ws-permission-box';node.innerHTML='<strong>暂存保护</strong><p class="helper-text">原始草稿与设置仍在原位置。恢复会先保留副本；普通记账仍使用原账本保存机制。</p>'+button('workspace-export-raw','导出暂存副本','btn btn-secondary')+' '+button('workspace-reset','保留副本并恢复','btn btn-secondary')+' '+button('workspace-reload','重新读取','ws-text-button')+(native()?' '+button('workspace-folder','打开数据目录','ws-text-button'):'');},
      openWorkspaceSection(section){document.querySelector(`.nav-link[data-section="${section}"]`)?.click();},
      workspaceNavigated(section){if(!this.ws?.ready)return;if(section!=='workspace-settings')this.applyWorkspacePreferences(this.ws.prefs);
        document.documentElement.classList.remove('ws-mobile-more');document.querySelector('.main-content')?.scrollTo?.({top:0});window.scrollTo?.({top:0});
        el('workspace-edit-layout').hidden=section!=='dashboard';el('workspace-period-controls').hidden=section!=='dashboard';
        if(section==='workspace-review')this.renderWorkspaceReview();
        if(section==='workspace-settings')this.renderWorkspaceSettings();
      },
      workspaceAction(action,node){
        if(!this.ws?.ready)return;
        if(action==='quick-entry')this.showTransactionModal();
        else if(action==='dashboard')this.openWorkspaceSection('dashboard');
        else if(action==='mobile-more'){document.documentElement.classList.toggle('ws-mobile-more');window.scrollTo?.({top:0});}
        else if(action==='workspace-reset')this.recoverWorkspace();
        else if(action==='workspace-folder')this.fileAdapter.revealDataFolder().catch(e=>this.workspaceMessage(e.message));
        else if(action==='workspace-reload')window.location?.reload();
        else if(action==='workspace-export-raw'){if(!this.ws.rawReadable||typeof this.ws.loadedText!=='string'){this.workspaceMessage('原暂存未能读取，不能生成原始副本；请打开数据目录保留原文件。');return;}const text=this.ws.loadedText;this.fileAdapter.saveFile({suggestedName:'工作区暂存副本.json',mimeType:'application/json',text}).catch(e=>this.workspaceMessage(e.message));}
        else if(action==='source-record'){const t=this.data.transactions.find(t=>t.id===node.dataset.id);if(t?.reviewSource){el('modal-body').innerHTML=`<h3>这笔记录的来源</h3><p class="helper-text">${h(t.date)} · ${h(t.description)}</p><pre class="ws-source-text">${h(t.reviewSource.text||'手工草稿')}</pre><p>${h(t.reviewSource.evidence||'经用户核对后入账')}</p>`;this.showModal();}}
        else if(action==='rule-edit')this.editWorkspaceRule(node.dataset.id);
        else if(action==='layout'||action==='connection')this.openWorkspaceSettings(action);
        else if(action==='review')this.openWorkspaceSection('workspace-review');
        else if(action==='transactions'||action==='projects'||action==='automation'){this.closeModal();this.openWorkspaceSection(action);}
        else if(action==='explain')this.explainWorkspaceCashflow();
        else if(action==='duplicates')this.showWorkspaceDuplicates();
        else if(action==='cancel-agent')this.cancelWorkspaceAgent();
        else if(action==='select-draft'){this.ws.reviewPane='detail';this.ws.focusId=node.dataset.id;this.renderWorkspaceReview();}
        else if(action==='review-list'){this.ws.reviewPane='list';this.renderWorkspaceReview();}
        else if(action==='draft-source'){const d=this.ws.drafts.find(d=>d.id===this.ws.focusId);if(d){el('modal-body').innerHTML='<h3>原始记录</h3><pre class="ws-source-text">'+h(d.sourceText||'无原始文本')+'</pre>';this.showModal();}}
        else if(action==='new-draft')this.newWorkspaceDraft();
        else if(action==='import')this.importData();
        else if(action==='commit-selected')this.commitWorkspaceDrafts([...this.ws.selected]);
        else if(action==='dismiss-draft')this.dismissWorkspaceDraft(node.dataset.id);
        else if(action==='retry-run'){const run=this.ws.runs.find(r=>r.id===node.dataset.id);const d=this.ws.drafts.find(x=>x.id===run?.draftId);if(d)this.runWorkspaceAgent(d.sourceText||d.proposal?.description||'');else{this.focusWorkspaceAssistant();}}
        else if(action==='rule-toggle'){const r=this.ws.rules.find(r=>r.id===node.dataset.id);if(r){r.enabled=!r.enabled;this.persistWorkspace().then(()=>this.renderWorkspaceRules()).catch(e=>this.workspaceMessage(e.message));}}
      },
      workspaceMessage(message){this.ws.message=String(message);if(el('workspace-review-status'))el('workspace-review-status').textContent=this.ws.message;if(el('workspace-settings-status'))el('workspace-settings-status').textContent=this.ws.message;if(this.ws.storageReadOnly)this.renderWorkspaceRecovery();},
      applyWorkspacePreferences(prefs){
        const p=W.preferences(prefs);document.documentElement.dataset.workspaceTheme=p.theme;document.documentElement.dataset.workspaceDensity=p.density;document.documentElement.dataset.metricEmphasis=p.metricEmphasis;
        for(const [index,m] of p.modules.entries()){const node=document.querySelector(`[data-ws-module="${m.id}"]`);if(!node)continue;node.hidden=!m.visible;node.style.order=String(index);node.dataset.width=m.width;node.dataset.variant=m.variant;}
        el('workspace-empty-layout').hidden=p.modules.some(m=>m.visible);
      },
      renderWorkspace(){
        if(!this.ws?.ready)return;this.ws.drafts=W.reconcile(this.data,this.ws.drafts);if(el('active-project-status'))el('active-project-status').hidden=!this.activeProjectId||!!el('nas')?.classList.contains('active');
        const flow=W.cashflow(this.data,W.today(),this.ws.period),currency=this.data.settings.baseCurrency;
        this.ws.flow=flow;el('workspace-period-label').textContent=`${flow.from.slice(5).replace('-','/')} — ${flow.to.slice(5).replace('-','/')} · ${currency}`;
        const totals=this.calculateTotals(this.data.categories);for(const [selector,value] of [['.total-assets',totals.totalAssets],['.current-balance',totals.currentBalance],['.debt-assets',totals.totalDebt]]){const node=document.querySelector(selector);if(node&&Number.isFinite(value))node.textContent=money(value,currency);}
        const missingAssets=[...new Set(W.accounts(this.data).filter(a=>a.node.balance!==0&&a.currency!==currency&&!(Number.isFinite(this.data.settings.exchangeRates[a.currency])&&this.data.settings.exchangeRates[a.currency]>0)).map(a=>a.currency))];
        if(missingAssets.length){for(const selector of ['.total-assets','.current-balance','.debt-assets'])document.querySelector(selector).textContent='—';el('net-assets-note').textContent=`${missingAssets.join('、')} 尚未折算；请补充汇率后查看完整资产。`;}
        const label=this.ws.period==='last-30-days'?'期间':'本月';
        el('workspace-cashflow').innerHTML=[['结余',flow.net,'net'],['收入',flow.income,'income'],['支出',flow.expense,'expense']].map(([name,value,key])=>`<div class="ws-money-metric" data-metric="${key}"><span>${label}${name}</span><strong>${flow.missing.length?'—':h(money(value,currency))}</strong></div>`).join('')+(flow.missing.length?`<p class="ws-inline-note">缺少 ${h(flow.missing.join('、'))} 汇率，完整合计暂不显示。${button('transactions','查看账单')}</p>`:'');
        const pending=this.ws.drafts.filter(d=>d.status==='pending');el('workspace-review-badge').textContent=String(pending.length);
        const suspected=pending.filter(d=>d.suspected).length,errors=pending.filter(d=>d.error).length;
        el('workspace-review-summary').innerHTML=`<div class="ws-section-heading"><h3>待核对 <span class="ws-badge">${pending.length}</span></h3>${button('review','查看全部')}</div>`+(pending.length?`<div class="ws-summary-row"><span>记录与分类待确认</span><strong>${pending.length-suspected-errors}</strong></div><div class="ws-summary-row"><span>疑似重复</span><strong>${suspected}</strong></div>${errors?`<div class="ws-summary-row"><span>信息待补齐</span><strong>${errors}</strong></div>`:''}${button('review','去核对','btn ws-soft-button')}`:`<div class="ws-empty-small">暂时没有需要核对的记录</div>${button('import','导入账单')}`);
        const active=(this.data.automationRules||[]).filter(r=>r.active).length;
        el('workspace-automation-summary').innerHTML=`<div class="ws-section-heading"><h3>自动化</h3>${button('automation','管理')}</div><div class="ws-summary-row"><span>启用的周期规则</span><strong>${active}</strong></div><div class="ws-summary-row"><span>分类整理规则</span><strong>${this.ws.rules.filter(r=>r.enabled).length}</strong></div><p class="helper-text">先预览待补齐项，再确认入账。</p>`;
        const records=[...(this.data.transactions||[])].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,this.ws.prefs.recentCount);
        const names=new Map(W.accounts(this.data).map(a=>[a.id,a.name]));
        el('recent-transactions-list').innerHTML=records.length?`<div class="ws-ledger-table"><table><thead><tr><th>日期</th><th>描述</th><th>分类 / 账户</th><th>金额</th></tr></thead><tbody>${records.map(t=>`<tr><td>${h(t.date.slice(5).replace('T',' '))}</td><td>${h(t.description||'未填写描述')}</td><td>${h(t.purpose||names.get(t.accountId)||t.category)}</td><td class="ws-amount ${t.amount>0?'positive':''}">${t.amount>0?'+':''}${h(money(t.amount,t.currency||currency))}</td></tr>`).join('')}</tbody></table></div>`:`<div class="ws-empty">还没有账单。${button('new-draft','准备第一笔草稿')}，或直接使用右上角记账。</div>`;
        const projects=(this.data.expenseProjects||[]).filter(p=>!p.archived);
        el('workspace-project-summary').innerHTML=`<div class="ws-section-heading"><h3>项目概览</h3>${button('projects','管理项目')}</div>`+(projects.length?projects.slice(0,5).map(p=>`<div class="ws-summary-row"><span>${h(p.name)}</span><span>${this.data.transactions.filter(t=>t.projectId===p.id).length} 笔</span></div>`).join(''):'<p class="helper-text">为旅行、装修或活动单独汇总。</p>');
        this.renderWorkspaceRules();
      },
      openWorkspaceSettings(tab='layout'){this.ws.settingsTab=tab;this.openWorkspaceSection('workspace-settings');this.renderWorkspaceSettings();},
      renderWorkspaceSettings(){
        if(!this.ws?.ready)return;this.renderWorkspaceRecovery();const connection=this.ws.settingsTab==='connection';el('workspace-layout-settings').hidden=connection;el('workspace-connection-settings').hidden=!connection;
        if(connection){this.renderWorkspaceConnection();return;}
        this.ws.prefsDraft=clone(this.ws.prefs);this.renderWorkspaceLayoutEditor();
      },
      renderWorkspaceLayoutEditor(){
        const p=this.ws.prefsDraft;
        el('workspace-layout-settings').innerHTML=`<div class="ws-section-heading"><div><h3>你的首页，由你安排</h3><p class="helper-text">调整模块只改变这台设备的界面，不改变账本或后台任务。</p></div><select id="ws-preset" aria-label="布局预设"><option value="">套用预设</option><option value="daily">日常</option><option value="analysis">分析</option><option value="automation">自动化</option></select></div><div class="ws-settings-fields"><label>外观<select id="ws-theme">${['light','dark','system'].map((v,i)=>`<option value="${v}" ${p.theme===v?'selected':''}>${['浅色','深色','跟随系统'][i]}</option>`).join('')}</select></label><label>信息密度<select id="ws-density"><option value="comfortable">舒适</option><option value="compact" ${p.density==='compact'?'selected':''}>紧凑</option></select></label><label>主要指标<select id="ws-emphasis"><option value="cashflow">结余、收入与支出</option><option value="net-assets" ${p.metricEmphasis==='net-assets'?'selected':''}>净资产</option></select></label><label>默认期间<select id="ws-default-period"><option value="month-to-date">本月</option><option value="last-30-days" ${p.defaultPeriod==='last-30-days'?'selected':''}>最近 30 天</option></select></label><label>最近账单条数<select id="ws-recent-count">${[2,3,5,10,20].map(n=>`<option ${p.recentCount===n?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="ws-layout-editor"><div><div id="ws-module-list">${p.modules.map((m,i)=>`<div class="ws-module-setting" draggable="true" data-module-id="${m.id}"><label><input type="checkbox" data-module-visible="${m.id}" ${m.visible?'checked':''}>${h(W.MODULES.find(x=>x.id===m.id).name)}</label><div><select data-module-width="${m.id}" aria-label="${h(W.MODULES.find(x=>x.id===m.id).name)}宽度">${[['full','整行'],['wide','较宽'],['half','半宽'],['narrow','较窄']].map(([v,n])=>`<option value="${v}" ${m.width===v?'selected':''}>${n}</option>`).join('')}</select><button type="button" class="btn btn-sm" data-module-move="${m.id}" data-delta="-1" ${i===0?'disabled':''} aria-label="上移${h(W.MODULES.find(x=>x.id===m.id).name)}">上移</button><button type="button" class="btn btn-sm" data-module-move="${m.id}" data-delta="1" ${i===p.modules.length-1?'disabled':''} aria-label="下移${h(W.MODULES.find(x=>x.id===m.id).name)}">下移</button></div></div>`).join('')}</div></div><aside><h4>布局预览</h4><p class="helper-text">拖动模块或使用上移、下移按钮。</p><div id="ws-layout-preview"></div></aside></div><div class="ws-settings-footer"><button class="btn btn-primary" id="ws-save-layout">保存布局</button><button class="btn btn-secondary" id="ws-cancel-layout">取消</button><button class="ws-text-button" id="ws-reset-layout">恢复默认布局</button></div>`;
        const panel=el('workspace-layout-settings');
        panel.onchange=event=>{if(event.target.id==='ws-preset'){this.ws.prefsDraft=W.preset(event.target.value);this.renderWorkspaceLayoutEditor();return;}
          p.theme=el('ws-theme').value;p.density=el('ws-density').value;p.metricEmphasis=el('ws-emphasis').value;p.defaultPeriod=el('ws-default-period').value;p.recentCount=Number(el('ws-recent-count').value);
          panel.querySelectorAll('[data-module-visible]').forEach(n=>p.modules.find(m=>m.id===n.dataset.moduleVisible).visible=n.checked);panel.querySelectorAll('[data-module-width]').forEach(n=>p.modules.find(m=>m.id===n.dataset.moduleWidth).width=n.value);this.previewWorkspaceLayout();};
        panel.querySelectorAll('[data-module-move]').forEach(n=>n.onclick=()=>{const index=p.modules.findIndex(m=>m.id===n.dataset.moduleMove),to=index+Number(n.dataset.delta);if(to<0||to>=p.modules.length)return;const [item]=p.modules.splice(index,1);p.modules.splice(to,0,item);this.renderWorkspaceLayoutEditor();el('ws-module-list').querySelector(`[data-module-move="${item.id}"][data-delta="${n.dataset.delta}"]`)?.focus();});
        panel.querySelectorAll('[data-module-id]').forEach(n=>{n.ondragstart=e=>{this.ws.dragId=n.dataset.moduleId;e.dataTransfer?.setData('text/plain',this.ws.dragId);};n.ondragover=e=>e.preventDefault();n.ondrop=e=>{e.preventDefault();const from=p.modules.findIndex(m=>m.id===this.ws.dragId),to=p.modules.findIndex(m=>m.id===n.dataset.moduleId);if(from<0||to<0)return;const [item]=p.modules.splice(from,1);p.modules.splice(to,0,item);this.renderWorkspaceLayoutEditor();};});
        el('ws-save-layout').onclick=()=>this.saveWorkspacePreferences();el('ws-cancel-layout').onclick=()=>this.cancelWorkspacePreferences();el('ws-reset-layout').onclick=()=>{this.ws.prefsDraft=W.preferences();this.renderWorkspaceLayoutEditor();};this.previewWorkspaceLayout();
      },
      previewWorkspaceLayout(){const p=this.ws.prefsDraft;this.applyWorkspacePreferences(p);el('ws-layout-preview').innerHTML=p.modules.filter(m=>m.visible).map(m=>`<div class="ws-preview-module" data-width="${m.width}"><strong>${h(W.MODULES.find(x=>x.id===m.id).name)}</strong><span>${m.id==='cashflow'&&this.ws.flow?h(money(this.ws.flow.net,this.data.settings.baseCurrency)):m.id==='review'?this.ws.drafts.filter(d=>d.status==='pending').length+' 笔待核对':m.id==='assistant'?'有依据的建议':'按当前账本显示'}</span></div>`).join('')||'<p class="helper-text">所有普通模块已隐藏，仍可通过导航访问功能。</p>';},
      async saveWorkspacePreferences(){try{const next=W.preferences(this.ws.prefsDraft);await this.persistWorkspace(next);this.ws.prefs=next;this.ws.period=next.defaultPeriod;el('workspace-period').value=this.ws.period;this.applyWorkspacePreferences(next);this.renderWorkspace();this.workspaceMessage('布局已保存。');}catch(e){this.applyWorkspacePreferences(this.ws.prefs);this.workspaceMessage('布局保存失败：'+e.message);}},
      cancelWorkspacePreferences(){this.ws.prefsDraft=clone(this.ws.prefs);this.applyWorkspacePreferences(this.ws.prefs);this.renderWorkspaceLayoutEditor();this.workspaceMessage('已取消本次布局修改。');},
      async newWorkspaceDraft(){try{this.assertWorkspaceWritable();if(this.ws.drafts.filter(d=>d.status==='pending').length>=1000)throw Error('草稿列表已满，请先处理现有记录');const d={id:uid(),status:'pending',source:'manual',sourceText:'手工准备的草稿',proposal:{date:W.today(),amount:'',direction:'expense',currency:this.data.settings.baseCurrency,accountId:'',purpose:'',description:'',projectId:'',expenseCategoryId:''}};this.ws.drafts.push(d);this.ws.focusId=d.id;this.ws.reviewPane='detail';await this.persistWorkspace();this.openWorkspaceSection('workspace-review');this.renderWorkspace();}catch(e){this.workspaceMessage(e.message);}},
      canQueueWorkspaceImport(plan){
        if(!this.ws?.ready||!plan||plan.total>1000||plan.errors.length)return false;
        return [...plan.accepted,...plan.suspected].every(({transaction})=>{
          try{
            const draft=W.fromTransaction(transaction,'import-compatibility');
            W.proposal(this.data,draft.proposal);
            // Preserve upstream import values that the editable draft contract cannot round-trip.
            return W.transactionId(draft)===transaction.id&&(transaction.type||'单次')==='单次'&&!transaction.includeTime
              &&!transaction.transferId&&!['wechat','alipay','icbc','ocbc'].some(provider=>transaction[provider]);
          }catch{return false;}
        });
      },
      async queueWorkspaceImport(plan,rows){
        this.assertWorkspaceWritable();
        if(this.ws.drafts.filter(d=>d.status==='pending').length+plan.total>1000)throw Error('待核对最多保留 1,000 笔，请先处理草稿或分批导入');
        const batchId=uid(), pending=[];
        for(const {row,transaction} of [...plan.accepted,...plan.suspected]){const d=W.fromTransaction(transaction,uid());d.batchId=batchId;d.sourceText=`导入第 ${row} 行\n`+JSON.stringify(rows[row-2]);d.suspected=plan.suspected.some(x=>x.row===row);d.duplicateConfirmed=false;pending.push(d);}
        for(const error of plan.errors)pending.push({id:uid(),status:'pending',source:'import',batchId,error:error.message,sourceText:`导入第 ${error.row} 行\n`+JSON.stringify(rows[error.row-2]),proposal:{date:'',amount:'',direction:'expense',currency:this.data.settings.baseCurrency,accountId:'',purpose:'',description:'',projectId:'',expenseCategoryId:''}});
        this.ws.drafts.push(...pending);this.ws.focusId=pending[0]?.id;this.ws.selected=new Set(pending.filter(d=>!d.suspected).map(d=>d.id));await this.persistWorkspace();this.importPreview=null;
        this.workspaceMessage(`已准备 ${pending.length} 笔草稿，跳过 ${plan.duplicates.length} 笔已有记录。确认前不会改变余额。`);this.openWorkspaceSection('workspace-review');this.renderWorkspace();
      },
      renderWorkspaceReview(){
        if(!this.ws?.ready)return;this.ws.drafts=W.reconcile(this.data,this.ws.drafts);const pending=this.ws.drafts.filter(d=>d.status==='pending');
        this.ws.reviewBasis=JSON.stringify(this.data);const shown=this.ws.drafts.filter(d=>d.status===this.ws.filter);const focus=shown.find(d=>d.id===this.ws.focusId)||shown[0];this.ws.focusId=focus?.id;
        el('workspace-review-toolbar').innerHTML=`<div class="ws-section-heading"><div><h3>${pending.length?'有 '+pending.length+' 笔等待你核对':'记录都在掌握中'}</h3><p class="helper-text">${this.ws.filter==='pending'?'核对金额、账户和分类，确认后再入账。':'显示最近 200 条已处理草稿；完整记录和来源可在账单中查看。'}</p></div><div>${button('import','导入账单','btn btn-secondary')}${button('new-draft','新建草稿','btn btn-secondary')}</div></div><div class="ws-review-filters"><select id="ws-review-filter" aria-label="核对状态"><option value="pending">待核对</option><option value="committed">已入账</option><option value="dismissed">已忽略</option></select><label><input type="checkbox" id="ws-review-all">选择当前待核对项</label>${button('commit-selected','确认选中项','btn btn-primary')}<span>${this.ws.selected.size} 笔选中</span></div>`;
        el('workspace-review-toolbar').querySelector('[data-ws-action="commit-selected"]').disabled=!pending.some(d=>this.ws.selected.has(d.id))||this.ws.committing||this.ws.storageReadOnly;
        el('ws-review-filter').value=this.ws.filter;el('ws-review-filter').onchange=()=>{this.ws.filter=el('ws-review-filter').value;this.ws.selected.clear();this.renderWorkspaceReview();};
        el('ws-review-all').onchange=e=>{this.ws.selected=e.target.checked?new Set(shown.filter(d=>d.status==='pending'&&!d.suspected).map(d=>d.id)):new Set();this.renderWorkspaceReview();};
        el('workspace-review-list').innerHTML=shown.length?shown.map(d=>`<div class="ws-review-row ${focus?.id===d.id?'selected':''}"><label class="ws-review-select"><input type="checkbox" aria-label="选择${h(d.proposal?.description||'草稿')}" data-select-draft="${h(d.id)}" ${this.ws.selected.has(d.id)?'checked':''} ${d.status!=='pending'?'disabled':''}></label><button type="button" data-ws-action="select-draft" data-id="${h(d.id)}"><span><strong>${h(d.proposal?.description||'信息待补齐')}</strong><small>${h(d.proposal?.date||'待选日期')} · ${h(d.source==='assistant'?'模型建议':d.source==='import'?'文件导入':d.source==='rule'?'周期规则':'手工草稿')}</small></span><span class="ws-review-row-end"><strong>${d.proposal?.amount?h((d.proposal.direction==='expense'?'-':'+')+d.proposal.amount+' '+d.proposal.currency):'金额待补齐'}</strong><small>${h(d.error?'信息待补齐':d.suspected?'疑似重复':d.status==='committed'?'已入账':d.status==='dismissed'?'已忽略':'等待确认')}</small></span></button></div>`).join(''):'<div class="ws-empty">这里还没有记录。导入文件或让账本助手准备一笔草稿。</div>';
        el('workspace-review-list').querySelectorAll('[data-select-draft]').forEach(n=>n.onchange=()=>{n.checked?this.ws.selected.add(n.dataset.selectDraft):this.ws.selected.delete(n.dataset.selectDraft);this.renderWorkspaceReview();});
        this.renderWorkspaceDraftDetail(focus);el('workspace-review-status').textContent=this.ws.message;el('workspace-review').dataset.pane=this.ws.reviewPane||'list';
      },
      renderWorkspaceDraftDetail(d){
        if(!d){el('workspace-review-detail').innerHTML='<div class="ws-empty">选择记录后，原始内容和建议会显示在这里。</div>';return;}
        const p=d.proposal||{}, project=this.data.expenseProjects?.find(x=>x.id===p.projectId),pending=d.status==='pending';
        el('workspace-review-detail').innerHTML=`${button('review-list','← 返回列表','ws-text-button ws-review-back')}<h3>核对记录</h3><div class="ws-source"><div><strong>原始记录</strong>${button('draft-source','查看完整内容')}</div><p title="${h(d.sourceText||'无原始文本')}">${h(d.sourceText||'无原始文本')}</p></div>${d.error?`<p class="ws-status">${h(d.error)}</p>`:''}<form id="ws-draft-form"><fieldset ${!pending||this.ws.commitUncertain||this.ws.storageReadOnly?'disabled':''}><div class="ws-form-pair"><label>收支方向<select id="ws-draft-direction"><option value="expense">支出</option><option value="income" ${p.direction==='income'?'selected':''}>收入</option></select></label><label>日期<input type="date" id="ws-draft-date" value="${h(p.date?.slice(0,10))}" required></label></div><div class="ws-form-pair"><label>金额<input id="ws-draft-amount" inputmode="decimal" value="${h(p.amount)}" required></label><label>币种<input id="ws-draft-currency" maxlength="3" value="${h(p.currency)}" required></label></div><label>资金账户<select id="ws-draft-account" required>${options(W.accounts(this.data),p.accountId)}</select></label><div class="ws-form-pair"><label>用途分类<select id="ws-draft-purpose">${options((this.data.purposeCategories||[]).map(s=>({id:s,name:s})),p.purpose,'暂不分类')}</select></label><label>项目<select id="ws-draft-project">${options(this.data.expenseProjects||[],p.projectId,'日常 · 无项目')}</select></label></div><div class="ws-form-pair ws-detail-description"><label id="ws-draft-project-category-label" ${!project?.categories?.length?'hidden':''}>项目消费分类<select id="ws-draft-project-category">${options(project?.categories||[],p.expenseCategoryId,'暂不细分')}</select></label><label>描述<input id="ws-draft-description" maxlength="500" value="${h(p.description)}"></label></div>${d.suspected?'<label class="ws-check"><input type="checkbox" id="ws-draft-duplicate" '+(d.duplicateConfirmed?'checked':'')+'>这是一笔不同消费，保留这条疑似重复记录</label>':''}<div class="ws-suggestion">${h(d.evidence||'请核对金额与账户；模型和规则建议不代表已入账。')}${button('suggest-category','请求分类建议')}</div><label class="ws-check"><input id="ws-draft-rule" type="checkbox">将这次分类保存为可编辑规则</label><p class="helper-text ws-rule-note">同一描述与账户命中时整理分类，金额不变。</p><div class="ws-review-detail-actions"><button type="submit" class="btn btn-primary">确认这一笔</button><button type="button" id="ws-save-draft" class="btn btn-secondary">暂存修改</button></div></fieldset></form>${pending?`<button type="button" class="ws-text-button" data-ws-action="dismiss-draft" data-id="${h(d.id)}">忽略这条草稿</button>`:''}`;
        el('ws-draft-project').onchange=()=>{const project=this.data.expenseProjects?.find(p=>p.id===el('ws-draft-project').value);el('ws-draft-project-category').innerHTML=options(project?.categories||[],'','暂不细分');el('ws-draft-project-category-label').hidden=!project?.categories?.length;};
        const rawFields=()=>({direction:el('ws-draft-direction').value,amount:el('ws-draft-amount').value,date:el('ws-draft-date').value===p.date?.slice(0,10)?p.date:el('ws-draft-date').value,currency:el('ws-draft-currency').value.toUpperCase(),accountId:el('ws-draft-account').value,purpose:el('ws-draft-purpose').value,description:el('ws-draft-description').value,projectId:el('ws-draft-project').value,expenseCategoryId:el('ws-draft-project-category').value});
        const stage=()=>{if(!pending||this.ws.committing||this.ws.formSubmitting)return;d.proposal=rawFields();d.duplicateConfirmed=!!el('ws-draft-duplicate')?.checked;clearTimeout(this.ws.draftTimer);this.ws.draftTimer=setTimeout(()=>{this.ws.draftTimer=null;this.persistWorkspace().catch(e=>this.workspaceMessage('草稿暂存失败：'+e.message));},250);};
        el('ws-draft-form').oninput=stage;el('ws-draft-form').onchange=stage;
        const save=async()=>{clearTimeout(this.ws.draftTimer);d.proposal=W.proposal(this.data,rawFields());d.error='';d.duplicateConfirmed=!!el('ws-draft-duplicate')?.checked;await this.persistWorkspace();};
        el('ws-save-draft').onclick=async()=>{try{await save();this.workspaceMessage('修改已暂存，尚未入账。');this.renderWorkspaceReview();}catch(e){this.workspaceMessage(e.message);}};
        el('ws-draft-form').onsubmit=async event=>{event.preventDefault();if(this.ws.formSubmitting)return;this.ws.formSubmitting=true;el('ws-draft-form').querySelector('fieldset').disabled=true;try{const learn=el('ws-draft-rule').checked;await save();const ok=await this.commitWorkspaceDrafts([d.id]);if(ok&&learn&&d.proposal.description&&d.proposal.purpose){this.ws.rules.push({id:uid(),match:d.proposal.description,accountId:d.proposal.accountId,purpose:d.proposal.purpose,enabled:true});await this.persistWorkspace();this.renderWorkspaceRules();}}catch(e){this.workspaceMessage(e.message);}finally{this.ws.formSubmitting=false;const fieldset=el('ws-draft-form')?.querySelector('fieldset');if(fieldset&&!this.ws.commitUncertain&&!this.ws.storageReadOnly)fieldset.disabled=false;}};
        el('workspace-review-detail').querySelector('[data-ws-action="suggest-category"]').onclick=async()=>{try{await save();await this.runWorkspaceAgent(d.sourceText||d.proposal.description,d);}catch(e){this.workspaceMessage(e.message);}};
      },
      async commitWorkspaceDrafts(ids){
        if(this.ws.committing||this.ws.commitUncertain)return false;let previous,mutated=false;
        try{this.assertWorkspaceWritable();this.assertWritable();const drafts=this.ws.drafts.filter(d=>ids.includes(d.id)&&d.status==='pending');if(drafts.some(d=>d.suspected&&!d.duplicateConfirmed))throw Error('请逐笔确认疑似重复记录');
          const next=W.applyDrafts(this.data,drafts,this.ws.reviewBasis);const valid=this.validateRawBook(JSON.stringify(next));if(valid.status!=='valid')throw Error('核对结果未通过账本校验');
          this.ws.committing=true;clearTimeout(this.ws.draftTimer);el('workspace-review').inert=true;this.workspaceMessage('正在安全保存…');el('workspace-review')?.setAttribute('aria-busy','true');
          previous=this.data;this.data=next;mutated=true;await this.saveData({reason:'workspace-review'});
          this.ws.drafts=W.reconcile(this.data,this.ws.drafts);this.ws.selected.clear();this.ws.committing=false;
          if(!this.ws.runActiveId){el('workspace-agent-result').textContent=`已保存 ${drafts.length} 笔账单，可在账单中查看原始来源。`;if(el('workspace-review').classList.contains('active')&&drafts.some(d=>d.source==='assistant'&&d.sourceText===el('workspace-agent-input').value))el('workspace-agent-input').value='';}
          try{await this.persistWorkspace();}catch{this.workspaceMessage('账目已保存，草稿状态暂存失败；重启会按入账回执恢复。');}
          this.refreshDataViews();this.workspaceMessage(`已保存 ${drafts.length} 笔账单。`);this.renderWorkspaceReview();return true;
        }catch(e){if(mutated){this.data=previous;this.ws.commitUncertain=true;}this.ws.committing=false;this.workspaceMessage((mutated?'保存未确认，请按数据保护提示恢复，勿重复提交。':'')+(e.message||'无法确认'));return false;}
        finally{if(el('workspace-review'))el('workspace-review').inert=false;el('workspace-review')?.removeAttribute('aria-busy');}
      },
      async dismissWorkspaceDraft(id){if(this.ws.committing)return;const d=this.ws.drafts.find(x=>x.id===id);if(!d||d.status!=='pending')return;d.status='dismissed';this.ws.selected.delete(id);try{await this.persistWorkspace();this.renderWorkspaceReview();this.renderWorkspace();}catch(e){d.status='pending';this.workspaceMessage(e.message);}},
      explainWorkspaceCashflow(){this.openWorkspaceSection('dashboard');const x=W.cashflow(this.data,W.today(),this.ws.period),currency=this.data.settings.baseCurrency;
        el('modal-body').innerHTML=`<div class="ws-answer"><strong>${h(x.from)} — ${h(x.to)} · 本地计算</strong><p>${x.missing.length?'部分币种缺少汇率，以下仅为已折算部分。':''}收入 ${h(money(x.income,currency))}，支出 ${h(money(x.expense,currency))}，结余 ${h(money(x.net,currency))}。</p>${x.categories.length?`<p>支出最多的是 ${h(x.categories[0].name)}：${h(money(x.categories[0].amount,currency))}。</p>`:'<p>该期间没有支出记录。</p>'}${button('transactions','查看原始账单')}<p class="helper-text">来自 ${x.transactions.length} 笔期间账单，使用当前设置汇率；无需发送给模型。</p></div>`;this.showModal();
      },
      showWorkspaceDuplicates(){this.openWorkspaceSection('dashboard');const groups=W.duplicateGroups(this.data);el('modal-body').innerHTML=`<div class="ws-answer"><strong>${groups.length?'发现 '+groups.length+' 组相似记录':'未发现完全相同的记录'}</strong><p>相同日期、账户、金额与描述仅是重复线索，不会自动删除。</p>${groups.slice(0,10).map(g=>`<p>${h(g[0].date)} · ${h(g[0].description)} · ${h(g[0].amount)} ${h(g[0].currency)} · ${g.length} 笔</p>`).join('')}${button('transactions','查看账单')}</div>`;this.showModal();},
      renderWorkspaceConnection(){
        const c=this.ws.connection;
        el('workspace-connection-settings').innerHTML=`<div class="ws-section-heading"><div><h3>模型为你整理，账本由你确认</h3><p class="helper-text">先连接并使用合成样例测试，再授权本账本的处理范围。</p></div></div><form id="ws-connection-form" class="ws-connection-form"><div class="ws-settings-fields"><label>运行位置<select id="ws-provider-location"><option value="device">这台设备</option><option value="cloud" ${c.location==='cloud'?'selected':''}>云端 API</option></select></label><label>接口<select id="ws-provider-kind"><option value="ollama">Ollama</option><option value="compatible" ${c.provider==='compatible'?'selected':''}>LM Studio / 兼容 API</option></select></label><label class="ws-field-wide">服务地址<input id="ws-provider-url" type="url" value="${h(c.baseURL)}" required></label><label class="ws-field-wide">API 密钥<input id="ws-provider-key" type="password" autocomplete="new-password" placeholder="${native()?'保存到这台 Mac 的钥匙串；留空保留已有密钥':'仅用于当前页面会话，不持久保存'}"></label><label class="ws-field-wide">模型<input id="ws-provider-model" list="ws-provider-model-list" value="${h(c.model)}" placeholder="先获取模型，也可填写完整名称"><datalist id="ws-provider-model-list"></datalist></label><label class="ws-field-wide">Ollama 思考模式<select id="ws-provider-thinking"><option value="off">关闭额外思考 · 适合字段抽取</option><option value="default" ${c.thinking==='default'?'selected':''}>使用模型默认 · 模型不允许关闭时选择</option></select></label></div><div class="ws-inline-actions"><button type="button" class="btn btn-secondary" id="ws-list-models">获取模型</button><button type="button" class="btn btn-secondary" id="ws-test-model">测试结构输出</button><button type="button" class="ws-text-button" id="ws-clear-key">清除这个地址的密钥</button></div><p id="ws-connection-test-result" class="ws-status" role="status"></p><div class="ws-permission-box"><label class="ws-check"><input type="checkbox" id="ws-provider-enabled" ${c.enabled?'checked':''}>启用本账本的模型助手</label><label class="ws-check"><input type="checkbox" id="ws-provider-consent" ${c.allowText?'checked':''}>允许发送我主动提交的文本、账户名称/币种和分类候选</label><label class="ws-check"><input type="checkbox" id="ws-provider-examples" ${c.allowExamples?'checked':''}>同时发送最多 5 条已确认分类样例（描述与用途）</label><p class="helper-text">云端仅使用你明确配置的地址；本机失败不会转发到云端。切换地址后须重新授权。${native()?'请求由本机执行。':'浏览器直接连接模型，需要服务允许当前来源；连接受限时可使用桌面 App。'}</p></div><button class="btn btn-primary" type="submit">保存连接</button></form>`;
        const read=()=>P.connection({provider:el('ws-provider-kind').value,location:el('ws-provider-location').value,baseURL:el('ws-provider-url').value,model:el('ws-provider-model').value,thinking:el('ws-provider-thinking').value,enabled:el('ws-provider-enabled').checked,allowText:el('ws-provider-consent').checked,allowExamples:el('ws-provider-examples').checked});
        const clearConsent=()=>{el('ws-provider-enabled').checked=false;el('ws-provider-consent').checked=false;el('ws-provider-examples').checked=false;};
        el('ws-provider-url').oninput=clearConsent;el('ws-provider-location').onchange=clearConsent;
        el('ws-provider-kind').onchange=()=>{el('ws-provider-url').value=el('ws-provider-kind').value==='ollama'?'http://127.0.0.1:11434':'http://127.0.0.1:1234/v1';clearConsent();};
        const keepKey=async cfg=>{const apiKey=el('ws-provider-key').value;if(apiKey){if(native())await window.AssetTrackerHost.invoke('agent.key',{connection:cfg,apiKey});else this.ws.sessionKeys.set(cfg.baseURL,apiKey);el('ws-provider-key').value='';}};
        el('ws-connection-form').onsubmit=async event=>{event.preventDefault();try{const cfg=read();await keepKey(cfg);if(this.ws.runActiveId)this.cancelWorkspaceAgent();const before=this.ws.connection;this.ws.connection=cfg;try{await this.persistWorkspace();}catch(e){this.ws.connection=before;throw e;}this.workspaceMessage('连接设置已保存。');}catch(e){this.workspaceMessage(e.message);}};
        el('ws-clear-key').onclick=async()=>{try{const cfg=read();if(native())await window.AssetTrackerHost.invoke('agent.key',{connection:cfg,apiKey:''});this.ws.sessionKeys.delete(cfg.baseURL);el('ws-provider-key').value='';this.workspaceMessage('这个地址的密钥已清除。');}catch(e){this.workspaceMessage(e.message);}};
        const test=async structured=>{if(this.ws.probing)return;this.ws.probing=true;el('ws-list-models').disabled=true;el('ws-test-model').disabled=true;const status=el('ws-connection-test-result');status.textContent=structured?'正在使用合成账单测试…':'正在获取模型…';try{const cfg=read();await keepKey(cfg);const start=Date.now();
            if(!structured){const json=await this.workspaceModelTransport(cfg,'models');const models=cfg.provider==='ollama'?(json.models||[]).map(m=>m.name):(json.data||[]).map(m=>m.id);el('ws-provider-model-list').innerHTML=models.slice(0,200).filter(x=>typeof x==='string').map(id=>`<option value="${h(id)}"></option>`).join('');if(!el('ws-provider-model').value&&models.length)el('ws-provider-model').value=models[0];status.textContent=`可读取 ${models.length} 个模型；请继续测试结构输出。`;}
            else{const fake={categories:{a:{id:'sample-cash',name:'演示现金',currency:'CNY',balance:0}},settings:{baseCurrency:'CNY',exchangeRates:{CNY:1}},purposeCategories:['餐饮'],expenseProjects:[]};const req=P.request({...cfg,enabled:true,allowText:true,allowExamples:false},'parse-entry','2026-09-26 午餐支出32元，演示现金，餐饮',{today:'2026-09-26',accounts:W.accounts(fake),purposes:fake.purposeCategories,projects:[]});const json=await this.workspaceModelTransport(cfg,'chat',req.body);const value=W.proposal(fake,P.decode(cfg.provider,json));if(Number(value.amount)!==32||value.accountId!=='sample-cash'||value.direction!=='expense')throw Error('模型可连接，但合成样例字段不准确；请更换模型');status.textContent=`结构输出测试通过 · ${((Date.now()-start)/1000).toFixed(1)} 秒。单个样例不代表所有账单准确。`;}
          }catch(e){status.textContent='连接检查失败：'+e.message;}finally{this.ws.probing=false;if(el('ws-list-models'))el('ws-list-models').disabled=false;if(el('ws-test-model'))el('ws-test-model').disabled=false;}};
        el('ws-list-models').onclick=()=>test(false);el('ws-test-model').onclick=()=>test(true);
      },
      async workspaceModelTransport(cfg,operation,body,signal,runId=uid()){
        if(signal?.aborted)throw Error('已取消');
        if(native()){const cancel=()=>window.AssetTrackerHost.invoke('agent.cancel',{runId}).catch(()=>{});signal?.addEventListener('abort',cancel,{once:true});try{const result=await window.AssetTrackerHost.invoke('agent.request',{connection:cfg,operation,body,runId});if(signal?.aborted)throw Error('已取消');return typeof result==='string'?JSON.parse(result):result;}finally{signal?.removeEventListener('abort',cancel);}}
        const path=operation==='models'?(cfg.provider==='ollama'?'/api/tags':'/models'):(cfg.provider==='ollama'?'/api/chat':'/chat/completions');
        return P.send({url:cfg.baseURL+path,method:operation==='models'?'GET':'POST',body},{signal,apiKey:this.ws.sessionKeys.get(cfg.baseURL)||''});
      },
      async runWorkspaceAgent(text,existingDraft){
        if(this.ws.runActiveId)return;if(/^(解释|分析|看看|本月.*(收入|支出|结余))/.test(text.trim())&&!existingDraft){this.explainWorkspaceCashflow();return;}
        if(existingDraft){const p=existingDraft.proposal||{};text=JSON.stringify({description:p.description,date:p.date,amount:p.amount,currency:p.currency,direction:p.direction,accountId:p.accountId});}
        const c=this.ws.connection,id=uid(),status=el('workspace-agent-result'),task=existingDraft?'suggest-category':'parse-entry';
        try{this.assertWorkspaceWritable();const accountList=W.accounts(this.data),examples=this.data.transactions.filter(t=>t.purpose&&t.description).slice(-5);
          const request=P.request(c,task,text,{today:W.today(),accounts:accountList,purposes:this.data.purposeCategories,projects:this.data.expenseProjects,examples});
          this.ws.runActiveId=id;this.ws.controller=new AbortController();el('workspace-agent-submit').disabled=true;el('workspace-agent-cancel').hidden=false;status.textContent='正在整理；当前账本与金额不会改变…';this.workspaceMessage('模型正在生成建议…');
          const original=existingDraft?JSON.stringify(existingDraft.proposal):null,run={id,task,status:'running',createdAt:new Date().toISOString(),provider:c.provider,model:c.model};this.ws.runs.push(run);const start=Date.now();
          const json=await this.workspaceModelTransport(c,'chat',request.body,this.ws.controller.signal,id);if(this.ws.runActiveId!==id)return;
          this.assertWorkspaceWritable();const p=W.proposal(this.data,P.decode(c.provider,json),{allowMissing:true});
          if(existingDraft){if(existingDraft.status!=='pending'||JSON.stringify(existingDraft.proposal)!==original)throw Error('草稿已修改，模型旧建议未应用');existingDraft.proposal.purpose=p.purpose;existingDraft.proposal.projectId=p.projectId;existingDraft.proposal.expenseCategoryId=p.expenseCategoryId;existingDraft.evidence=`${c.model} 的分类建议，请核对`;run.draftId=existingDraft.id;}
          else{if(this.ws.drafts.filter(d=>d.status==='pending').length>=1000)throw Error('草稿列表已满，请先处理已有记录');const d={id:uid(),source:'assistant',status:'pending',sourceText:text,proposal:p,evidence:`${c.model} 解析 · ${c.location==='device'?'本机':'已授权云端'} · 确认前不入账`};
            const matches=this.ws.rules.filter(r=>r.enabled&&r.match===p.description&&r.accountId===p.accountId);const purposes=[...new Set(matches.map(r=>r.purpose))];if(purposes.length===1&&this.data.purposeCategories.includes(purposes[0])){d.proposal.purpose=purposes[0];d.evidence='命中你确认的描述与账户分类规则';}else if(purposes.length>1)d.evidence='多条分类规则冲突，请人工选择';
            this.ws.drafts.push(d);this.ws.focusId=d.id;this.ws.reviewPane='detail';run.draftId=d.id;}
          run.status='succeeded';run.elapsedMs=Date.now()-start;await this.persistWorkspace();status.textContent='草稿已准备好，请核对后确认。';this.workspaceMessage('建议已准备好，尚未入账。');this.openWorkspaceSection('workspace-review');this.renderWorkspace();this.renderWorkspaceReview();
        }catch(e){const run=this.ws.runs.find(r=>r.id===id);if(run){run.status=this.ws.controller?.signal.aborted?'cancelled':'failed';run.error=e.message;}status.textContent=e.message;this.workspaceMessage(e.message);await this.persistWorkspace().catch(()=>{});}
        finally{if(this.ws.runActiveId===id)this.ws.runActiveId=null;el('workspace-agent-submit').disabled=false;el('workspace-agent-cancel').hidden=true;this.renderWorkspaceRules();}
      },
      cancelWorkspaceAgent(){this.ws.controller?.abort();if(this.ws.runActiveId){const run=this.ws.runs.find(r=>r.id===this.ws.runActiveId);if(run)run.status='cancelled';}el('workspace-agent-result').textContent='正在取消任务；不会入账。';},
      editWorkspaceRule(id){
        const rule=this.ws.rules.find(r=>r.id===id);if(!rule)return;
        el('modal-body').innerHTML=`<h3>编辑分类规则</h3><form id="ws-rule-form" class="ws-rule-form"><label>描述完全等于<input id="ws-rule-match" maxlength="500" value="${h(rule.match)}" required></label><label>资金账户<select id="ws-rule-account" required>${options(W.accounts(this.data),rule.accountId)}</select></label><label>设置用途分类<select id="ws-rule-purpose" required>${options(this.data.purposeCategories.map(x=>({id:x,name:x})),rule.purpose)}</select></label><div id="ws-rule-preview" class="ws-suggestion"></div><p id="ws-rule-error" class="ws-status" role="status"></p><button type="submit" class="btn btn-primary">保存规则</button></form>`;
        const preview=()=>{const rows=this.data.transactions.filter(t=>t.description===el('ws-rule-match').value.trim()&&t.accountId===el('ws-rule-account').value);el('ws-rule-preview').textContent=`当前匹配 ${rows.length} 笔历史记录。此处只预览，保存规则不会修改历史账目或金额。`;};
        el('ws-rule-form').oninput=preview;el('ws-rule-form').onchange=preview;preview();
        el('ws-rule-form').onsubmit=async e=>{e.preventDefault();const before=clone(rule);try{this.assertWorkspaceWritable();const purpose=el('ws-rule-purpose').value,accountId=el('ws-rule-account').value,match=el('ws-rule-match').value.trim();if(!match||!this.data.purposeCategories.includes(purpose)||!W.accounts(this.data).some(a=>a.id===accountId))throw Error('请填写有效条件');Object.assign(rule,{match,accountId,purpose});await this.persistWorkspace();this.closeModal();this.renderWorkspaceRules();}catch(error){Object.assign(rule,before);el('ws-rule-error').textContent=error.message;}};this.showModal();
      },
      renderWorkspaceRules(){if(!this.ws?.ready)return;let panel=el('workspace-automation-log');if(!panel){panel=document.createElement('section');panel.id='workspace-automation-log';panel.className='ws-automation-log';el('automation')?.append(panel);}if(!panel)return;el('automation').querySelectorAll('button[onclick*="fillToToday"]').forEach(n=>n.textContent='预览待补齐项');
        panel.innerHTML=`<section><h3>分类整理规则</h3><p class="helper-text">在待核对详情中勾选“将这次分类保存为规则”。规则只整理分类，不改变金额。</p>`+(this.ws.rules.length?this.ws.rules.map(r=>`<div class="ws-summary-row"><span><strong>${h(r.match)}</strong><small>用途：${h(r.purpose)}</small></span><button type="button" class="btn btn-secondary" data-ws-action="rule-edit" data-id="${h(r.id)}">编辑与试运行</button><button type="button" class="btn btn-secondary" data-ws-action="rule-toggle" data-id="${h(r.id)}">${r.enabled?'暂停规则':'启用规则'}</button></div>`).join(''):'<p class="ws-empty-small">还没有分类规则</p>')+`</section><section><h3>助手执行记录</h3>`+(this.ws.runs.length?`<div class="ws-ledger-table"><table><thead><tr><th>时间</th><th>任务 / 模型</th><th>状态</th><th>结果</th></tr></thead><tbody>${this.ws.runs.slice(-20).reverse().map(r=>`<tr><td>${h(new Date(r.createdAt).toLocaleString('zh-CN',{hour12:false}))}</td><td>${h(r.task)}<small>${h(r.model)}</small></td><td>${h({running:'进行中',succeeded:'已生成建议',failed:'失败',cancelled:'已取消'}[r.status]||r.status)}</td><td>${h(r.error|| (r.elapsedMs?((r.elapsedMs/1000).toFixed(1)+' 秒'):'—'))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="ws-empty-small">运行后会显示状态与失败原因，不记录密钥。</p>')+'</section>';
      }
    });
  }};
})(globalThis);
