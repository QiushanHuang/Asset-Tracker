(function(root){
 'use strict';
 const W=root.AssetTrackerWorkspace,R=root.AssetTrackerRecognition,D=root.AssetTrackerDedup,el=id=>document.getElementById(id);
 const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={exact:'相同来源记录',high:'较强重复线索',possible:'相似，需核对',conflict:'来源信息冲突'};
 const uid=()=>root.crypto.randomUUID();
 root.AssetTrackerBillUI={install(Tracker){Object.assign(Tracker.prototype,{
  refreshWorkspaceDuplicates(){
   if(!this.ws)return;const basis=W.duplicateReviewBasis(this.data,this.ws.drafts,this.ws.scope),cached=this.ws.duplicateReviewCache;
   const unchanged=cached?.basis===basis&&cached.reviews===this.ws.duplicateReviews,scopeChanged=cached&&cached.scope!==this.ws.scope;
   if(!unchanged){
    const reviews=new Map(),reviewDraft=W.createDuplicateReviewer(this.data,this.ws.drafts);
    for(const d of this.ws.drafts)if(d.status==='pending')reviews.set(d.id,reviewDraft(d));
    this.ws.duplicateReviews=reviews;this.ws.duplicateReviewCache={basis,reviews,scope:this.ws.scope};
   }
   for(const d of this.ws.drafts.filter(d=>d.status==='pending')){
    const review=this.ws.duplicateReviews.get(d.id);if(scopeChanged)delete d.duplicateDecision;d.suspected=review.matches.length>0;
    d.duplicateConfirmed=!!(d.duplicateDecision?.action==='keep'&&d.duplicateDecision.signature===review.signature&&!review.blocked);
    if(!d.duplicateConfirmed)delete d.duplicateDecision;
    if(d.suspected&&!d.duplicateConfirmed)this.ws.selected.delete(d.id);
   }
   return !unchanged;
  },
  duplicateWorkspaceHTML(d){
   const r=this.ws.duplicateReviews?.get(d.id);if(!r?.matches.length)return '<p class="helper-text">当前字段未发现重复线索；信息补齐后会重新检查。</p>';
   const accountMap=new Map(W.accounts(this.data).map(a=>[a.id,a.name])),pendingIds=new Set(this.ws.drafts.filter(x=>x.status==='pending').map(W.transactionId));
   return `<div class="ws-duplicate-evidence" role="status"><strong>${h(labels[r.matches[0].level])} · ${r.matches.total||r.matches.length} 笔匹配</strong><p>逐项比对原始时间、账户、金额和来源。提示不代表已合并或删除。</p>${r.matches.map(m=>`<details><summary>${h(labels[m.level])} · ${h(m.transaction.date)} · ${h(m.transaction.amount)} ${h(m.transaction.currency)} · ${h(m.transaction.description||'无描述')}</summary><p>${pendingIds.has(m.transactionId)?'待核对草稿':'已入账记录'} ${h(m.transactionId)} · ${h(accountMap.get(m.transaction.accountId)||m.transaction.accountId||'账户待核对')}</p>${m.transaction.sourceIdentity?`<p>来源：${h(m.transaction.sourceIdentity.provider)} · ${h(m.transaction.sourceIdentity.id)}</p>`:''}<p>${h(m.reasons.join('；'))}</p><button type="button" class="ws-text-button" data-ws-action="compare-draft" data-draft-id="${h(d.id)}" data-match-id="${h(m.transactionId)}">逐项对比</button>${m.differences.length?`<p>差异：${h(m.differences.join('；'))}</p>`:''}</details>`).join('')}${r.matchCount>20?'<p>匹配超过 20 笔，确认暂不可用。请补齐时间、描述等信息，或先处理其他相似草稿。</p>':''}${r.blocked?`<p class="negative">${r.matchCount>20?'请先缩小匹配范围，再逐笔核对。':'相同来源或 ID 已出现在账本或其他草稿中。请先核对位置，忽略多余草稿；如为账本内容冲突，请更正原记录。'}</p>`:`<label class="ws-check"><input type="checkbox" id="ws-draft-duplicate" ${d.duplicateConfirmed?'checked':''}>已核对以上记录，这是一笔不同消费，仍然保留</label>`}</div>`;
  },
  updateWorkspaceDuplicateChoice(d,event){
   const checkbox=el('ws-draft-duplicate'),checked=!!checkbox?.checked,previous=this.ws.duplicateReviews?.get(d.id);
   if(event?.target?.id==='ws-draft-duplicate'){
    const r=this.ws.duplicateReviews?.get(d.id);if(checked&&r&&!r.blocked)d.duplicateDecision={signature:r.signature,action:'keep'};else delete d.duplicateDecision;
   }
   this.refreshWorkspaceDuplicates();const panel=el('ws-draft-duplicate-review');
   if(panel&&previous!==this.ws.duplicateReviews?.get(d.id))panel.innerHTML=this.duplicateWorkspaceHTML(d);
   else if(checkbox)checkbox.checked=!!d.duplicateConfirmed;
   this.updateWorkspaceDraftStatus?.(d);
  },
  async recognizeWorkspaceText(text){
   this.assertWorkspaceWritable();
   const result=R.recognize(text,{today:W.today(),accounts:W.accounts(this.data),purposes:this.data.purposeCategories||[]});
   const drafts=result.items.map(item=>({id:uid(),source:'offline',status:'pending',sourceText:item.sourceText,proposal:item.proposal,...(item.sourceIdentity?{sourceIdentity:item.sourceIdentity}:{}),evidence:['离线识别 · '+result.format,...item.warnings].join('；')}));
   if(this.ws.drafts.filter(d=>d.status==='pending').length+drafts.length>1000)throw Error('待核对最多 1,000 笔，请先处理已有记录');
   if(!drafts.length){this.workspaceMessage(result.warnings.join('；')||'没有识别出可核对的记录');return result;}
   const prior=this.ws.drafts;this.ws.drafts=[...prior,...drafts];
   try{await this.persistWorkspace();}catch(e){this.ws.drafts=prior;throw e;}
   this.ws.focusId=drafts[0].id;this.ws.reviewPane='detail';this.refreshWorkspaceDuplicates();this.ws.selected=new Set(drafts.filter(d=>!d.suspected).map(d=>d.id));
   this.workspaceMessage(`离线准备 ${drafts.length} 笔草稿，确认前不入账。${result.warnings.join('；')}`);this.openWorkspaceSection('workspace-review');this.renderWorkspace();return result;
  },
  openWorkspaceRecognition(){
   el('modal-body').innerHTML=`<h3>离线识别账单</h3><p>本机处理，核对后入账。</p><input type="file" id="ws-recognition-input" accept=".txt,.csv,.tsv,.xlsx" hidden><form id="ws-recognition-form"><label>原始账单<textarea id="ws-recognition-text" rows="9" maxlength="200000" placeholder="2026-10-02 午餐支出32元，现金 / 人民币" required></textarea></label><div class="ws-inline-actions"><button type="button" class="btn btn-secondary" id="ws-recognition-file">选择文本或表格</button>${root.AssetTrackerHost?.isNative?'<button type="button" class="btn btn-secondary" id="ws-recognition-image">选择图片</button>':''}<button type="submit" class="btn btn-primary">生成核对草稿</button></div><p id="ws-recognition-status" role="status"></p></form>`;
   el('ws-recognition-form').onsubmit=async e=>{e.preventDefault();const status=el('ws-recognition-status'),form=el('ws-recognition-form');if(form.dataset.busy)return;form.dataset.busy='1';try{const result=await this.recognizeWorkspaceText(el('ws-recognition-text').value);if(result.items.length)this.closeModal();else status.textContent=result.warnings.join('；')||'未识别到记录';}catch(error){status.textContent=error.message;}finally{delete form.dataset.busy;}};
   el('ws-recognition-file').onclick=async()=>{try{
    const result=await this.fileAdapter.openImport({acceptedTypes:'.txt,.csv,.tsv,.xlsx',fileInputId:'ws-recognition-input',readAs:'binary'});if(!result)return;
    if(result.text.length>16*1024*1024)throw Error('文件超过 12 MB');
    const raw=this.fileAdapter.normalizeImportedContent(result.text,result.encoding||'binary',{output:'binary'});
    if(/\.xlsx$/i.test(result.fileName||'')){const workbook=root.XLSX.read(raw,{type:'binary',raw:true,sheetRows:1102});const sheet=workbook.Sheets[workbook.SheetNames[0]];if(sheet['!fullref']&&sheet['!fullref']!==sheet['!ref'])throw Error('表格超过识别行数上限，请分批处理，尚未导入');el('ws-recognition-text').value=root.XLSX.utils.sheet_to_csv(sheet,{FS:'\t'});}
    else{const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));try{el('ws-recognition-text').value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{el('ws-recognition-text').value=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}}
    el('ws-recognition-status').textContent='已读取，请检查原文后识别。';
   }catch(error){el('ws-recognition-status').textContent=error.message;}};
   if(el('ws-recognition-image'))el('ws-recognition-image').onclick=async()=>{const button=el('ws-recognition-image'),status=el('ws-recognition-status');button.disabled=true;try{status.textContent='正在本机识别图片…';const result=await root.AssetTrackerHost.invoke('bill.ocr',{});el('ws-recognition-text').value=result.text;status.textContent='图片文字已提取，请检查金额与时间后识别。';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
   this.showModal();el('ws-recognition-text').focus({preventScroll:true});
  }

 });}};
})(globalThis);
