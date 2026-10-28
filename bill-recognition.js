(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AssetTrackerRecognition = api;
})(globalThis, function () {
  'use strict';
  const MAX_LENGTH = 1024 * 1024, MAX_ITEMS = 1000;
  const text = value => String(value ?? '').trim();
  const normalized = value => text(value).normalize('NFKC');
  const unique = values => [...new Set(values.filter(Boolean))];
  const DATE = /(?<!\d)(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?!\d)/g;
  const aliases = {
    date:['交易时间','交易创建时间','付款时间','支付时间','交易日期','日期','记账时间'],
    amount:['金额(元)','金额','交易金额','交易金额(元)','实付金额','实付金额(元)','收支金额'],
    direction:['收/支','收支','收支类型','收支方向'],
    merchant:['交易对方','商户','商户名称','对方名称','收款方'],
    description:['商品','商品名称','商品说明','描述','交易内容'],
    account:['支付方式','收/付款方式','付款方式','资金账户','账户','账户名称'],
    status:['当前状态','交易状态','状态'],
    identity:['交易单号','交易号','交易订单号'],
    type:['交易类型','类型'],
    currency:['币种','货币类型','交易币种'],
  };
  const key = value => normalized(value).replace(/\s/g,'');
  function column(headers, name) { return headers.findIndex(h => aliases[name].includes(key(h))); }
  function validDate(parts) {
    const [,year,month,day,hour,minute,second] = parts;
    const y=Number(year), m=Number(month), d=Number(day);
    if(y<1000||m<1||m>12||d<1||d>31||hour!==undefined&&(Number(hour)>23||Number(minute)>59||Number(second||0)>59))return '';
    const result=new Date(Date.UTC(y,m-1,d));
    if(result.getUTCFullYear()!==y||result.getUTCMonth()!==m-1||result.getUTCDate()!==d)return '';
    return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`+(hour!==undefined?`T${hour.padStart(2,'0')}:${minute}`+(second!==undefined?`:${second}`:''):'');
  }
  function dateValue(source, today, warnings) {
    const raw=normalized(source), matches=[...raw.matchAll(DATE)], dates=unique(matches.map(validDate));
    if(matches.length) {
      if(dates.length!==1||matches.some(m=>!validDate(m))){warnings.push('日期无效或存在多个日期，请核对');return '';}
      return dates[0];
    }
    const relative=unique([...raw.matchAll(/今天|今日|昨天|昨日|前天/g)].map(m=>({今天:0,今日:0,昨天:1,昨日:1,前天:2}[m[0]]+1)));
    if(relative.length===1) {
      const m=[...normalized(today).matchAll(DATE)];
      if(m.length!==1||!validDate(m[0])){warnings.push('相对日期缺少有效的当前日期，请手动选择');return '';}
      const day=new Date(validDate(m[0]).slice(0,10)+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(relative[0]-1));
      const time=raw.match(/(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/);
      if(time&&(Number(time[1])>23||Number(time[2])>59||Number(time[3]||0)>59)){warnings.push('时间无效，请核对');return '';}
      return day.toISOString().slice(0,10)+(time?`T${time[1].padStart(2,'0')}:${time[2]}`+(time[3]?`:${time[3]}`:''):'');
    }
    warnings.push(relative.length?'存在多个相对日期，请核对':'未识别到日期，请选择日期');return '';
  }
  function money(raw) {
    let value=normalized(raw).replace(/^(?:人民币|CNY|RMB|USD|HKD|EUR|美元|港币|港元)\s*/i,'').replace(/^[¥$€]\s*/,'').replace(/\s*(?:元|人民币|CNY|RMB|USD|HKD|EUR|美元|港币|港元)$/i,'');
    if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(value))return '';
    value=value.replace(/,/g,'').replace(/^[+-]/,'').replace(/^0+(?=\d)/,'');
    return Number(value)>0&&Number(value)<=1e12?value:'';
  }
  function currency(source, fallback='') {
    const s=normalized(source);const values=[];
    if(/\b(?:CNY|RMB)\b|人民币|[¥]|(?<![美港欧日])元/.test(s))values.push('CNY');
    if(/\bUSD\b|美元|US\$/i.test(s))values.push('USD');
    if(/\bHKD\b|港币|港元|HK\$/i.test(s))values.push('HKD');
    if(/\bEUR\b|欧元|€/i.test(s))values.push('EUR');
    const found=unique(values);if(s.includes('$')&&!found.length)return '';return found.length===1?found[0]:found.length?'':fallback;
  }
  function accountValue(source, context, warnings) {
    const accounts=Array.isArray(context.accounts)?context.accounts:[], raw=normalized(source);
    const matches=accounts.filter(a=>unique([a.name,...(a.names||[]).slice(-1)]).some(n=>n&&raw.includes(normalized(n))));
    if(matches.length===1)return matches[0];
    if(!matches.length&&context.defaultAccountId){const selected=accounts.find(a=>a.id===context.defaultAccountId);if(selected)return selected;}
    warnings.push(matches.length?'匹配到多个资金账户，请选择':'未识别到资金账户，请选择');return null;
  }
  function provider(source, headers=[]) {
    if(/微信|WeChat/i.test(source)||headers.some(h=>key(h)==='当前状态'))return 'wechat';
    if(/支付宝|Alipay/i.test(source)||headers.some(h=>key(h)==='交易创建时间'))return 'alipay';
    return 'statement';
  }
  function draft(source, context, fields={}) {
    const warnings=[], account=accountValue(fields.account??source,context,warnings);
    const date=dateValue(fields.date??source,context.today,warnings);
    let amount=fields.amount===undefined?textAmount(source,warnings):money(fields.amount);
    let direction=fields.direction||(/收入|收款|到账|工资|报销款|退款(?:已)?到账|退款成功/.test(source)?'income':'expense');
    const flow=fields.flow??source;
    const refund=/退款|退货/.test(flow), received=/退款(?:已)?到账|退款成功|退款已收到/.test(flow);
    if(/转账|转入|转出|充值|提现|不计收支/.test(flow)) {amount='';warnings.push('转账、充值或提现需要核对两个账户，未识别为普通收支');}
    if(refund&&!received){amount='';warnings.push('退款是否到账或原交易是否冲销不明确，请核对');}
    if(refund&&received){if(fields.direction==='expense'){amount='';warnings.push('原支出含退款状态，请核对实际退款与原交易');}else direction='income';}
    if(direction==='income'&&(/^-/.test(text(fields.amount))||/收入\s*[:：]?\s*[¥$€]?\s*-\d/.test(source))){amount='';warnings.push('收入方向与负金额冲突，请核对');}
    if(fields.direction==='unknown'){amount='';direction='expense';warnings.push('收支方向不明确，请核对');}
    if(!amount&&!warnings.some(w=>/金额|退款|转账|方向/.test(w)))warnings.push('未识别到有效交易金额，请填写');
    const curr=fields.currency||currency(fields.amount===undefined?source:fields.currencySource||'',account?.currency||'');
    if(!curr)warnings.push('未识别到币种，请选择');
    const purposes=unique((context.purposes||[]).filter(p=>normalized(source).includes(normalized(p))));
    const proposal={date,amount,direction,currency:curr,accountId:account?.id||'',purpose:purposes.length===1?purposes[0]:'',description:text(fields.description??textDescription(source,account)).slice(0,500),projectId:'',expenseCategoryId:''};
    const item={proposal,sourceText:source,warnings};
    if(fields.identity){const origin=fields.provider||provider(source);if(origin!=='statement')item.sourceIdentity={provider:origin,id:text(fields.identity)};else warnings.push('来源平台不明确，交易号仅保留在原文，不作为重复身份依据');}
    return item;
  }
  function labels(source) {
    const lines=source.split(/\r?\n/),result=[];
    const labelName=value=>({DATE:'日期',TIME:'交易时间',TOTAL:'金额',AMOUNT:'金额','AMOUNT PAID':'实付金额',PAID:'实付金额',MERCHANT:'商户',DESCRIPTION:'描述','PAYMENT METHOD':'支付方式'})[normalized(value).toUpperCase()]||normalized(value);
    const known=/^(?:商户|商户名称|交易对方|商品|商品名称|事项|描述|收款方|交易时间|支付时间|付款时间|交易日期|日期|实付金额|实付|支付金额|付款金额|收款金额|到账金额|实收金额|交易金额|金额|支付方式|付款方式|资金账户|账户|交易单号|交易号|交易订单号)$/;
    for(let i=0;i<lines.length;i++) {
      const match=lines[i].match(/^\s*([^:：]{1,16})\s*[:：]\s*(.+?)\s*$/);
      if(match){result.push({name:labelName(match[1]),value:match[2]});continue;}
      if(known.test(labelName(lines[i]))&&text(lines[i+1])&&!known.test(labelName(lines[i+1])))result.push({name:labelName(lines[i]),value:text(lines[++i])});
    }
    return result;
  }
  function textAmount(source,warnings) {
    const found=labels(source), actual=found.filter(f=>/^(?:实付金额|实付|支付金额|付款金额|收款金额|到账金额|实收金额|交易金额|金额)$/.test(f.name));
    let candidates;
    if(actual.length)candidates=actual.map(f=>money(f.value));
    else {
      const scrubbed=normalized(source).replace(/(?:余额|优惠|折扣|原价|订单金额|总价|服务费|手续费|订单号|流水号|交易单号|交易号|商户单号)\s*[:：]?\s*(?:[¥$€]|CNY|USD|HKD|EUR)?\s*[\d,.]+\s*(?:元|美元|港元)?/g,'').replace(DATE,'');
      const values=[...scrubbed.matchAll(/(?:[¥$€]\s*|\b(?:CNY|USD|HKD|EUR)\s*)([+-]?\d[\d,]*(?:\.\d{1,8})?)(?![\dA-Za-z.,])|(?<![\dA-Za-z.,])([+-]?\d[\d,]*(?:\.\d{1,8})?)\s*(?:元|美元|港币|港元|人民币)|(?:支出|收入|支付|实付|收款|到账)\s*[:：]?\s*([+-]?\d[\d,]*(?:\.\d{1,8})?)(?![\dA-Za-z.,])/g)];
      candidates=values.map(m=>money(m[1]||m[2]||m[3]));
    }
    if(candidates.length!==1||!candidates[0]) {warnings.push(candidates.length>1?'存在多个交易金额，请逐笔核对':'未识别到有效交易金额，请填写');return '';}
    return candidates[0];
  }
  function textDescription(source,account) {
    const known=labels(source).find(f=>/^(?:商户|商户名称|交易对方|商品|商品名称|事项|描述|收款方)$/.test(f.name));
    if(known)return known.value;
    let s=normalized(source).replace(DATE,'').replace(/今天|今日|昨天|昨日|前天/g,'').replace(/[¥$€]?\s*\d[\d,.]*\s*(?:元|美元|港元|人民币)?/g,'').replace(/(?:用|使用)?(?:支出|收入|支付|实付|收款|到账)/g,'');
    for(const n of unique([account?.name,...(account?.names||[])]))s=s.split(n).join('');
    return s.replace(/^[\s,，。:：用]+|[\s,，。:：]+$/g,'').replace(/\s+/g,' ').slice(0,500);
  }
  function parseDelimited(source, delimiter) {
    const rows=[];let cells=[],value='',quoted=false,closed=false,start=0;
    const field=()=>{cells.push(text(value));value='';closed=false;};
    const row=end=>{field();rows.push({cells,raw:source.slice(start,end).replace(/\r$/,'')});cells=[];start=end+1;if(rows.length>MAX_ITEMS+100)throw Error('账单超过 1,000 行，请分批识别');};
    for(let i=0;i<source.length;i++) {
      const c=source[i];
      if(quoted){if(c==='"'){if(source[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
      if(c==='"'&&!value.trim()&&!closed){value='';quoted=true;continue;}
      if(c===delimiter){field();continue;}
      if(c==='\n'){row(i);continue;}
      if(closed&&!/[\s\r]/.test(c))throw Error('账单引号格式无效，请检查 CSV');
      value+=c;
    }
    if(quoted)throw Error('账单引号未闭合，请检查 CSV 格式');
    if(value||cells.length)row(source.length);
    return rows;
  }
  function table(source,context) {
    const lines=source.split(/\r?\n/);let offset=0,header;
    for(const line of lines.slice(0,60)) {
      for(const delimiter of ['\t',',']) {
        if(!line.includes(delimiter))continue;
        const headers=parseDelimited(line,delimiter)[0]?.cells||[];
        if(column(headers,'date')>=0&&column(headers,'amount')>=0){header={headers,delimiter,offset};break;}
      }
      if(header)break;offset+=line.length+1+(source.slice(offset+line.length,offset+line.length+2)==='\r\n'?1:0);
    }
    if(!header)return null;
    const rows=parseDelimited(source.slice(header.offset),header.delimiter), headers=rows.shift().cells;
    const data=rows.filter(r=>r.cells.some(Boolean));if(data.length>MAX_ITEMS)throw Error('账单超过 1,000 行，请分批识别');
    const kind=provider(source.slice(0,header.offset),headers),items=[],warnings=[];
    const get=(row,name)=>row.cells[column(headers,name)]||'';
    for(const [index,row] of data.entries()) {
      if(row.cells.length===1&&/^[-=]+|^(?:共|支出|收入|合计|总计|说明|注[:：])/.test(row.cells[0]))continue;
      const status=get(row,'status');
      if(/交易关闭|已关闭|已取消|支付失败|交易失败|未支付|待付款|等待付款|已撤销/.test(status)){warnings.push(`第 ${index+2} 行状态为「${status}」，已跳过未成交记录`);continue;}
      const direction=get(row,'direction'),amount=get(row,'amount'),type=get(row,'type');
      const explicitCurrency=normalized(get(row,'currency')).toUpperCase();
      const item=draft(row.raw,context,{
        date:get(row,'date'),amount,account:get(row,'account'),direction:/支出|付款/.test(direction)?'expense':/收入|收款/.test(direction)?'income':'unknown',
        currency:explicitCurrency&&/^[A-Z]{3}$/.test(explicitCurrency)?explicitCurrency:'',currencySource:headers[column(headers,'amount')]+' '+amount,
        description:unique([get(row,'merchant'),get(row,'description')]).join(' · '),
        identity:get(row,'identity'),provider:kind,flow:[direction,status,type,get(row,'description')].join(' '),
      });
      if(row.cells.length!==headers.length){item.proposal.amount='';item.warnings.push('表格列数不一致，金额暂留空，请核对原始行');}
      items.push(item);
    }
    return {format:kind+'-'+(header.delimiter==='\t'?'tsv':'csv'),items,warnings};
  }
  function recognize(input,context={}) {
    if(typeof input!=='string'||!input.trim())throw Error('请输入账单文字或粘贴 CSV / TSV');
    if(input.length>MAX_LENGTH)throw Error('账单文字超过 1 MB，请分批识别');
    const source=input.replace(/^\uFEFF/,'');
    const parsed=table(source,context);if(parsed)return parsed;
    if(source.split(/\r?\n/).length>MAX_ITEMS)throw Error('账单超过 1,000 行，请分批识别');
    const failed=source.match(/(?:^|\n)\s*(?:(?:交易状态|当前状态|状态)\s*[:：]?\s*)?(支付失败|交易失败|交易关闭|已关闭|已取消|未支付|待付款|已撤销)\s*(?:\n|$)/);
    if(failed&&!/支付成功|交易成功|退款到账/.test(source))return {format:'receipt',items:[],warnings:[`状态为「${failed[1]}」，已跳过未成交记录`]};
    const found=labels(source),fields={};
    const field=pattern=>found.find(f=>pattern.test(f.name))?.value;
    fields.date=field(/^(?:交易时间|支付时间|付款时间|交易日期|日期)$/);
    fields.account=field(/^(?:支付方式|付款方式|资金账户|账户)$/);
    fields.description=field(/^(?:商户|商户名称|交易对方|商品|商品名称|事项|描述|收款方)$/);
    fields.identity=field(/^(?:交易单号|交易号|交易订单号)$/);
    if(fields.identity)fields.provider=provider(source);
    return {format:found.length?'receipt':'text',items:[draft(source,context,fields)],warnings:[]};
  }
  return Object.freeze({recognize});
});
