(function(root) {
    'use strict';
    root.AssetTrackerProjectUI = { install(Tracker) {
        const P = root.AssetTrackerProjects;
        const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const el = id => document.getElementById(id);
        const list = tracker => tracker.data.expenseProjects || [];
        const current = tracker => list(tracker).find(p => p.id === tracker.projectViewId);
        const option = (id,name) => `<option value="${h(id)}">${h(name)}</option>`;
        const action = (name,label,id='',extra='') => `<button type="button" class="btn btn-sm" data-project-action="${name}" data-id="${h(id)}" ${extra}>${label}</button>`;
        const applyTemplate = Tracker.prototype.applyTransactionTemplate;
        Tracker.prototype.applyTransactionTemplate = function(id,formType='add') {
            applyTemplate.call(this,id,formType);
            const template=(this.data.transactionTemplates || []).find(t=>t.id===id);if(!template)return;
            const prefix=formType==='edit'?'edit-':'';
            el(prefix+'transaction-amount').value=Math.abs(template.amount);
            const radio=document.querySelector(`input[name="entry-direction"][value="${template.amount<0?'expense':'income'}"]`);if(radio)radio.checked=true;
            const accounts=Array.from(el('entry-account')?.options || []).filter(o=>{
                const node=this.findCategoryById(o.value);return node && node.name===(template.subcategory || template.category);
            });
            if(accounts.length===1)el('entry-account').value=accounts[0].value;
        };
        Object.assign(Tracker.prototype, {
            setupProjectUI() {
                if (this.projectUIBound || !el('projects')) return;
                this.projectUIBound = true;
                document.addEventListener('click', event => {
                    const button = event.target.closest?.('[data-project-action]');
                    if (!button) return;
                    const id=button.dataset.id, operation=button.dataset.projectAction;
                    if (operation==='new') this.showProjectEditor();
                    if (operation==='select') {this.projectViewId=id;this.projectCategoryView=null;this.renderProjectWorkspace();}
                    if (operation==='active') {this.activeProjectId=id;this.renderProjectWorkspace();}
                    if (operation==='daily') {this.activeProjectId=null;this.renderProjectWorkspace();}
                    if (operation==='rename') this.showProjectEditor(id);
                    if (operation==='archive') this.archiveProject(id);
                    if (operation==='category-new') this.showExpenseCategoryEditor(null,id || null);
                    if (operation==='category-edit') this.showExpenseCategoryEditor(id);
                    if (operation==='category-delete') this.deleteExpenseCategory(id);
                    if (operation==='drill') {this.projectCategoryView=id || null;this.renderProjectWorkspace();}
                    if (operation==='records') this.openProjectTransactions(id);
                    if (operation==='entry') {this.activeProjectId=this.projectViewId;this.showTransactionModal();}
                });
                el('project-filter')?.addEventListener('change',()=>{
                    el('project-category-filter').value='';
                    if (el('project-filter').value) {el('date-from').value='';el('date-to').value='';}
                    this.renderProjectSelectors();this.filterTransactions();
                });
                el('project-category-filter')?.addEventListener('change',()=>this.filterTransactions());
                this.renderProjectWorkspace();
            },
            renderProjectSelectors() {
                const select=el('project-filter');if(!select)return;
                const selected=select.value;
                select.innerHTML=option('','全部项目')+option('__daily','日常 · 无项目')+list(this).map(p=>option(p.id,p.name+(p.archived?' · 已归档':''))).join('');
                select.value=selected;
                const categories=el('project-category-filter');if(!categories)return;
                const previous=categories.value,p=list(this).find(p=>p.id===select.value);
                categories.innerHTML=option('','全部消费分类')+(p ? option('__unclassified','未分类')+p.categories.map(n=>option(n.id,P.path(p,n.id))).join('') : '');
                if (p && previous.startsWith('__direct:')) categories.innerHTML+=option(previous,'直接记在所选分类');
                categories.value=previous;categories.hidden=!p;
            },
            projectDescription(item) {
                const p=list(this).find(p=>p.id===item.projectId);
                return p ? `${p.name}${item.expenseCategoryId?' · '+P.path(p,item.expenseCategoryId):' · 未分类'}` : '';
            },
            renderProjectWorkspace() {
                if(!el('project-list'))return;
                const projects=list(this);
                if(!current(this))this.projectViewId=projects.find(p=>!p.archived)?.id || projects[0]?.id || null;
                const managementOpen=Boolean(el('project-detail')?.querySelector('details')?.open);
                const p=current(this),active=projects.find(p=>p.id===this.activeProjectId && !p.archived);
                if(!active)this.activeProjectId=null;
                const badge=el('active-project-status');
                if(badge) badge.innerHTML=active ? `<span>正在记：<strong>${h(active.name)}</strong></span>${action('daily','退出项目模式')}` : '<span>日常记账 · 可随时选择项目</span>';
                el('project-list').innerHTML=projects.length ? projects.map(item=>`<button type="button" class="project-card ${p?.id===item.id?'selected':''}" data-project-action="select" data-id="${h(item.id)}" aria-pressed="${p?.id===item.id}"><strong>${h(item.name)}</strong><span>${item.archived?'已归档':item.id===this.activeProjectId?'当前记账项目':'点击查看项目'}</span></button>`).join('') : '<p class="empty-state">把一次旅行、装修或活动的支出放在一起。</p>';
                if(!p){el('project-detail').innerHTML='<div class="project-welcome"><p class="eyebrow">按事情记账</p><h3>这一趟，钱花在哪里？</h3><p>建一个旅行项目，餐饮、住宿和交通各有归属。回来后，一眼看清整趟花销。</p>'+action('new','新建第一个项目')+'</div>';this.renderProjectSelectors();return;}
                if(this.projectCategoryView && !p.categories.some(n=>n.id===this.projectCategoryView))this.projectCategoryView=null;
                const parent=this.projectCategoryView || null, summary=P.summarize(this.data,p.id,parent);
                const chain=P.chain(p,parent),back=chain.length>1?chain[chain.length-2].id:'';
                const unknown=Object.keys(summary.unconverted);
                const rows=summary.rows.map(row=>{
                    const special=row.id.startsWith('__');
                    const category=special?(row.id==='__direct'?'__direct:'+parent:'__unclassified'):row.id;
                    const percent=summary.expense?Math.round(row.expense/summary.expense*100):0;
                    return `<div class="project-breakdown-row"><div class="breakdown-title">${special?`<strong>${h(row.name)}</strong>`:action('drill',h(row.name)+' ›',row.id)}<small>${row.count} 笔${row.income?' · 收入 '+h(this.formatCurrency(row.income)):''}</small></div><div class="breakdown-track" aria-hidden="true"><span style="width:${percent}%"></span></div><strong>${h(this.formatCurrency(row.expense))}</strong>${action('records','查看账单',category)}</div>`;
                }).join('');
                el('project-detail').innerHTML=`<div class="card-header"><div><p class="eyebrow">${p.archived?'归档项目 · 历史记录保留':'项目账本'}</p><h3>${h(p.name)}</h3></div><div class="project-actions">${!p.archived?action('active',p.id===this.activeProjectId?'已设为当前项目':'设为当前项目',p.id):''}${!p.archived?action('entry','记一笔'):''}${action('rename','重命名',p.id)}${action('archive',p.archived?'恢复项目':'归档',p.id)}</div></div>
                    <p class="helper-text">选定项目后，新增账单默认带上它；关闭 App 后回到日常记账。</p>
                    <div class="project-metrics"><div><span>${parent?'当前分类':'项目累计'}支出${unknown.length?'（已折算部分）':''}</span><strong>${h(this.formatCurrency(summary.expense))}</strong></div><div><span>收入 · 单独统计</span><strong>${h(this.formatCurrency(summary.income))}</strong></div><div><span>账单笔数</span><strong>${summary.count}</strong></div></div>
                    ${unknown.length?`<p class="project-warning" role="status">缺少 ${unknown.map(h).join('、')} 汇率，相关原币记录保留在账单中，未计入折算金额。</p>`:''}
                    <div class="card-header breakdown-heading"><div><h3>${parent?h(P.path(p,parent)):'消费去向'}</h3><p class="helper-text">支出含下级分类 · ${h(this.data.settings.baseCurrency)} · 当前设置汇率 · 全部日期</p></div>${parent?action('drill','返回上一级',back):action('records','查看全部账单','')}</div>
                    <div class="project-breakdown">${rows || '<p class="empty-state">还没有分类，可以在下方添加；未分类账单仍会纳入统计。</p>'}</div>
                    <details class="project-category-manager" ${managementOpen?'open':''}><summary>管理消费分类 <span>最多三级，不必每笔选满</span></summary><div class="project-actions">${action('category-new','添加一级分类')}</div>${p.categories.map(n=>{
                        const depth=P.chain(p,n.id).length;
                        return `<div class="category-manager-row"><div><span class="depth-badge">${depth}级</span><span>${h(P.path(p,n.id))}</span></div><div>${depth<3?action('category-new','添加下级',n.id):''}${action('category-edit','改名',n.id)}${P.canDelete(this.data,p.id,n.id)?action('category-delete','删除',n.id):'<span class="helper-text">已有下级或账单</span>'}</div></div>`;
                    }).join('')}</details>`;
                this.renderProjectSelectors();
            },
            showProjectEditor(projectId=null) {
                this.projectEditorId=projectId;const p=list(this).find(p=>p.id===projectId);
                el('modal-body').innerHTML=`<h3>${p?'重命名项目':'新建项目'}</h3><form id="project-form"><div class="form-group"><label for="project-name">项目名称</label><input id="project-name" maxlength="120" required placeholder="例如：国庆云南旅行" value="${h(p?.name || '')}"></div>${p?'':'<div class="form-group"><label><input type="checkbox" id="project-template" checked> 使用旅游分类模板</label><p class="helper-text">餐饮、住宿、交通、游玩、购物、其他；创建后可继续细分。</p></div>'}<p id="project-form-error" class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">${p?'保存名称':'创建项目'}</button></form>`;
                el('project-form').addEventListener('submit',event=>{event.preventDefault();this.saveProjectEditor();});this.showModal();el('project-name').focus();
            },
            async commitProjectList(next,onSuccess) {
                if(this.projectMutationPending)return false;
                const errors=P.validate({...this.data,expenseProjects:next});
                if(errors.length){if(el('project-form-error'))el('project-form-error').textContent=errors[0];else this.showMessage(errors[0],'error');return false;}
                this.projectMutationPending=true;
                const button=el('modal-body')?.querySelector('button[type=submit]');if(button)button.disabled=true;
                this.data.expenseProjects=next;
                try {await this.persistData({reason:'project-config'});this.projectMutationPending=false;onSuccess?.();this.renderProjectWorkspace();this.renderTransactions();this.showMessage('项目设置已保存','success');return true;}
                catch(error){if(el('project-form-error'))el('project-form-error').textContent='保存未确认，请按数据保护提示处理。';else this.showMessage('保存未确认，请按数据保护提示处理。','error');return false;}
            },
            async saveProjectEditor() {
                if(this.projectMutationPending)return false;
                let next=list(this).map(p=>({...p,categories:p.categories.map(n=>({...n}))}));const name=el('project-name').value.trim();
                if(!name){el('project-form-error').textContent='请输入项目名称';return;}
                if(next.some(p=>p.id!==this.projectEditorId && p.name===name)){el('project-form-error').textContent='已有同名项目，请使用能区分这次活动的名称';return;}
                let id=this.projectEditorId;
                if(id)next.find(p=>p.id===id).name=name;else{const p=P.createProject(name,el('project-template').checked);next.push(p);id=p.id;}
                return this.commitProjectList(next,()=>{this.projectViewId=id;this.projectCategoryView=null;this.closeModal();});
            },
            async archiveProject(id) {
                const next=list(this).map(p=>p.id===id?{...p,archived:!p.archived}:p);
                return this.commitProjectList(next,()=>{if(next.find(p=>p.id===id)?.archived && this.activeProjectId===id)this.activeProjectId=null;});
            },
            showExpenseCategoryEditor(id=null,parentId=null) {
                const p=current(this);if(!p)return;
                const node=p.categories.find(n=>n.id===id);this.expenseCategoryEditor={id,parentId:node?.parentId || parentId};
                el('modal-body').innerHTML=`<h3>${node?'重命名分类':'添加消费分类'}</h3><p class="helper-text">${h(p.name)}${parentId?' / '+h(P.path(p,parentId)):''} · 最多三级</p><form id="expense-category-form"><div class="form-group"><label for="expense-category-name">分类名称</label><input id="expense-category-name" maxlength="120" required value="${h(node?.name || '')}" placeholder="例如：晚餐"></div><p id="project-form-error" class="form-error" role="alert"></p><button type="submit" class="btn btn-primary">保存分类</button></form>`;
                el('expense-category-form').addEventListener('submit',event=>{event.preventDefault();this.saveExpenseCategoryEditor();});this.showModal();el('expense-category-name').focus();
            },
            async saveExpenseCategoryEditor() {
                if(this.projectMutationPending)return false;
                const next=list(this).map(p=>({...p,categories:p.categories.map(n=>({...n}))}));
                const p=next.find(p=>p.id===this.projectViewId),editor=this.expenseCategoryEditor,name=el('expense-category-name').value.trim();
                if(editor.id)p.categories.find(n=>n.id===editor.id).name=name;else p.categories.push({id:P.id('category'),name,parentId:editor.parentId || null});
                return this.commitProjectList(next,()=>this.closeModal());
            },
            async deleteExpenseCategory(id) {
                if(!P.canDelete(this.data,this.projectViewId,id)){this.showMessage('该分类已有下级或账单，不能直接删除','error');return;}
                const next=list(this).map(p=>p.id===this.projectViewId?{...p,categories:p.categories.filter(n=>n.id!==id)}:p);
                return this.commitProjectList(next);
            },
            openProjectTransactions(categoryId='') {
                this.renderProjectSelectors();el('project-filter').value=this.projectViewId;this.renderProjectSelectors();
                if(categoryId.startsWith('__direct:'))el('project-category-filter').innerHTML+=option(categoryId,'直接记在所选分类');
                el('project-category-filter').value=categoryId;
                for(const id of ['date-from','date-to','transaction-search','category-filter'])el(id).value='';
                document.querySelector('[data-section="transactions"]').click();this.filterTransactions();
            },
            enhanceEntryForm(editing=null) {
                const prefix=editing?'edit-':'',form=el(prefix+'transaction-form');if(!form)return;
                const amount=el(prefix+'transaction-amount'),amountGroup=amount.closest('.form-group');
                form.prepend(amountGroup);amountGroup.classList.add('entry-amount');
                amount.min='0.01';amount.placeholder='0.00';amount.inputMode='decimal';if(editing)amount.value=Math.abs(editing.amount);
                const direction=document.createElement('fieldset');direction.className='entry-direction';
                direction.innerHTML=`<legend class="sr-only">收支方向</legend><label><input type="radio" name="entry-direction" value="expense" ${!editing || editing.amount<0?'checked':''}>支出</label><label><input type="radio" name="entry-direction" value="income" ${editing?.amount>=0?'checked':''}>收入</label>`;form.prepend(direction);
                const hint=el('amount-hint');if(hint)hint.textContent='只需填写正数，选择支出或收入即可。';
                const projectId=editing ? editing.projectId || '' : this.activeProjectId || '';
                const group=document.createElement('div');group.className='entry-project-fields form-wide';
                group.innerHTML=`<div class="form-group"><label for="entry-project">归属项目</label><select id="entry-project">${option('','日常 · 无项目')+list(this).filter(p=>!p.archived || p.id===projectId).map(p=>option(p.id,p.name+(p.archived?' · 已归档':''))).join('')}</select></div><div id="entry-expense-categories"><label for="expense-level-1">项目消费分类 <span class="helper-text">选到任意层即可</span></label><div class="expense-levels"><select id="expense-level-1" aria-label="一级消费分类"></select><select id="expense-level-2" aria-label="二级消费分类" hidden></select><select id="expense-level-3" aria-label="三级消费分类" hidden></select></div></div>`;
                amountGroup.after(group);el('entry-project').value=projectId;
                el('entry-project').addEventListener('change',()=>this.updateEntryProject());
                for(let depth=1;depth<=3;depth++)el('expense-level-'+depth).addEventListener('change',()=>this.updateExpenseLevels(depth));
                this.updateEntryProject(editing ? editing.expenseCategoryId || null : this.lastProjectCategories?.[projectId] || null);
                // A single account picker shows the complete path; old fields remain internal for compatibility.
                const accounts=[];
                const visit=(nodes,path=[])=>Object.values(nodes).forEach(node=>{const names=[...path,node.name];if(node.children && Object.keys(node.children).length)visit(node.children,names);else accounts.push({node,names});});visit(this.data.categories);
                const accountGroup=document.createElement('div');accountGroup.className='form-group entry-account';
                accountGroup.innerHTML=`<label for="entry-account">资金账户</label><select id="entry-account" required>${option('','选择付款 / 收款账户')+accounts.map(a=>option(a.node.id,a.names.join(' / ')+' · '+a.node.currency+(a.node.isDebt?' · 负债':''))).join('')}</select><p id="entry-account-note" class="helper-text"></p>`;
                group.before(accountGroup);
                const category=el(prefix+'transaction-category'),subcategory=el(prefix+'transaction-subcategory');
                category.closest('.form-group').hidden=true;subcategory.closest('.form-group').hidden=true;category.required=false;subcategory.required=false;
                const matches=accounts.filter(a=>a.names[0]===editing?.category && (a.names.length===1?!editing?.subcategory:a.node.name===editing?.subcategory));
                const initial=editing?.accountId || (matches.length===1?matches[0].node.id:'') || (!editing?this.lastEntryAccountId:'');
                if(initial)el('entry-account').value=initial;
                const selectAccount=()=>{const account=accounts.find(a=>a.node.id===el('entry-account').value);if(!account)return;
                    category.value=account.names[0];if(editing)this.updateEditSubcategoryOptions(category.value,account.names.length>1?account.node.name:'');else{this.updateSubcategoryOptions(category.value);subcategory.value=account.names.length>1?account.node.name:'';}
                    el(prefix+'transaction-currency').value=account.node.currency;
                    el('entry-account-note').textContent=account.node.isDebt?'负债账户：支出增加待还款，入账减少待还款。':'';
                };
                el('entry-account').addEventListener('change',selectAccount);if(!editing && initial)selectAccount();
                const advanced=document.createElement('details');advanced.className='entry-advanced form-wide';advanced.innerHTML='<summary>更多选项 <span>日期、时间、旧账单类型与模板</span></summary>';
                const date=el(prefix+'transaction-date'),type=el(prefix+'transaction-type'),time=el(prefix+'transaction-time'),include=el(editing?'edit-include-time':'include-time');
                for(const field of [date,include,time,type])if(field)advanced.append(field.closest('.form-group'));
                const templates=el('modal-body').querySelector('.template-buttons')?.closest('.form-group');if(templates)advanced.append(templates);
                form.insertBefore(advanced,form.lastElementChild);
                const finalGroup=form.lastElementChild;finalGroup.classList.add('entry-submit-actions');
                if(!editing){const more=document.createElement('button');more.type='button';more.className='btn btn-secondary';more.id='save-and-continue';more.textContent='保存并继续';more.addEventListener('click',()=>{if(form.reportValidity())this.submitTransaction(true);});finalGroup.append(more);}
                const error=document.createElement('p');error.id='entry-error';error.className='form-error form-wide';error.setAttribute('role','alert');form.insertBefore(error,finalGroup);
                amount.focus();
            },
            updateEntryProject(selectedCategory=null) {
                const project=list(this).find(p=>p.id===el('entry-project').value);
                el('entry-expense-categories').hidden=!project;
                const purpose=el('transaction-purpose') || el('edit-transaction-purpose');
                if(purpose){purpose.closest('.form-group').hidden=Boolean(project);purpose.required=!project;}
                for(let depth=1;depth<=3;depth++){const select=el('expense-level-'+depth);select.innerHTML=option('',depth===1?'稍后分类':'记在上一级');select.hidden=depth>1;}
                if(project){el('expense-level-1').innerHTML+=project.categories.filter(n=>!n.parentId).map(n=>option(n.id,n.name)).join('');
                    if(selectedCategory){const nodes=P.chain(project,selectedCategory);nodes.forEach((node,index)=>{el('expense-level-'+(index+1)).value=node.id;this.updateExpenseLevels(index+1);});}}
            },
            updateExpenseLevels(changedDepth) {
                const p=list(this).find(p=>p.id===el('entry-project').value);if(!p)return;
                for(let depth=changedDepth+1;depth<=3;depth++){
                    const parent=el('expense-level-'+(depth-1)).value,children=parent?p.categories.filter(n=>n.parentId===parent):[];
                    const select=el('expense-level-'+depth);select.innerHTML=option('','记在上一级')+children.map(n=>option(n.id,n.name)).join('');select.hidden=!children.length;
                }
            },
            readProjectEntry() {
                const projectId=el('entry-project')?.value || null;let expenseCategoryId=null;
                if(projectId)for(let i=1;i<=3;i++){const value=el('expense-level-'+i)?.value;if(value)expenseCategoryId=value;}
                return {projectId,expenseCategoryId};
            },
            completeContinuousEntry() {
                const amount=el('transaction-amount');amount.value='';el('transaction-description').value='';
                el('entry-error').textContent='';const button=el('transaction-form').querySelector('button[type=submit]');button.disabled=false;button.textContent='添加账单';
                this.lastEntryAccountId=el('entry-account').value;amount.focus();
            }
        });
    }};
})(typeof globalThis !== 'undefined' ? globalThis : this);
