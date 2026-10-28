(function(root){
  'use strict';
  const el=id=>document.getElementById(id);
  const fit=root.AssetTrackerWorkspaceFit;
  const set=(object,key,value)=>{if(object[key]!==value)object[key]=value;};
  const attribute=(node,name,value)=>{if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
  const toggle=(node,name,value)=>{if(node.classList.contains(name)!==value)node.classList.toggle(name,value);};
  root.AssetTrackerWorkspaceScreen={install(Tracker){
    const setup=Tracker.prototype.setupWorkspace;
    Tracker.prototype.setupWorkspace=async function(...args){
      await setup.apply(this,args);
      if(!this.ws||this.ws.screenReady)return;
      this.ws.screenReady=true;
      window.addEventListener('resize',()=>this.scheduleWorkspaceFit());
      if(typeof root.MutationObserver==='function'){
        const nodes=['data-safety-status','app-status','workspace-agent-result'].map(el).filter(Boolean);
        const signature=node=>JSON.stringify([node.innerHTML,node.hidden,node.className,node.style.cssText,node.dataset.state]);
        const previous=new Map(nodes.map(node=>[node,signature(node)]));
        this.ws.screenObserver=new root.MutationObserver(()=>{
          let changed=false;
          for(const node of nodes){const value=signature(node);if(previous.get(node)!==value){previous.set(node,value);changed=true;}}
          if(changed)this.scheduleWorkspaceFit();
        });
        for(const node of nodes)this.ws.screenObserver.observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','class','style','data-state']});
      }
      this.scheduleWorkspaceFit();
    };
    for(const name of ['renderWorkspace','workspaceNavigated','renderWorkspaceReview','renderWorkspaceSettings','renderWorkspaceLayoutEditor','renderWorkspaceConnection','renderAnalyticsView','renderWorkspaceRules','renderAutomationRules','workspaceMessage']){
      const original=Tracker.prototype[name];
      Tracker.prototype[name]=function(...args){const result=original.apply(this,args);this.scheduleWorkspaceFit();return result;};
    }
    Object.assign(Tracker.prototype,{
      scheduleWorkspaceFit(){
        if(!this.ws?.ready||typeof root.requestAnimationFrame!=='function'||this.ws.fitFrame)return;
        this.ws.fitFrame=root.requestAnimationFrame(()=>{this.ws.fitFrame=null;this.fitWorkspace();});
      },
      fitWorkspace(){
        const shell=el('normal-app-shell'),section=document.querySelector('.content-section.active');
        // Non-layout environments (including data tests) keep the regular document flow.
        if(!shell||!section||!root.innerHeight)return;
        const bounds=shell.getBoundingClientRect();if(!bounds.width)return;
        set(document.documentElement.dataset,'workspaceFit','true');
        set(document.documentElement.dataset,'workspaceShort',String(root.innerHeight<820));
        set(shell.style,'height',Math.max(240,root.innerHeight-Math.max(0,bounds.top))+'px');
        if(section.id==='dashboard')this.fitWorkspaceDashboard(section);
        else if(section.id==='workspace-review')this.fitWorkspaceReview(section);
        else if(section.id==='transactions')this.fitWorkspaceTransactions(section);
        else if(section.id==='workspace-settings')this.fitWorkspaceSettings();
        else if(section.id==='settings')this.workspacePanels(section,[...section.querySelectorAll('.settings-container>.card')],'bookSettings');
        else if(section.id==='import-export')this.workspacePanels(section,[...section.querySelectorAll('.import-export-container>.card'),section.querySelector('.danger-zone')],'files');
        else if(section.id==='automation'){
          this.workspacePanels(section,[section.querySelector('.automation-container'),...section.querySelectorAll('#workspace-automation-log>section')],'automationPanel');
          this.fitWorkspaceTable(section.querySelector('.ws-panel-current .ws-ledger-table'),section);
        }
        else if(section.id==='analytics')this.fitWorkspaceAnalytics(section);
      },
      fitWorkspaceDashboard(section){
        const grid=section.querySelector('.workspace-grid'),height=section.clientHeight-8,width=root.innerWidth<=760?Math.min(599,grid.clientWidth):grid.clientWidth;
        if(height<=0||width<=0)return;
        const p=this.ws.prefs,modules=p.modules.filter(m=>m.visible).map(m=>({...m}));
        const assistant=modules.find(m=>m.id==='assistant');
        if(assistant)assistant.minHeight=this.workspaceAssistantMinHeight(width);
        const assets=modules.find(m=>m.id==='assets');if(assets)assets.minHeight=width<600?60:54;
        const cashflow=modules.find(m=>m.id==='cashflow');if(cashflow&&el('workspace-cashflow').querySelector('.ws-inline-note'))cashflow.minHeight=106;
        if(p.metricEmphasis==='net-assets'){const index=modules.findIndex(m=>m.id==='assets');if(index>0)modules.unshift(modules.splice(index,1)[0]);}
        const planKey=JSON.stringify([width,height,modules]);
        let plan=this.ws.dashboardFitCache?.key===planKey?this.ws.dashboardFitCache.plan:null;
        if(!plan){plan=fit.plan(modules,{width,height,gap:6});if(plan.pages.length>1)plan=fit.plan(modules,{width,height:height-36,gap:6});this.ws.dashboardFitCache={key:planKey,plan};}
        const focused=document.activeElement?.closest?.('[data-ws-module]')?.dataset.wsModule;
        const anchor=focused||this.ws.dashboardAnchor;
        const anchorPage=anchor?plan.pages.findIndex(page=>page.items.some(item=>item.id===anchor)):-1;
        if(anchorPage>=0)this.ws.dashboardPage=anchorPage;
        this.ws.dashboardPage=Math.max(0,Math.min(this.ws.dashboardPage||0,plan.pages.length-1));
        this.ws.dashboardPlan=plan;
        const page=plan.pages[this.ws.dashboardPage];
        this.ws.dashboardAnchor=focused||page?.items[0]?.id;
        set(grid.style,'gridTemplateRows',page?.rows.map(h=>h+'px').join(' ')||'none');
        set(grid.dataset,'compact',String(plan.compact));
        const onPage=new Map(page?.items.map(item=>[item.id,item])||[]);
        grid.querySelectorAll('[data-ws-module]').forEach(node=>{
          const item=onPage.get(node.dataset.wsModule),wasOff=node.classList.contains('ws-off-page');toggle(node,'ws-off-page',!item);
          if(!item)return;
          set(node.style,'gridRow',String(item.row+1));set(node.style,'gridColumn',`${item.column+1} / span ${item.span}`);
          set(node.style,'height',item.height+'px');set(node.dataset,'short',String(item.height<130));
          // A hidden assistant cannot be measured. Recheck its natural controls
          // once after revealing it; subsequent stable fits do not reschedule.
          if(node.dataset.wsModule==='assistant'&&wasOff)this.scheduleWorkspaceFit();
          if(node.dataset.wsModule==='recent'){
            const count=Math.max(1,Math.min(p.recentCount,Math.floor((item.height-60)/29)));
            node.querySelectorAll('tbody tr').forEach((row,index)=>set(row,'hidden',index>=count));
          }
        });
        this.workspacePager(section,'workspace-home-pages',this.ws.dashboardPage,plan.pages.length,index=>{this.ws.dashboardPage=index;this.ws.dashboardAnchor=plan.pages[index]?.items[0]?.id;this.scheduleWorkspaceFit();},'首页模块');
        this.resizeWorkspaceCharts(Object.values(this.charts||{}));
      },
      workspaceAssistantMinHeight(width){
        const card=el('workspace-assistant'),narrow=width<600,fallback=narrow?142:100,result=el('workspace-agent-result');
        const hasResult=!!result?.textContent.trim()&&!result.hidden;
        const css=node=>typeof root.getComputedStyle==='function'?root.getComputedStyle(node):{};
        const px=(style,name)=>parseFloat(style[name])||0;
        const outer=(node,includeMargin=true)=>{const s=css(node);return px(s,'paddingTop')+px(s,'paddingBottom')+px(s,'borderTopWidth')+px(s,'borderBottomWidth')+(includeMargin?px(s,'marginTop')+px(s,'marginBottom'):0);};
        // Measure controls, not their grid row or the card's assigned height:
        // 1fr/stretch otherwise turns spare space into a growing minimum.
        const contentHeight=node=>{
          if(!node)return 0;
          const rects=[...node.children].filter(child=>!child.hidden&&!child.classList.contains('sr-only')).map(child=>child.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0);
          return rects.length?Math.max(...rects.map(rect=>rect.bottom))-Math.min(...rects.map(rect=>rect.top)):0;
        };
        const title=card.querySelector('.ws-assistant-title'),form=el('workspace-agent-form'),actions=card.querySelector('.ws-assistant-actions');
        const titleHeight=contentHeight(title),formHeight=contentHeight(form),actionsHeight=contentHeight(actions);
        let minimum;
        if(!formHeight||!actionsHeight){minimum=Math.max(fallback,this.ws.assistantHeight?.width===width?this.ws.assistantHeight.height:0);}
        else{
          const gap=px(css(card),'rowGap'),controls=formHeight+outer(form)+actionsHeight+outer(actions)+gap;
          minimum=Math.max(fallback,outer(card,false)+(narrow?titleHeight+outer(title)+controls+gap:Math.max(titleHeight+outer(title),controls)));
          this.ws.assistantHeight={width,height:minimum};
        }
        if(hasResult){const s=css(result),rect=result.getBoundingClientRect();minimum+=(rect.height>0?rect.height+px(s,'marginTop')+px(s,'marginBottom'):32)+px(css(card),'rowGap');}
        return Math.ceil(minimum);
      },
      resizeWorkspaceCharts(charts){
        const sizes=this.ws.chartFitSizes||(this.ws.chartFitSizes=new WeakMap());
        for(const chart of charts){
          if(typeof chart?.resize!=='function')continue;
          const container=chart.canvas?.parentElement;
          if(!container){chart.resize();continue;}
          const rect=container.getBoundingClientRect();if(!rect.width||!rect.height){sizes.delete(chart);continue;}
          const key=`${rect.width}:${rect.height}:${root.devicePixelRatio||1}`;
          if(sizes.get(chart)===key)continue;
          chart.resize();sizes.set(chart,key);
        }
      },
      workspacePager(parent,id,page,pages,change,label){
        let node=el(id);if(!node){node=document.createElement('nav');node.id=id;node.className='ws-page-switch';node.setAttribute('aria-label',label+'分页');parent.append(node);}
        set(node,'hidden',pages<=1);
        if(!node.children.length)node.innerHTML='<button type="button" class="btn btn-sm">上一页</button><span></span><button type="button" class="btn btn-sm">下一页</button>';
        set(node.querySelector('span'),'textContent',`${page+1} / ${Math.max(1,pages)}`);
        const buttons=node.querySelectorAll('button');set(buttons[0],'disabled',page<=0);set(buttons[1],'disabled',page>=pages-1);
        attribute(buttons[0],'aria-label','上一页'+label);attribute(buttons[1],'aria-label','下一页'+label);
        buttons[0].onclick=()=>change(page-1);buttons[1].onclick=()=>change(page+1);
      },
      focusWorkspaceAssistant(){
        if(!this.ws.prefs.modules.some(module=>module.id==='assistant'&&module.visible)){this.showMessage('首页已隐藏账本助手，可在“编辑首页”中重新启用。','info');return;}
        this.ws.dashboardAnchor='assistant';this.openWorkspaceSection('dashboard');this.fitWorkspace();el('workspace-agent-input').focus();
      },
      fitWorkspaceReview(section){
        const list=el('workspace-review-list'),main=list.parentElement;
        if(!main.getBoundingClientRect().height)return;
        const all=[...list.querySelectorAll('.ws-review-row')];
        const available=section.getBoundingClientRect().bottom-list.getBoundingClientRect().top-42;
        const pageSize=Math.max(1,Math.floor(available/64));
        const pages=Math.max(1,Math.ceil(all.length/pageSize));
        let page=Math.max(0,Math.min(this.ws.reviewPage||0,pages-1));
        if(this.ws.reviewPageFocus!==this.ws.focusId){const selected=all.findIndex(row=>row.classList.contains('selected'));if(selected>=0)page=Math.floor(selected/pageSize);this.ws.reviewPageFocus=this.ws.focusId;}
        this.ws.reviewPage=page;
        all.forEach((row,i)=>row.hidden=Math.floor(i/pageSize)!==page);
        this.workspacePager(main,'workspace-review-pages',page,pages,index=>{this.ws.reviewPage=index;this.scheduleWorkspaceFit();},'待核对');
        el('workspace-review-detail').style.maxHeight='';
      },
      fitWorkspaceTransactions(section){
        const table=el('transactions-table'),footer=section.querySelector('.table-footer');
        const available=section.getBoundingClientRect().bottom-table.getBoundingClientRect().top-(footer?.getBoundingClientRect().height||38)-34;
        const pageSize=Math.max(1,Math.min(50,Math.floor((available-34)/52)));
        if(this.ws.transactionPageSize!==pageSize){const first=(this.transactionPage||0)*(this.ws.transactionPageSize||50);this.ws.transactionPageSize=pageSize;this.transactionPage=Math.floor(first/pageSize);this.renderTransactions();}
      },
      fitWorkspaceSettings(){
        for(const [id,key,labels] of [['workspace-layout-settings','layoutPart',['外观偏好','首页模块']],['workspace-connection-settings','connectionPart',['连接信息','处理范围']]]){
          const panel=el(id);if(panel.hidden)continue;
          let tabs=panel.querySelector('.ws-compact-tabs');
          if(!tabs){tabs=document.createElement('nav');tabs.className='ws-compact-tabs';tabs.setAttribute('aria-label','设置分组');panel.querySelector('.ws-section-heading')?.after(tabs);}
          const selected=this.ws[key]||'0';panel.dataset.part=selected;
          if(!tabs.children.length)tabs.innerHTML=labels.map(label=>`<button type="button" class="btn btn-sm">${label}</button>`).join('');
          tabs.querySelectorAll('button').forEach((button,index)=>{button.setAttribute('aria-pressed',String(selected===String(index)));button.onclick=()=>{this.ws[key]=String(index);this.scheduleWorkspaceFit();};});
        }
      },
      workspacePanels(section,items,key,before){
        items=items.filter(Boolean);if(!items.length)return;
        section.classList.add('ws-panel-workspace');
        let tabs=section.querySelector('[data-panel-tabs="'+key+'"]');
        if(!tabs){tabs=document.createElement('nav');tabs.className='ws-panel-tabs';tabs.dataset.panelTabs=key;tabs.setAttribute('aria-label','内容分组');if(before)before.before(tabs);else section.prepend(tabs);}
        const index=Math.max(0,Math.min(this.ws[key]||0,items.length-1));this.ws[key]=index;
        const labels=items.map(item=>item.querySelector('h3,summary')?.textContent||'概览');
        if(JSON.stringify(labels)!==tabs.dataset.labels){tabs.replaceChildren();labels.forEach(label=>{const button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent=label;tabs.append(button);});tabs.dataset.labels=JSON.stringify(labels);}
        const buttons=tabs.querySelectorAll('button');
        items.forEach((item,i)=>{
          item.classList.toggle('ws-panel-off',i!==index);item.classList.toggle('ws-panel-current',i===index);
          const button=buttons[i];button.setAttribute('aria-pressed',String(i===index));
          button.onclick=()=>{this.ws[key]=i;this.scheduleWorkspaceFit();};
        });
      },
      fitWorkspaceAnalytics(section){
        const output=el('analytics-output');
        output.querySelectorAll('.analysis-two-column').forEach(group=>group.replaceWith(...group.children));
        this.workspacePanels(section,[...output.querySelectorAll(':scope>.analysis-card')],'analysisPanel'+(this.analyticsView||'trend'),output);
        section.querySelectorAll('.ws-panel-tabs').forEach(tabs=>{tabs.hidden=tabs.dataset.panelTabs!=='analysisPanel'+(this.analyticsView||'trend');});
        const controls=section.querySelector('.analysis-controls');let toggle=el('workspace-analysis-controls');
        if(!toggle){toggle=document.createElement('button');toggle.id='workspace-analysis-controls';toggle.type='button';toggle.className='btn btn-sm';toggle.onclick=()=>{this.ws.analysisControlsOpen=!this.ws.analysisControlsOpen;this.scheduleWorkspaceFit();};controls.before(toggle);}
        toggle.textContent=this.ws.analysisControlsOpen?'收起分析条件':'筛选与计算口径';toggle.setAttribute('aria-expanded',String(!!this.ws.analysisControlsOpen));
        controls.classList.toggle('ws-controls-open',!!this.ws.analysisControlsOpen);
        const current=output.querySelector('.ws-panel-current');
        this.fitWorkspaceTable(current?.querySelector('.analysis-table'),current);
        this.resizeWorkspaceCharts(this.analysisCharts||[]);
      },
      fitWorkspaceTable(table,container){
        if(!table||!container||!table.getBoundingClientRect().height)return;
        const rows=[...table.querySelectorAll('tbody>tr')],bottom=container.getBoundingClientRect().bottom;
        const size=Math.max(1,Math.floor((bottom-table.getBoundingClientRect().top-72)/36)),pages=Math.max(1,Math.ceil(rows.length/size));
        const page=Math.max(0,Math.min(Number(table.dataset.page)||0,pages-1));table.dataset.page=String(page);
        rows.forEach((row,index)=>row.hidden=Math.floor(index/size)!==page);
        if(!table.id){this.ws.tableCounter=(this.ws.tableCounter||0)+1;table.id='workspace-table-'+this.ws.tableCounter;}
        this.workspacePager(container,table.id+'-pages',page,pages,index=>{table.dataset.page=String(index);this.scheduleWorkspaceFit();},'明细');
      }
    });
  }};
})(globalThis);
