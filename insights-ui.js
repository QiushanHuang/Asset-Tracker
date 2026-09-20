(function(root){root.AssetTrackerAnalyticsUI={install(Tracker){
'use strict';const A=root.AssetTrackerAnalytics,h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),el=id=>document.getElementById(id);const palette=['#6754bd','#18796e','#c67425','#9b487f','#426ba9','#7f8040','#b5564a','#507e8d'];
const table=(heads,rows)=>`<div class="analysis-table" tabindex="0"><table><thead><tr>${heads.map(x=>`<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}" class="empty-state">该范围暂无记录</td></tr>`}</tbody></table></div>`;
const card=(title,body,note='')=>`<article class="card analysis-card"><h3>${title}</h3>${note?`<p class="helper-text">${note}</p>`:''}${body}</article>`;
const plot=id=>`<div class="analysis-plot"><canvas id="${id}" role="img" aria-label="${id==='analysis-main-chart'?'当前分析图表':'分析辅助图表'}"></canvas></div>`;
const previousDashboard=Tracker.prototype.updateDashboard;
Tracker.prototype.updateDashboard=function(...args){previousDashboard.apply(this,args);if(this.analyticsBound&&el('analytics')?.classList.contains('active'))this.generateAnalytics();};
const previousOptions=Tracker.prototype.updateAnalyticsOptions;
Tracker.prototype.updateAnalyticsOptions=function(){const select=el('chart-categories'),selected=Array.from(select?.selectedOptions||[]).map(x=>x.value);previousOptions.call(this);for(const option of Array.from(select?.options||[]))option.selected=selected.includes(option.value);this.setupAnalyticsPanel();};
Tracker.prototype.generateCustomChart=function(){this.generateAnalytics();};
Object.assign(Tracker.prototype,{
 setupAnalyticsPanel(){if(el('analytics-asof')?.type!=='date')return;
  document.querySelectorAll('#analytics label').forEach(label=>{const field=label.querySelector('input,select');if(field&&!field.hasAttribute('aria-label'))field.setAttribute('aria-label',label.firstChild?.textContent?.trim()||'分析条件');});
  if(!this.analyticsBound){this.analyticsBound=true;el('analytics-asof').value=localDateKey();el('analytics-compare').value=A.shift(localDateKey(),-30);
   el('analytics-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-analysis-view]');if(button){this.analyticsView=button.dataset.analysisView;this.generateAnalytics();}});
   for(const id of ['chart-type','analytics-metric','analytics-project','analytics-group','analytics-scenario-type'])el(id).addEventListener('change',()=>this.generateAnalytics());
   el('analytics-scenario-value').addEventListener('change',()=>this.generateAnalytics());
   el('analytics-export').addEventListener('click',()=>this.exportAnalyticsData());
   el('analytics-rate-form').addEventListener('submit',event=>{event.preventDefault();this.saveHistoricalAnalysisRate();});
  }
  const select=el('analytics-project'),selected=select.value;select.innerHTML='<option value="">全部项目与日常</option><option value="__daily">仅日常</option>'+(this.data.expenseProjects||[]).map(p=>`<option value="${h(p.id)}">${h(p.name)}</option>`).join('');select.value=selected;
  if(el('analytics').classList.contains('active'))this.generateAnalytics();
 },
 generateAnalytics(){if(!el('analytics-output'))return;try{
  const input={asOf:el('analytics-asof').value,compareAt:el('analytics-compare').value,trendDays:Number(el('time-range').value),forecastDays:Number(el('analytics-forecast-days').value),basis:el('analytics-basis').value,rateMode:el('analytics-rate-mode').value,accountNames:Array.from(el('chart-categories').selectedOptions).map(o=>o.value),projectId:el('analytics-project').value,groupBy:el('analytics-group').value};
  const scopeKey=JSON.stringify(input);
  if(this.analysisDataReference!==this.data || this.analysisScopeKey!==scopeKey){this.analyticsSnapshot=A.snapshot(this.data,input);this.analysisDataReference=this.data;this.analysisScopeKey=scopeKey;} this.renderAnalyticsView();el('analytics-error').textContent='';
 }catch(error){el('analytics-error').textContent=error.message||'无法计算，请检查分析条件';}},
 analyticsMoney(value){return value===null?'未折算':h(this.formatCurrency(value));},
 drawAnalysisChart(id,type,labels,datasets,extra={}){const canvas=el(id);if(!canvas)return;if(!labels.length){canvas.hidden=true;const message=document.createElement('p');message.className='empty-state';message.textContent='当前范围暂无可绘制的数据，明细与说明见下方。';canvas.parentElement.appendChild(message);return;}const chart=new Chart(canvas.getContext('2d'),{type:type==='area'?'line':type,data:{labels,datasets:datasets.map((set,i)=>({...set,borderColor:set.borderColor||palette[i%palette.length],backgroundColor:set.backgroundColor||(type==='pie'?labels.map((_,j)=>palette[j%palette.length]):palette[i%palette.length]+'25'),fill:type==='area',tension:0,pointRadius:labels.length>90?0:2}))},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom',display:labels.length<=12||type!=='pie'}},scales:type==='pie'?{}:type==='radar'?{r:{min:0,max:100}}:{y:{ticks:{callback:value=>this.formatCurrency(value)}}},...extra}});(this.analysisCharts ||= []).push(chart);},
 renderAnalyticsView(){for(const c of this.analysisCharts||[])c.destroy();this.analysisCharts=[];
  const s=this.analyticsSnapshot,view=this.analyticsView||'trend',metric=el('analytics-metric').value,type=el('chart-type').value,m=v=>this.analyticsMoney(v),metricNames={net:'净资产',asset:'资产余额',debt:'待还款'};
  document.querySelectorAll('[data-analysis-view]').forEach(button=>{button.classList.toggle('active',button.dataset.analysisView===view);button.setAttribute('aria-pressed',String(button.dataset.analysisView===view));});
  el('analytics-metric').disabled=view==='spending'||view==='structure';el('chart-type').disabled=view==='forecast'||view==='structure';el('analytics-compare').disabled=view!=='trend';
  el('analytics-spending-controls').hidden=view!=='spending';el('analytics-scenario-controls').hidden=view!=='forecast';
  const missing=[...new Set([...s.current.missing,...s.compare.missing])];
  el('analytics-context').textContent=`观察 ${s.asOf} · 对比 ${s.compareAt} · ${s.basis==='anchors'?'盘点锚点投影':'当前余额回推'} · ${s.rateMode==='historical'?'历史参考汇率':'当前汇率'} · ${this.data.settings.baseCurrency}`;
  el('analytics-warnings').innerHTML=[...s.warnings,...(missing.length?[`缺少 ${missing.join('、')} 汇率：合计仅显示可折算部分，相关图表点不连线。`]:[]),...(s.unresolvedTransactions?[`${s.unresolvedTransactions} 笔收支未折算，仍保留在原账单中。`]:[])].map(text=>`<p>${h(text)}</p>`).join('');
  const output=el('analytics-output');
  if(view==='trend'){
   const rows=['net','asset','debt'].map(k=>[h(metricNames[k]),m(s.compare[k]),m(s.current[k]),missing.length?'无法完整比较':m(s.current[k]-s.compare[k]),missing.length||s.compare[k]===0?'—':h(((s.current[k]-s.compare[k])/Math.abs(s.compare[k])*100).toFixed(1)+'%')]);
   const currencyMap=new Map(s.compare.currencies.map(c=>[c.currency,c]));const currencies=[...new Set([...currencyMap.keys(),...s.current.currencies.map(c=>c.currency)])];
   output.innerHTML=card('历史资产对比',table(['指标','对比时点','观察时点','变化','变化率'],rows),'合计不把缺失汇率当作 1:1；负债溢缴计入资产权益。')+card(type==='pie'?'观察时点资产构成':`${metricNames[metric]}趋势`,plot('analysis-main-chart'))+card('币种对比',table(['币种','对比原币净额','观察原币净额','观察折算净额'],currencies.map(currency=>{const c=s.current.currencies.find(x=>x.currency===currency),b=currencyMap.get(currency);return [h(currency),b?.incomplete?'未完整':h((b?.net||0).toFixed(2)),c?.incomplete?'未完整':h((c?.net||0).toFixed(2)),m(c?.converted??null)];})));
   const data=type==='pie'?s.assetComposition:[];this.drawAnalysisChart('analysis-main-chart',type,type==='pie'?data.map(r=>r.name):s.trend.map(r=>r.date),[{label:type==='pie'?'正资产':metricNames[metric],data:type==='pie'?data.map(r=>r.amount):s.trend.map(r=>r.missing.length?null:r[metric])}]);
  }else if(view==='spending'){
   const income=s.cashflow.reduce((n,r)=>n+r.income,0),expense=s.cashflow.reduce((n,r)=>n+r.expense,0);
   output.innerHTML=`<div class="project-metrics"><div><span>期间支出</span><strong>${m(expense)}</strong></div><div><span>期间收入</span><strong>${m(income)}</strong></div><div><span>净变动</span><strong>${m(income-expense)}</strong></div></div>`+card(type==='pie'?'支出去向占比':'每日收支变化',plot('analysis-main-chart'),'正数分别显示收入与支出；项目筛选只作用于收支分析，不推算项目资产。')+card('支出分类排行',table(['分类 / 账户 / 项目','支出','占已折算支出'],s.spending.map(r=>[h(r.name),m(r.amount),expense?h((r.amount/expense*100).toFixed(1)+'%'):'—'])))+card('每日明细',table(['日期','收入','支出','净变动','笔数'],s.cashflow.map(r=>[h(r.date),m(r.income),m(r.expense),m(r.net),r.count])));
   this.drawAnalysisChart('analysis-main-chart',type,type==='pie'?s.spending.map(r=>r.name):s.cashflow.map(r=>r.date),type==='pie'?[{label:'支出',data:s.spending.map(r=>r.amount)}]:[{label:'收入',data:s.cashflow.map(r=>r.income)},{label:'支出',data:s.cashflow.map(r=>r.expense)}]);
  }else if(view==='forecast'){
   const scenarioType=el('analytics-scenario-type').value,value=Number(el('analytics-scenario-value').value),days=s.forecast.length-1;
   if(!el('analytics-scenario-value').value.trim())throw Error('请输入假设数值');const values=A.scenario(s.current[metric],days,{type:scenarioType,value});
   output.innerHTML=card('未来预计曲线',plot('analysis-main-chart'),`按已登记的未来账单和 ${s.activeRuleCount} 条启用规则推演；不创建账单，不写余额，不代表实际收益。虚线为独立假设情景，不与周期基线重复相加。`)+card('周期现金流热区',plot('analysis-cashflow-chart')+table(['规则','预测期次数','支出','收入'],s.cashflowProjection.map(r=>[h(r.name),r.count,m(r.expense),m(r.income)])),'累计预测期内实际出现的次数；停用规则与已登记的同日规则账单不重复生成。')+card('未来逐日明细',table(['日期',metricNames[metric]+'基线','假设情景'],s.forecast.map((r,i)=>[h(r.date),r.missing.length?'缺少汇率':m(r[metric]),m(values[i])])));
   this.drawAnalysisChart('analysis-main-chart','line',s.forecast.map(r=>r.date),[{label:'周期基线 · '+metricNames[metric],data:s.forecast.map(r=>r.missing.length?null:r[metric])},{label:'假设情景',data:s.current.missing.length?values.map(()=>null):values,borderDash:[5,4]}]);
   this.drawAnalysisChart('analysis-cashflow-chart','bar',s.cashflowProjection.map(r=>r.name),[{label:'预计支出',data:s.cashflowProjection.map(r=>r.expense)},{label:'预计收入',data:s.cashflowProjection.map(r=>r.income)}]);
  }else{
   output.innerHTML=card('结构分布雷达',plot('analysis-main-chart')+table(['比例指标','数值'],s.radar.map(r=>[h(r.name),h(r.value+'%')])),'仅描述账户结构比例，不是财务健康评分；负债比例图示上限为 100%。')+`<div class="analysis-two-column">${card('资产饼图',plot('analysis-assets-pie'),'仅计正资产与负债溢缴，不把负债绝对值画成资产。')}${card('分类构成',plot('analysis-composition-chart'))}</div>`+card('账户明细',table(['账户','币种','原币余额','类型'],s.rows.map(r=>[h(r.path),h(r.currency),r.amount===null?'无法计算':h(r.amount.toFixed(2)),r.isDebt?'负债':'资产'])))+card('资产状态时间线',table(['盘点时间','账户','原币金额','币种'],s.anchors.map(a=>[h(a.time.replace('T',' ')),h(a.path),h(Number(a.amount).toFixed(2)),h(a.currency)])),'显示原始盘点记录；使用上方“历史计算”选择是否按锚点投影。')+card('分类树快照',table(['层级','账户路径','净额（基准币）'],s.tree.map(r=>[r.depth,h(r.path),r.missing.length?'缺少汇率':m(r.net)])))+card('自定义分析摘要',table(['分析项','结果'],[['观察时点',h(s.asOf)],['账本总记录数',(this.data.transactions||[]).length],['最大正资产账户',h(s.assetComposition[0]?.name||'无')],['最新盘点时间',h(s.anchors[0]?.time||'无')],['未折算币种',h(missing.join('、')||'无')]]));
   this.drawAnalysisChart('analysis-main-chart','radar',s.radar.map(r=>r.name),[{label:'结构比例 %',data:s.radar.map(r=>r.value)}]);
   this.drawAnalysisChart('analysis-assets-pie','pie',s.assetComposition.map(r=>r.name),[{label:'正资产',data:s.assetComposition.map(r=>r.amount)}]);
   this.drawAnalysisChart('analysis-composition-chart','bar',[...s.assetComposition,...s.debtComposition].map(r=>r.name),[{label:'正资产 / 待还款',data:[...s.assetComposition.map(r=>r.amount),...s.debtComposition.map(r=>-r.amount)]}]);
  }
 },
 async saveHistoricalAnalysisRate(){if(this.analyticsRatePending)return;const error=el('analytics-rate-error');try{
  const row=A.validateRate({currency:el('analytics-rate-currency').value,baseCurrency:this.data.settings.baseCurrency,effectiveFrom:el('analytics-rate-date').value,rate:Number(el('analytics-rate-value').value)});this.analyticsRatePending=true;el('analytics-rate-submit').disabled=true;
  const list=this.data.settings.exchangeRateHistory||[];this.data.settings.exchangeRateHistory=[...list.filter(r=>!(r.currency===row.currency&&r.baseCurrency===row.baseCurrency&&r.effectiveFrom===row.effectiveFrom)),row];
  await this.persistData({reason:'historical-exchange-rate'});this.analyticsRatePending=false;el('analytics-rate-submit').disabled=false;error.textContent='参考汇率已保存；当前汇率设置未改动。';this.generateAnalytics();
 }catch(e){error.textContent=this.analyticsRatePending?'保存未确认，请按数据保护提示处理。':e.message;}},
 async exportAnalyticsData(){if(!this.analyticsSnapshot){this.generateAnalytics();if(!this.analyticsSnapshot)return;}try{await this.fileAdapter.saveFile({suggestedName:'资产分析_'+this.analyticsSnapshot.asOf+'.json',mimeType:'application/json',text:JSON.stringify(this.analyticsSnapshot,null,2),encoding:'text'});this.showMessage('分析数据已导出','success');}catch(error){this.showMessage(error.message||'导出失败','error');}}
});
}};})(typeof globalThis!=='undefined'?globalThis:this);
