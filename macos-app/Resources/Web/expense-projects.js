(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AssetTrackerProjects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';
    let sequence = 0;
    const id = prefix => `${prefix}-${Date.now().toString(36)}-${++sequence}`;
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
    const validID = value => text(value) && !['__proto__', 'constructor', 'prototype'].includes(value) && !value.startsWith('__');
    const projects = state => Array.isArray(state.expenseProjects) ? state.expenseProjects : [];
    function chain(project, categoryId) {
        const nodes = new Map((project?.categories || []).map(node => [node.id, node]));
        const result = [], visited = new Set();
        while (categoryId) {
            if (visited.has(categoryId) || !nodes.has(categoryId)) throw new Error('分类树存在循环或缺少父分类');
            visited.add(categoryId);
            const node = nodes.get(categoryId); result.unshift(node); categoryId = node.parentId;
            if (result.length > 3) throw new Error('消费分类最多三级');
        }
        return result;
    }
    function validate(state) {
        const errors = [];
        if (state.expenseProjects !== undefined && !Array.isArray(state.expenseProjects)) return ['项目列表格式错误'];
        const projectMap = new Map();
        for (const project of projects(state)) {
            if (!record(project) || !validID(project.id) || !text(project.name) || typeof project.archived !== 'boolean' || !Array.isArray(project.categories)) {
                errors.push('项目字段不完整'); continue;
            }
            if (projectMap.has(project.id)) errors.push('项目 ID 重复');
            projectMap.set(project.id, project);
            const ids = new Set(), siblings = new Set();
            for (const node of project.categories) {
                if (!record(node) || !validID(node.id) || !text(node.name) || !(node.parentId === null || validID(node.parentId))) {
                    errors.push('消费分类字段不完整'); continue;
                }
                if (ids.has(node.id)) errors.push('消费分类 ID 重复');
                ids.add(node.id);
                const siblingKey = JSON.stringify([node.parentId, node.name.trim().toLocaleLowerCase()]);
                if (siblings.has(siblingKey)) errors.push('同一级下的分类名称不能重复');
                siblings.add(siblingKey);
                try { chain(project, node.id); } catch (error) { errors.push(error.message); }
            }
        }
        for (const item of Array.isArray(state.transactions) ? state.transactions : []) {
            if (!record(item)) continue;
            const projectId = item.projectId, categoryId = item.expenseCategoryId;
            if (projectId != null && projectId !== '' && !validID(projectId)) errors.push('账单项目 ID 无效');
            if (categoryId != null && categoryId !== '' && !validID(categoryId)) errors.push('账单消费分类 ID 无效');
            if (!projectId && categoryId) errors.push('消费分类必须归属于一个项目');
            if (projectId && !projectMap.has(projectId)) errors.push('账单引用的项目不存在');
            if (projectId && categoryId && !projectMap.get(projectId)?.categories?.some(node => node.id === categoryId)) errors.push('账单分类不属于所选项目');
        }
        return [...new Set(errors)];
    }
    function createProject(name, travel) {
        if (!text(name)) throw new Error('请输入 1–120 字的项目名称');
        const project = {id: id('project'), name: name.trim(), archived: false, categories: []};
        if (travel) {
            for (const [name, children] of [['餐饮',['正餐','饮品','零食']], ['住宿',['酒店','民宿']], ['交通',['往返交通','当地交通']], ['游玩',['门票','体验']], ['购物',[]], ['其他',[]]]) {
                const parent = {id:id('category'), name, parentId:null}; project.categories.push(parent);
                for (const child of children) project.categories.push({id:id('category'), name:child, parentId:parent.id});
            }
        }
        return project;
    }
    function path(project, categoryId) { return chain(project, categoryId).map(node => node.name).join(' / '); }
    function matches(state, item, projectId, categoryId) {
        if (projectId === '__daily') return !item.projectId;
        if (projectId && item.projectId !== projectId) return false;
        if (!categoryId) return true;
        if (categoryId === '__unclassified') return !item.expenseCategoryId;
        if (categoryId.startsWith('__direct:')) return item.expenseCategoryId === categoryId.slice(9);
        const project = projects(state).find(project => project.id === item.projectId);
        return Boolean(project && chain(project, item.expenseCategoryId).some(node => node.id === categoryId));
    }
    function canDelete(state, projectId, categoryId) {
        const project = projects(state).find(item => item.id === projectId);
        return Boolean(project?.categories.some(node => node.id === categoryId)
            && !project.categories.some(node => node.parentId === categoryId)
            && !(state.transactions || []).some(item => item.projectId === projectId && item.expenseCategoryId === categoryId));
    }
    function summarize(state, projectId, parentId = null) {
        const project = projects(state).find(item => item.id === projectId);
        if (!project) return {expense:0,income:0,count:0,rows:[],unconverted:{}};
        const base = state.settings?.baseCurrency || 'CNY';
        const rates = state.settings?.exchangeRates || {};
        const accumulator = () => ({expense:0,income:0,count:0,unconverted:{}});
        const totals = accumulator();
        const rows = project.categories.filter(node => node.parentId === (parentId || null)).map(node => ({id:node.id,name:node.name,...accumulator()}));
        const otherId = parentId ? '__direct' : '__unclassified';
        rows.push({id:otherId,name:parentId ? '直接记在本级' : '未分类',...accumulator()});
        const rowMap = new Map(rows.map(row => [row.id,row]));
        function add(target, item) {
            target.count++;
            const currency = item.currency || base;
            const rate = currency === base ? 1 : Object.prototype.hasOwnProperty.call(rates,currency) ? rates[currency] : null;
            const kind = item.amount < 0 ? 'expense' : 'income';
            if (!(Number.isFinite(rate) && rate > 0)) {
                if (!/^[A-Z]{3}$/.test(currency)) return;
                const unknown = target.unconverted[currency] ||= {expense:0,income:0,count:0};
                unknown[kind] += Math.abs(item.amount); unknown.count++; return;
            }
            target[kind] += Math.round(Math.abs(item.amount) * rate * 100);
        }
        for (const item of Array.isArray(state.transactions) ? state.transactions : []) {
            if (!matches(state,item,projectId,parentId || '')) continue;
            const nodes = chain(project,item.expenseCategoryId);
            const index = parentId ? nodes.findIndex(node => node.id === parentId) + 1 : 0;
            const rowId = nodes[index]?.id || otherId;
            const row = rowMap.get(rowId);
            if (!row) continue;
            add(totals,item); add(row,item);
        }
        for (const value of [totals,...rows]) { value.expense /= 100; value.income /= 100; }
        return {...totals,rows:rows.filter(row => row.count || !row.id.startsWith('__'))};
    }
    return Object.freeze({id,validate,createProject,chain,path,matches,canDelete,summarize});
});
