// 资产记账应用主逻辑
class AssetTracker {
    constructor() {
        this.data = {
            categories: this.getDefaultCategories(),
            transactions: [],
            automationRules: [],
            purposeCategories: this.getDefaultPurposeCategories(),
            initialAssets: [],  // 初始资产状态，独立于历史交易
            settings: {
                baseCurrency: 'CNY',
                exchangeRates: {
                    'CNY': 1.0,
                    'SGD': 5.2,
                    'USD': 7.2,
                    'MYR': 1.6
                },
                autoBackup: true,
                backupInterval: 24 // 小时
            }
        };
        this.charts = {};
        this.loadData();
        this.initializeApp();
        this.setupAutoBackup();
    }

    // 默认用途分类
    getDefaultPurposeCategories() {
        return [
            '餐饮美食',
            '交通出行',
            '购物消费',
            '生活缴费',
            '医疗健康',
            '运动健身',
            '娱乐休闲',
            '学习教育',
            '投资理财',
            '转账红包',
            '工资收入',
            '其他收入',
            '其他支出'
        ];
    }

    // 默认分类模板
    getDefaultCategories() {
        return {
            '银行卡': {
                id: 'bank',
                name: '银行卡',
                balance: 0,
                currency: 'CNY',
                isDebt: false,
                collapsed: false,
                children: {
                    '中国': {
                        id: 'bank-china',
                        name: '中国',
                        balance: 0,
                        currency: 'CNY',
                        isDebt: false,
                        collapsed: false,
                        children: {
                            'ICBC': { id: 'bank-china-icbc', name: 'ICBC', balance: 0, currency: 'CNY', isDebt: false }
                        }
                    },
                    '新加坡': {
                        id: 'bank-singapore',
                        name: '新加坡',
                        balance: 0,
                        currency: 'SGD',
                        isDebt: false,
                        collapsed: false,
                        children: {
                            'DBS': { id: 'bank-singapore-dbs', name: 'DBS', balance: 0, currency: 'SGD', isDebt: false },
                            'ICBC': { id: 'bank-singapore-icbc', name: 'ICBC', balance: 0, currency: 'SGD', isDebt: false }
                        }
                    }
                }
            },
            '支付宝': {
                id: 'alipay',
                name: '支付宝',
                balance: 0,
                currency: 'CNY',
                isDebt: false,
                collapsed: false,
                children: {
                    '总余额': { id: 'alipay-total', name: '总余额', balance: 0, currency: 'CNY', isDebt: false },
                    '小荷包': { id: 'alipay-pocket', name: '小荷包', balance: 0, currency: 'CNY', isDebt: false },
                    '余额宝': { id: 'alipay-yuebao', name: '余额宝', balance: 0, currency: 'CNY', isDebt: false },
                    '钱包': { id: 'alipay-wallet', name: '钱包', balance: 0, currency: 'CNY', isDebt: false },
                    '花呗': { id: 'alipay-huabei', name: '花呗', balance: 0, currency: 'CNY', isDebt: true }
                }
            },
            '微信': {
                id: 'wechat',
                name: '微信',
                balance: 0,
                currency: 'CNY',
                isDebt: false,
                collapsed: false,
                children: {
                    '总余额': { id: 'wechat-total', name: '总余额', balance: 0, currency: 'CNY', isDebt: false },
                    '钱包': { id: 'wechat-wallet', name: '钱包', balance: 0, currency: 'CNY', isDebt: false },
                    'mini fund': { id: 'wechat-minifund', name: 'mini fund', balance: 0, currency: 'CNY', isDebt: false },
                    'wealth': { id: 'wechat-wealth', name: 'wealth', balance: 0, currency: 'CNY', isDebt: false }
                }
            },
            '其他1': {
                id: 'other1',
                name: '其他1',
                balance: 0,
                currency: 'CNY',
                isDebt: false,
                collapsed: false,
                children: {
                    '京东': {
                        id: 'other1-jd',
                        name: '京东',
                        balance: 0,
                        currency: 'CNY',
                        isDebt: false,
                        collapsed: false,
                        children: {
                            '总余额': { id: 'other1-jd-total', name: '总余额', balance: 0, currency: 'CNY', isDebt: false },
                            '小金库': { id: 'other1-jd-vault', name: '小金库', balance: 0, currency: 'CNY', isDebt: false },
                            '白条': { id: 'other1-jd-baitiao', name: '白条', balance: 0, currency: 'CNY', isDebt: true }
                        }
                    },
                    '美团': {
                        id: 'other1-meituan',
                        name: '美团',
                        balance: 0,
                        currency: 'CNY',
                        isDebt: false,
                        collapsed: false,
                        children: {
                            '美团钱包': { id: 'other1-meituan-wallet', name: '美团钱包', balance: 0, currency: 'CNY', isDebt: false }
                        }
                    }
                }
            },
            '其他2': {
                id: 'other2',
                name: '其他2',
                balance: 0,
                currency: 'CNY',
                isDebt: false,
                collapsed: false,
                children: {
                    '数字人民币': { id: 'other2-dcep', name: '数字人民币', balance: 0, currency: 'CNY', isDebt: false }
                }
            },
            '其他3': {
                id: 'other3',
                name: '其他3',
                balance: 0,
                currency: 'CNY',
                isDebt: false,
                collapsed: false,
                children: {
                    '会员服务': { id: 'other3-membership', name: '会员服务', balance: 0, currency: 'CNY', isDebt: true }
                }
            },
            '现金': {
                id: 'cash',
                name: '现金',
                balance: 0,
                currency: 'CNY',
                isDebt: false,
                collapsed: false,
                children: {
                    '人民币': { id: 'cash-cny', name: '人民币', balance: 0, currency: 'CNY', isDebt: false },
                    '外币': {
                        id: 'cash-foreign',
                        name: '外币',
                        balance: 0,
                        currency: 'CNY',
                        isDebt: false,
                        collapsed: false,
                        children: {
                            '新币': { id: 'cash-foreign-sgd', name: '新币', balance: 0, currency: 'SGD', isDebt: false },
                            '令吉': { id: 'cash-foreign-myr', name: '令吉', balance: 0, currency: 'MYR', isDebt: false }
                        }
                    }
                }
            }
        };
    }

    // 初始化应用
    initializeApp() {
        this.setupNavigation();
        this.setupEventListeners();
        this.renderCategories();
        this.renderTransactions();
        this.updateDashboard();
        this.setupCharts();
        this.initializeSettings();
        this.populateInitAssetCategoryOptions();
        this.renderInitialAssetsList();
        this.renderMemo();
        this.initializeTransactionFilters();
    }

    // 导航设置
    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link');
        const sections = document.querySelectorAll('.content-section');

        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetSection = link.dataset.section;

                // 更新导航状态
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');

                // 切换内容区域
                sections.forEach(s => s.classList.remove('active'));
                document.getElementById(targetSection).classList.add('active');

                // 更新标题
                const titles = {
                    'dashboard': '资产概览',
                    'categories': '分类管理',
                    'transactions': '账单记录',
                    'automation': '自动记账',
                    'analytics': '数据分析',
                    'import-export': '导入导出'
                };
                document.getElementById('section-title').textContent = titles[targetSection];

                // 特殊处理
                if (targetSection === 'dashboard') {
                    this.updateDashboard();
                } else if (targetSection === 'analytics') {
                    this.updateAnalyticsOptions();
                }
            });
        });
    }

    // 事件监听器设置
    setupEventListeners() {
        // 添加交易按钮
        document.getElementById('add-transaction-btn').addEventListener('click', () => {
            this.showTransactionModal();
        });

        // 添加分类按钮
        document.getElementById('add-category-btn').addEventListener('click', () => {
            this.showCategoryModal();
        });

        // 添加自动记账规则按钮
        document.getElementById('add-rule-btn').addEventListener('click', () => {
            this.showAutomationRuleModal();
        });

        // 筛选按钮
        document.getElementById('filter-btn').addEventListener('click', () => {
            this.filterTransactions();
        });

        // 生成图表按钮
        document.getElementById('generate-chart-btn').addEventListener('click', () => {
            this.generateCustomChart();
        });

        // 导入导出功能
        document.getElementById('import-btn').addEventListener('click', () => {
            this.importData();
        });

        document.getElementById('export-excel-btn').addEventListener('click', () => {
            this.exportToExcel();
        });

        document.getElementById('export-json-btn').addEventListener('click', () => {
            this.exportToJSON();
        });

        document.getElementById('download-template').addEventListener('click', (e) => {
            e.preventDefault();
            this.downloadTemplate();
        });

        document.getElementById('backup-btn').addEventListener('click', () => {
            this.backupData();
        });

        // 计算历史资产状况按钮
        document.getElementById('calculate-history-btn').addEventListener('click', () => {
            this.calculateHistoricalAssets();
        });

        // 汇率设置相关
        document.getElementById('save-currency-btn').addEventListener('click', () => {
            this.saveCurrencySettings();
        });

        document.getElementById('base-currency').addEventListener('change', () => {
            this.renderExchangeRatesList();
        });

        // 独立资产初始化相关
        document.getElementById('add-initial-asset-btn').addEventListener('click', () => {
            this.addInitialAsset();
        });

        document.getElementById('init-asset-category').addEventListener('change', (e) => {
            this.updateInitAssetSubcategoryOptions(e.target.value);
        });

        // 备忘录相关
        document.getElementById('edit-memo-btn').addEventListener('click', () => {
            this.editMemo();
        });

        // 趋势图时间范围选择
        document.getElementById('trend-time-range').addEventListener('change', () => {
            this.updateAssetTrendChart();
        });

        // 模态框控制
        document.querySelector('.close').addEventListener('click', () => {
            this.closeModal();
        });

        window.addEventListener('click', (e) => {
            if (e.target === document.getElementById('modal')) {
                this.closeModal();
            }
        });
    }

    // 数据持久化
    saveData() {
        localStorage.setItem('assetTrackerData', JSON.stringify(this.data));
    }

    loadData() {
        const savedData = localStorage.getItem('assetTrackerData');
        if (savedData) {
            const parsed = JSON.parse(savedData);
            this.data = { ...this.data, ...parsed };
        }
    }

    // 分类管理
    renderCategories() {
        const container = document.getElementById('categories-tree');
        container.innerHTML = '';

        Object.values(this.data.categories).forEach(category => {
            const categoryElement = this.createCategoryElement(category);
            container.appendChild(categoryElement);
        });
    }

    createCategoryElement(category, level = 0) {
        const div = document.createElement('div');
        div.className = `category-item category-level-${level}`;
        div.style.marginLeft = `${level * 20}px`;
        div.draggable = true;
        div.dataset.categoryId = category.id;
        div.dataset.categoryLevel = level;

        // 添加拖拽事件监听器
        this.setupDragAndDrop(div, category, level);

        const hasChildren = category.children && Object.keys(category.children).length > 0;
        const collapseIcon = hasChildren ? (category.collapsed ? '▶' : '▼') : '';

        let displayBalance, currencyInfo, debtInfo;

        if (hasChildren) {
            // 父类别：显示自动计算的汇总数据
            const summary = this.calculateCategorySummary(category);
            displayBalance = this.formatCurrency(summary.totalAssets);

            // 构建外币信息
            const foreignCurrencies = Object.keys(summary.foreignCurrencies).filter(curr => curr !== this.data.settings.baseCurrency);
            if (foreignCurrencies.length > 0) {
                const foreignItems = foreignCurrencies.map(curr => {
                    const foreignAmount = summary.foreignCurrencies[curr];
                    const baseCurrencyAmount = this.convertToBaseCurrency(foreignAmount, curr);
                    return `
                        <div class="foreign-currency-item">
                            <span class="foreign-amount">${this.formatCurrency(foreignAmount, curr)}</span>
                            <span class="base-amount">(≈${this.formatCurrency(baseCurrencyAmount)})</span>
                        </div>
                    `;
                }).join('');
                currencyInfo = `<div class="foreign-currency-info">${foreignItems}</div>`;
            } else {
                currencyInfo = '';
            }

            debtInfo = `
                <div class="category-summary compact">
                    <div class="summary-row">
                        <span class="summary-item">总: ${this.formatCurrency(summary.totalAssets, null, true)}</span>
                        <span class="summary-item">现: ${this.formatCurrency(summary.currentBalance, null, true)}</span>
                        <span class="summary-item">债: ${this.formatCurrency(summary.totalDebt, null, true)}</span>
                    </div>
                    <div class="summary-row">
                        <span class="summary-item base-currency-item">${this.data.settings.baseCurrency}: ${this.formatCurrency(summary.baseCurrencyTotal, this.data.settings.baseCurrency, true)}</span>
                        ${Object.keys(summary.foreignCurrencies).filter(curr => curr !== this.data.settings.baseCurrency).length > 0 ? `
                            <span class="summary-item foreign-currency-summary">外币总计: ${this.formatCurrency(summary.totalAssets - summary.baseCurrencyTotal, null, true)}</span>
                        ` : ''}
                    </div>
                </div>
            `;
        } else {
            // 叶子节点：显示实际余额，只允许编辑
            const balanceInBaseCurrency = this.convertToBaseCurrency(category.balance, category.currency);
            displayBalance = this.formatCurrency(balanceInBaseCurrency);

            const currencyTag = category.currency !== this.data.settings.baseCurrency ?
                `<span class="currency-tag">${category.currency}</span>` : '';
            const originalAmount = category.currency !== this.data.settings.baseCurrency ?
                `<span class="original-amount">(${this.formatCurrency(category.balance, category.currency)})</span>` : '';

            currencyInfo = `${currencyTag} ${originalAmount}`;
            debtInfo = '';
        }

        const debtIndicator = category.isDebt ? '<span class="debt-indicator">💳</span>' : '';
        const isEditable = !hasChildren; // 只有叶子节点可编辑

        div.innerHTML = `
            <div class="category-header" onclick="window.assetTracker.toggleCategoryCollapse('${category.id}')">
                <span class="drag-handle" title="拖拽排序" onclick="event.stopPropagation()">⋮⋮</span>
                <span class="collapse-icon">${collapseIcon}</span>
                <span class="category-name">${category.name} ${debtIndicator}</span>
                <div class="category-balance-container">
                    <span class="category-balance ${category.isDebt ? 'debt' : ''}">${displayBalance}</span>
                    ${currencyInfo}
                </div>
                <div class="category-actions">
                    <button class="btn btn-sm" onclick="event.stopPropagation(); window.assetTracker.editCategoryName('${category.id}')">改名</button>
                    ${isEditable ? `<button class="btn btn-sm" onclick="event.stopPropagation(); window.assetTracker.editCategory('${category.id}')">编辑</button>` : ''}
                    <button class="btn btn-sm" onclick="event.stopPropagation(); window.assetTracker.deleteCategory('${category.id}')">删除</button>
                    ${isEditable ? `<button class="btn btn-sm" onclick="event.stopPropagation(); window.assetTracker.showExchangeRateModal('${category.id}')">汇率</button>` : ''}
                </div>
            </div>
            ${debtInfo}
        `;

        if (hasChildren) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = `category-children ${category.collapsed ? 'collapsed' : ''}`;

            Object.values(category.children).forEach(child => {
                const childElement = this.createCategoryElement(child, level + 1);
                childrenContainer.appendChild(childElement);
            });

            div.appendChild(childrenContainer);
        }

        return div;
    }

    // 设置拖拽功能
    setupDragAndDrop(element, category, level) {
        let draggedElement = null;
        let draggedCategory = null;

        element.addEventListener('dragstart', (e) => {
            draggedElement = element;
            draggedCategory = category;
            element.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', element.outerHTML);
        });

        element.addEventListener('dragend', (e) => {
            element.classList.remove('dragging');
            this.clearDropZones();
        });

        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (element !== draggedElement) {
                element.classList.add('drop-zone');
                this.showDropIndicator(element, e);
            }
        });

        element.addEventListener('dragleave', (e) => {
            if (!element.contains(e.relatedTarget)) {
                element.classList.remove('drop-zone');
                this.hideDropIndicator(element);
            }
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            element.classList.remove('drop-zone');
            this.hideDropIndicator(element);

            if (element !== draggedElement && draggedCategory) {
                this.handleCategoryDrop(draggedCategory, category, element, e);
            }
        });
    }

    // 显示拖拽指示器
    showDropIndicator(element, event) {
        const rect = element.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const isAbove = event.clientY < midpoint;

        element.classList.remove('drop-above', 'drop-below', 'drop-inside');

        if (isAbove) {
            element.classList.add('drop-above');
        } else {
            element.classList.add('drop-below');
        }
    }

    // 隐藏拖拽指示器
    hideDropIndicator(element) {
        element.classList.remove('drop-above', 'drop-below', 'drop-inside');
    }

    // 清除所有拖拽区域样式
    clearDropZones() {
        document.querySelectorAll('.category-item').forEach(item => {
            item.classList.remove('drop-zone', 'drop-above', 'drop-below', 'drop-inside', 'dragging');
        });
    }

    // 处理分类拖拽放置
    handleCategoryDrop(draggedCategory, targetCategory, targetElement, event) {
        const rect = targetElement.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const isAbove = event.clientY < midpoint;

        // 获取拖拽分类的父级容器
        const draggedParent = this.findCategoryParent(draggedCategory.id);
        const targetParent = this.findCategoryParent(targetCategory.id);

        if (!draggedParent || !targetParent) {
            this.showMessage('无法移动分类：找不到父级分类', 'error');
            return;
        }

        // 防止将分类拖拽到自己的子分类中
        if (this.isDescendant(targetCategory.id, draggedCategory.id)) {
            this.showMessage('不能将分类移动到其子分类中', 'error');
            return;
        }

        // 执行移动操作
        this.moveCategoryOrder(draggedCategory, targetCategory, isAbove, draggedParent, targetParent);
    }

    // 查找分类的父级容器
    findCategoryParent(categoryId) {
        const findParent = (categories, targetId, parent = null) => {
            for (const [key, category] of Object.entries(categories)) {
                if (category.id === targetId) {
                    return parent || categories;
                }
                if (category.children) {
                    const result = findParent(category.children, targetId, category);
                    if (result) return result;
                }
            }
            return null;
        };

        return findParent(this.data.categories, categoryId);
    }

    // 检查是否为后代分类
    isDescendant(ancestorId, descendantId) {
        const ancestor = this.findCategoryById(ancestorId);
        if (!ancestor || !ancestor.children) return false;

        const checkChildren = (children) => {
            for (const child of Object.values(children)) {
                if (child.id === descendantId) return true;
                if (child.children && checkChildren(child.children)) return true;
            }
            return false;
        };

        return checkChildren(ancestor.children);
    }

    // 执行分类移动
    moveCategoryOrder(draggedCategory, targetCategory, insertAbove, draggedParent, targetParent) {
        // 从原位置移除
        this.removeCategoryFromParent(draggedCategory.id, draggedParent);

        // 插入到新位置
        this.insertCategoryAtPosition(draggedCategory, targetCategory, insertAbove, targetParent);

        // 保存数据并重新渲染
        this.saveData();
        this.renderCategories();
        this.updateDashboard();
        this.showMessage('分类顺序已更新', 'success');
    }

    // 从父级移除分类
    removeCategoryFromParent(categoryId, parent) {
        if (parent.children) {
            // 从子分类中移除，重建对象保持顺序
            const newChildren = {};
            for (const [key, category] of Object.entries(parent.children)) {
                if (category.id !== categoryId) {
                    newChildren[key] = category;
                }
            }
            parent.children = newChildren;
        } else {
            // 从顶级分类中移除，重建对象保持顺序
            const newCategories = {};
            for (const [key, category] of Object.entries(parent)) {
                if (category.id !== categoryId) {
                    newCategories[key] = category;
                }
            }
            // 更新主分类对象
            if (parent === this.data.categories) {
                this.data.categories = newCategories;
            } else {
                // 清空并重新赋值
                Object.keys(parent).forEach(key => delete parent[key]);
                Object.assign(parent, newCategories);
            }
        }
    }

    // 在指定位置插入分类
    insertCategoryAtPosition(draggedCategory, targetCategory, insertAbove, targetParent) {
        let targetContainer;

        if (targetParent.children) {
            // 目标是子分类
            targetContainer = targetParent.children;
        } else {
            // 目标是顶级分类
            targetContainer = targetParent;
        }

        // 获取目标容器的键值对数组
        const entries = Object.entries(targetContainer);
        const targetIndex = entries.findIndex(([key, category]) => category.id === targetCategory.id);

        if (targetIndex === -1) {
            // 如果找不到目标分类，直接添加到末尾
            targetContainer[draggedCategory.name] = draggedCategory;
            return;
        }

        // 创建新的有序容器，使用Map确保顺序
        const orderedEntries = [];
        let inserted = false;

        for (let i = 0; i < entries.length; i++) {
            const [key, category] = entries[i];

            // 如果要在目标前插入
            if (i === targetIndex && insertAbove && !inserted) {
                orderedEntries.push([draggedCategory.name, draggedCategory]);
                inserted = true;
            }

            // 添加当前项
            orderedEntries.push([key, category]);

            // 如果要在目标后插入
            if (i === targetIndex && !insertAbove && !inserted) {
                orderedEntries.push([draggedCategory.name, draggedCategory]);
                inserted = true;
            }
        }

        // 如果还没插入（在最后位置），则添加到末尾
        if (!inserted) {
            orderedEntries.push([draggedCategory.name, draggedCategory]);
        }

        // 创建新的有序对象
        const newContainer = {};
        for (const [key, category] of orderedEntries) {
            newContainer[key] = category;
        }

        // 更新容器
        if (targetParent.children) {
            targetParent.children = newContainer;
        } else {
            // 完全替换顶级分类以确保顺序
            this.data.categories = newContainer;
        }
    }

    // 计算分类汇总信息
    calculateCategorySummary(category) {
        let totalAssets = 0;
        let currentBalance = 0;
        let totalDebt = 0;
        const foreignCurrencies = {};

        // 分别计算人民币和外币
        let baseCurrencyTotal = 0;  // 人民币总值（不算外币部分）
        let baseCurrencyBalance = 0;  // 人民币现余额
        let baseCurrencyDebt = 0;     // 人民币债务

        const processCategoryRecursive = (cat) => {
            if (!cat.children || Object.keys(cat.children).length === 0) {
                // 叶子节点
                const balanceInBaseCurrency = this.convertToBaseCurrency(cat.balance, cat.currency);
                const isBaseCurrency = cat.currency === this.data.settings.baseCurrency;

                // 记录外币
                if (!foreignCurrencies[cat.currency]) {
                    foreignCurrencies[cat.currency] = 0;
                }
                foreignCurrencies[cat.currency] += cat.balance;

                // 分别计算基准货币和总计
                if (isBaseCurrency) {
                    if (cat.isDebt) {
                        baseCurrencyDebt += Math.abs(cat.balance);
                    } else {
                        baseCurrencyBalance += cat.balance;
                    }
                    baseCurrencyTotal += Math.abs(cat.balance);
                }

                // 计算总计（包含外币）
                if (cat.isDebt) {
                    totalDebt += Math.abs(balanceInBaseCurrency);
                } else {
                    currentBalance += balanceInBaseCurrency;
                }
                totalAssets += Math.abs(balanceInBaseCurrency);
            } else {
                // 非叶子节点，递归处理
                Object.values(cat.children).forEach(processCategoryRecursive);
            }
        };

        if (category.children) {
            Object.values(category.children).forEach(processCategoryRecursive);
        }

        return {
            totalAssets,
            currentBalance: totalAssets - totalDebt,
            totalDebt,
            foreignCurrencies,
            baseCurrencyTotal,      // 人民币总值
            baseCurrencyBalance,    // 人民币现余额
            baseCurrencyDebt        // 人民币债务
        };
    }

    // 切换分类折叠状态
    toggleCategoryCollapse(categoryId) {
        const category = this.findCategoryById(categoryId);
        if (category && category.children) {
            category.collapsed = !category.collapsed;
            this.saveData();
            this.renderCategories();
        }
    }

    // 交易记录管理
    addTransaction(transaction) {
        transaction.id = Date.now().toString();
        transaction.timestamp = new Date().toISOString();
        this.data.transactions.push(transaction);
        this.updateCategoryBalance(transaction);
        this.saveData();
        this.renderTransactions();
        this.updateDashboard();
    }

    updateCategoryBalance(transaction) {
        const categoryPath = this.findCategoryPath(transaction.category, transaction.subcategory);
        if (categoryPath) {
            let current = this.data.categories;

            // 只更新最终目标分类的余额，而不是路径上的每个分类
            for (let i = 0; i < categoryPath.length; i++) {
                const pathPart = categoryPath[i];
                current = current[pathPart];

                if (!current) break;

                // 只在最后一级分类更新余额
                if (i === categoryPath.length - 1) {
                    // 转换交易金额到分类的货币
                    let amountToAdd = transaction.amount;
                    const transactionCurrency = transaction.currency || this.data.settings.baseCurrency;
                    const categoryCurrency = current.currency || this.data.settings.baseCurrency;

                    // 如果货币不同，需要转换
                    if (transactionCurrency !== categoryCurrency) {
                        // 先转换为基准货币，再转换为目标货币
                        const baseAmount = this.convertToBaseCurrency(amountToAdd, transactionCurrency);
                        if (categoryCurrency !== this.data.settings.baseCurrency) {
                            const targetRate = this.data.settings.exchangeRates[categoryCurrency];
                            amountToAdd = baseAmount / targetRate;
                        } else {
                            amountToAdd = baseAmount;
                        }
                    }

                    current.balance += amountToAdd;
                } else if (current.children) {
                    current = current.children;
                }
            }
        }
    }

    findCategoryPath(categoryName, subcategoryName) {
        for (const [key, category] of Object.entries(this.data.categories)) {
            if (category.name === categoryName) {
                if (!subcategoryName) return [key];

                if (category.children) {
                    for (const [subKey, subcategory] of Object.entries(category.children)) {
                        if (subcategory.name === subcategoryName) {
                            return [key, subKey];
                        }

                        if (subcategory.children) {
                            for (const [subSubKey, subSubcategory] of Object.entries(subcategory.children)) {
                                if (subSubcategory.name === subcategoryName) {
                                    return [key, subKey, subSubKey];
                                }
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    renderTransactions() {
        const tbody = document.getElementById('transactions-tbody');
        tbody.innerHTML = '';

        // 获取筛选条件
        const categoryFilter = document.getElementById('category-filter')?.value || '';
        const dateFrom = document.getElementById('date-from')?.value;
        const dateTo = document.getElementById('date-to')?.value;

        // 应用筛选
        let filteredTransactions = this.data.transactions;

        if (categoryFilter) {
            filteredTransactions = filteredTransactions.filter(t => t.category === categoryFilter);
        }

        if (dateFrom) {
            filteredTransactions = filteredTransactions.filter(t => {
                const transactionDate = t.date.includes('T') ? t.date.split('T')[0] : t.date;
                return transactionDate >= dateFrom;
            });
        }

        if (dateTo) {
            filteredTransactions = filteredTransactions.filter(t => {
                const transactionDate = t.date.includes('T') ? t.date.split('T')[0] : t.date;
                return transactionDate <= dateTo;
            });
        }

        // 按日期排序（最新在前）
        const sortedTransactions = [...filteredTransactions].sort((a, b) => {
            const dateA = a.date.includes('T') ? a.date : a.date + 'T00:00:00';
            const dateB = b.date.includes('T') ? b.date : b.date + 'T00:00:00';
            return new Date(dateB) - new Date(dateA);
        });

        sortedTransactions.forEach(transaction => {
            const row = document.createElement('tr');

            // 格式化日期和时间显示
            let dateDisplay;
            if (transaction.includeTime && transaction.date.includes('T')) {
                const dateTime = new Date(transaction.date);
                dateDisplay = dateTime.toLocaleString();
            } else {
                const dateOnly = transaction.date.includes('T') ? transaction.date.split('T')[0] : transaction.date;
                dateDisplay = new Date(dateOnly).toLocaleDateString();
            }

            row.innerHTML = `
                <td>${dateDisplay}</td>
                <td>${transaction.category}</td>
                <td>${transaction.subcategory || '-'}</td>
                <td class="${transaction.amount >= 0 ? 'positive' : 'negative'}">
                    ${this.formatCurrency(transaction.amount, transaction.currency || this.data.settings.baseCurrency)}
                </td>
                <td>${transaction.type}</td>
                <td>${transaction.purpose || '-'}</td>
                <td>${transaction.description}</td>
                <td>
                    <button class="btn btn-sm" onclick="window.assetTracker.editTransaction('${transaction.id}')">编辑</button>
                    <button class="btn btn-sm" onclick="window.assetTracker.deleteTransaction('${transaction.id}')">删除</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        this.updateRecentTransactions();
    }

    updateRecentTransactions() {
        const container = document.getElementById('recent-transactions-list');
        const recentTransactions = this.data.transactions.slice(-5).reverse();

        if (recentTransactions.length === 0) {
            container.innerHTML = '<p class="empty-state">暂无交易记录</p>';
            return;
        }

        container.innerHTML = recentTransactions.map(transaction => `
            <div class="transaction-item">
                <div class="transaction-info">
                    <div class="transaction-category">${transaction.category}</div>
                    <div class="transaction-description">${transaction.description}</div>
                </div>
                <div class="transaction-amount ${transaction.amount >= 0 ? 'positive' : 'negative'}">
                    ¥${transaction.amount.toFixed(2)}
                </div>
            </div>
        `).join('');
    }

    // 仪表板更新
    updateDashboard() {
        const totals = this.calculateTotals();
        const baseCurrency = this.data.settings.baseCurrency;

        // 更新显示值
        document.querySelector('.total-assets').textContent = `${this.formatCurrency(totals.totalAssets, baseCurrency)}`;
        document.querySelector('.digital-assets').textContent = `${this.formatCurrency(totals.digital, baseCurrency)}`;
        document.querySelector('.cash-assets').textContent = `${this.formatCurrency(totals.cash, baseCurrency)}`;
        document.querySelector('.debt-assets').textContent = `${this.formatCurrency(totals.totalDebt, baseCurrency)}`;

        // 更新现余额显示
        const currentBalanceElement = document.querySelector('.current-balance');
        if (currentBalanceElement) {
            currentBalanceElement.textContent = `${this.formatCurrency(totals.currentBalance, baseCurrency)}`;
        }

        // 悬停功能已移除，改为点击查看详情

        this.updateAssetPieChart();
        this.updateAssetTrendChart();
    }

    // 汇率转换功能
    convertToBaseCurrency(amount, fromCurrency) {
        if (!fromCurrency || fromCurrency === this.data.settings.baseCurrency) {
            return amount;
        }

        const rate = this.data.settings.exchangeRates[fromCurrency];

        if (!rate) {
            console.warn(`Exchange rate not found for ${fromCurrency}`);
            return amount;
        }

        // 汇率表示 1 外币 = rate 基准币
        // 所以外币金额 * 汇率 = 基准币金额
        return amount * rate;
    }

    // 从基准货币转换到目标货币
    convertFromBaseCurrency(baseCurrencyAmount, toCurrency) {
        if (!toCurrency || toCurrency === this.data.settings.baseCurrency) {
            return baseCurrencyAmount;
        }

        const rate = this.data.settings.exchangeRates[toCurrency];

        if (!rate) {
            console.warn(`Exchange rate not found for ${toCurrency}`);
            return baseCurrencyAmount;
        }

        // 汇率表示 1 外币 = rate 基准币
        // 所以基准币金额 / 汇率 = 外币金额
        return baseCurrencyAmount / rate;
    }

    // 格式化货币显示
    formatCurrency(amount, currency = null, compact = false) {
        const curr = currency || this.data.settings.baseCurrency;
        const symbols = {
            'CNY': '¥',
            'SGD': 'S$',
            'USD': '$',
            'MYR': 'RM'
        };

        if (compact) {
            // 紧凑格式：大于1万的数字用K表示，大于100万的用M表示
            const absAmount = Math.abs(amount);
            if (absAmount >= 1000000) {
                return `${symbols[curr] || curr}${(amount / 1000000).toFixed(1)}M`;
            } else if (absAmount >= 10000) {
                return `${symbols[curr] || curr}${(amount / 1000).toFixed(1)}K`;
            } else {
                return `${symbols[curr] || curr}${amount.toFixed(0)}`;
            }
        }

        return `${symbols[curr] || curr}${amount.toFixed(2)}`;
    }

    // 自动备份功能
    setupAutoBackup() {
        if (!this.data.settings.autoBackup) return;

        const lastBackup = localStorage.getItem('lastBackupTime');
        const now = new Date().getTime();
        const backupInterval = this.data.settings.backupInterval * 60 * 60 * 1000; // 转换为毫秒

        if (!lastBackup || (now - parseInt(lastBackup)) > backupInterval) {
            this.performAutoBackup();
        }

        // 设置定期备份
        setInterval(() => {
            if (this.data.settings.autoBackup) {
                this.performAutoBackup();
            }
        }, backupInterval);
    }

    performAutoBackup() {
        const backupData = {
            timestamp: new Date().toISOString(),
            data: this.data
        };

        localStorage.setItem('assetTrackerBackup', JSON.stringify(backupData));
        localStorage.setItem('lastBackupTime', new Date().getTime().toString());

        console.log('自动备份完成:', new Date().toLocaleString());
    }

    // 反算历史资产状况
    calculateHistoricalAssets() {
        if (this.data.transactions.length === 0) {
            this.showMessage('没有交易记录，无法反算历史资产状况', 'error');
            return;
        }

        // 按时间排序交易记录
        const sortedTransactions = [...this.data.transactions].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateA - dateB;
        });

        const earliestDate = new Date(sortedTransactions[0].date);
        const latestDate = new Date(sortedTransactions[sortedTransactions.length - 1].date);

        // 获取当前各分类余额
        const currentBalances = {};
        this.collectLeafBalances(this.data.categories, currentBalances);

        // 反向计算：从当前余额减去所有历史交易
        const historicalBalances = { ...currentBalances };

        // 按时间倒序处理交易，从当前状态往回推算
        for (let i = sortedTransactions.length - 1; i >= 0; i--) {
            const transaction = sortedTransactions[i];
            const categoryPath = this.findCategoryPath(transaction.category, transaction.subcategory);

            if (categoryPath) {
                // 找到对应的叶子分类
                const leafCategoryId = this.getLeafCategoryId(categoryPath);
                if (leafCategoryId && historicalBalances[leafCategoryId] !== undefined) {
                    // 反向操作：减去这笔交易的影响
                    historicalBalances[leafCategoryId] -= transaction.amount;
                }
            }
        }

        // 计算历史资产汇总
        let historicalTotalAssets = 0;
        let historicalCurrentBalance = 0;
        let historicalTotalDebt = 0;

        Object.entries(historicalBalances).forEach(([categoryId, balance]) => {
            const category = this.findCategoryById(categoryId);
            if (category) {
                const balanceInBaseCurrency = this.convertToBaseCurrency(balance, category.currency);

                if (category.isDebt) {
                    historicalTotalDebt += Math.abs(balanceInBaseCurrency);
                } else {
                    historicalCurrentBalance += balanceInBaseCurrency;
                }
                historicalTotalAssets += Math.abs(balanceInBaseCurrency);
            }
        });

        // 显示结果
        this.displayHistoricalResult({
            earliestDate,
            latestDate,
            historicalTotalAssets,
            historicalCurrentBalance: historicalTotalAssets - historicalTotalDebt,
            historicalTotalDebt,
            currentTotals: this.calculateTotals(),
            transactionCount: sortedTransactions.length
        });
    }

    // 收集叶子分类的当前余额
    collectLeafBalances(categories, balances, prefix = '') {
        Object.values(categories).forEach(category => {
            if (!category.children || Object.keys(category.children).length === 0) {
                // 叶子节点
                balances[category.id] = category.balance;
            } else {
                // 递归处理子分类
                this.collectLeafBalances(category.children, balances, prefix + category.name + '-');
            }
        });
    }

    // 获取叶子分类ID
    getLeafCategoryId(categoryPath) {
        let current = this.data.categories;
        let categoryId = null;

        for (const pathPart of categoryPath) {
            current = current[pathPart];
            if (!current) return null;

            categoryId = current.id;

            if (current.children) {
                current = current.children;
            }
        }

        return categoryId;
    }

    // 显示历史资产分析结果
    displayHistoricalResult(result) {
        const resultContainer = document.getElementById('history-result');

        const totalChange = result.currentTotals.totalAssets - result.historicalTotalAssets;
        const balanceChange = result.currentTotals.currentBalance - result.historicalCurrentBalance;
        const debtChange = result.currentTotals.totalDebt - result.historicalTotalDebt;

        resultContainer.innerHTML = `
            <div class="history-analysis-result">
                <h4>历史资产分析结果</h4>
                <div class="analysis-period">
                    <strong>分析期间：</strong>${result.earliestDate.toLocaleDateString()} 至 ${result.latestDate.toLocaleDateString()}
                    （共 ${result.transactionCount} 笔交易）
                </div>

                <div class="comparison-table">
                    <table>
                        <thead>
                            <tr>
                                <th>项目</th>
                                <th>最早时点</th>
                                <th>当前时点</th>
                                <th>变化金额</th>
                                <th>变化率</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>总资产</td>
                                <td>${this.formatCurrency(result.historicalTotalAssets)}</td>
                                <td>${this.formatCurrency(result.currentTotals.totalAssets)}</td>
                                <td class="${totalChange >= 0 ? 'positive' : 'negative'}">${this.formatCurrency(totalChange)}</td>
                                <td class="${totalChange >= 0 ? 'positive' : 'negative'}">
                                    ${result.historicalTotalAssets > 0 ? ((totalChange / result.historicalTotalAssets) * 100).toFixed(1) + '%' : 'N/A'}
                                </td>
                            </tr>
                            <tr>
                                <td>现余额</td>
                                <td>${this.formatCurrency(result.historicalCurrentBalance)}</td>
                                <td>${this.formatCurrency(result.currentTotals.currentBalance)}</td>
                                <td class="${balanceChange >= 0 ? 'positive' : 'negative'}">${this.formatCurrency(balanceChange)}</td>
                                <td class="${balanceChange >= 0 ? 'positive' : 'negative'}">
                                    ${result.historicalCurrentBalance > 0 ? ((balanceChange / result.historicalCurrentBalance) * 100).toFixed(1) + '%' : 'N/A'}
                                </td>
                            </tr>
                            <tr>
                                <td>待还款</td>
                                <td>${this.formatCurrency(result.historicalTotalDebt)}</td>
                                <td>${this.formatCurrency(result.currentTotals.totalDebt)}</td>
                                <td class="${debtChange <= 0 ? 'positive' : 'negative'}">${this.formatCurrency(debtChange)}</td>
                                <td class="${debtChange <= 0 ? 'positive' : 'negative'}">
                                    ${result.historicalTotalDebt > 0 ? ((debtChange / result.historicalTotalDebt) * 100).toFixed(1) + '%' : 'N/A'}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="analysis-insights">
                    <h5>分析洞察：</h5>
                    <ul>
                        <li>在 ${((result.latestDate - result.earliestDate) / (1000 * 60 * 60 * 24)).toFixed(0)} 天内，您的资产${totalChange >= 0 ? '增长' : '减少'}了 ${this.formatCurrency(Math.abs(totalChange))}</li>
                        <li>平均每天资产${totalChange >= 0 ? '增长' : '减少'} ${this.formatCurrency(Math.abs(totalChange / ((result.latestDate - result.earliestDate) / (1000 * 60 * 60 * 24))))}</li>
                        <li>${debtChange > 0 ? '债务增加了' : '债务减少了'} ${this.formatCurrency(Math.abs(debtChange))}</li>
                    </ul>
                </div>
            </div>
        `;

        resultContainer.style.display = 'block';
        this.showMessage('历史资产分析完成！', 'success');
    }

    calculateTotals() {
        let totalAssets = 0;  // 现总资产：所有在账上的钱
        let currentBalance = 0;  // 现余额：扣除待还的总资产
        let totalDebt = 0;  // 待还款总额
        let digital = 0;
        let cash = 0;

        const calculateCategoryTotal = (category) => {
            // 只计算叶子节点（没有子分类的分类）的余额
            if (!category.children || Object.keys(category.children).length === 0) {
                const balanceInBaseCurrency = this.convertToBaseCurrency(category.balance, category.currency);

                // 计算现总资产（不区分是否为债务）
                totalAssets += Math.abs(balanceInBaseCurrency);

                // 区分资产和债务
                if (category.isDebt) {
                    totalDebt += Math.abs(balanceInBaseCurrency);
                } else {
                    currentBalance += balanceInBaseCurrency;

                    // 分类资产类型
                    if (category.id && category.id.includes('cash')) {
                        cash += balanceInBaseCurrency;
                    } else {
                        digital += balanceInBaseCurrency;
                    }
                }
            }

            // 递归处理子分类
            if (category.children) {
                Object.values(category.children).forEach(calculateCategoryTotal);
            }
        };

        Object.values(this.data.categories).forEach(calculateCategoryTotal);

        // 根据新规则：总资产 = 现余额 - 待还款（即：现余额 = 总正资产）
        const realTotalAssets = currentBalance + totalDebt;  // 这是真正的"现总资产"
        const realCurrentBalance = currentBalance;           // 这是"现余额"

        return {
            totalAssets: realTotalAssets,    // 现总资产 = 现余额 + 待还
            currentBalance: realCurrentBalance, // 现余额 = 所有正资产
            totalDebt,                       // 待还款
            digital,
            cash
        };
    }

    // 图表设置
    setupCharts() {
        this.updateAssetPieChart();
        this.updateAssetTrendChart();
    }

    updateAssetPieChart() {
        const ctx = document.getElementById('assetPieChart').getContext('2d');

        if (this.charts.assetPie) {
            this.charts.assetPie.destroy();
        }

        const level = document.getElementById('pie-chart-level')?.value || 'all';
        const categoryData = this.getPieChartData(level);

        this.charts.assetPie = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: categoryData.map(item => item.label),
                datasets: [{
                    data: categoryData.map(item => item.value),
                    backgroundColor: [
                        '#667eea', '#764ba2', '#f093fb', '#f5576c',
                        '#4facfe', '#00f2fe', '#43e97b', '#38f9d7',
                        '#ff9a9e', '#fecfef', '#ffecd2', '#fcb69f'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${assetTracker.formatCurrency(value)} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // 根据层级获取饼图数据
    getPieChartData(level) {
        const data = [];

        switch (level) {
            case 'top':
                // 只显示顶级分类
                Object.values(this.data.categories).forEach(category => {
                    const totalBalance = this.calculateCategoryTotalBalance(category);
                    if (totalBalance > 0) {
                        data.push({
                            label: category.name,
                            value: totalBalance
                        });
                    }
                });
                break;

            case 'leaf':
                // 只显示最底层分类
                this.collectLeafCategories(this.data.categories, data);
                break;

            case 'all':
            default:
                // 显示所有有余额的分类
                this.collectAllCategories(this.data.categories, data, '');
                break;
        }

        return data.filter(item => item.value > 0);
    }

    // 计算分类总余额（包括子分类）
    calculateCategoryTotalBalance(category) {
        let total = 0;

        if (!category.children || Object.keys(category.children).length === 0) {
            // 叶子节点，直接返回余额
            return this.convertToBaseCurrency(category.balance, category.currency);
        } else {
            // 非叶子节点，递归计算子分类总和
            Object.values(category.children).forEach(child => {
                total += this.calculateCategoryTotalBalance(child);
            });
        }

        return total;
    }

    // 收集最底层分类
    collectLeafCategories(categories, data, prefix = '') {
        Object.values(categories).forEach(category => {
            const displayName = prefix ? `${prefix} - ${category.name}` : category.name;

            if (!category.children || Object.keys(category.children).length === 0) {
                // 这是叶子节点
                const balance = this.convertToBaseCurrency(category.balance, category.currency);
                if (balance > 0) {
                    data.push({
                        label: displayName,
                        value: balance
                    });
                }
            } else {
                // 继续递归
                this.collectLeafCategories(category.children, data, displayName);
            }
        });
    }

    // 收集所有分类
    collectAllCategories(categories, data, prefix = '') {
        Object.values(categories).forEach(category => {
            const displayName = prefix ? `${prefix} - ${category.name}` : category.name;
            const balance = this.convertToBaseCurrency(category.balance, category.currency);

            if (balance > 0) {
                data.push({
                    label: displayName,
                    value: balance
                });
            }

            if (category.children) {
                this.collectAllCategories(category.children, data, displayName);
            }
        });
    }

    updateAssetTrendChart() {
        const ctx = document.getElementById('assetTrendChart').getContext('2d');

        if (this.charts.assetTrend) {
            this.charts.assetTrend.destroy();
        }

        // 计算每日资产总额
        const dailyTotals = this.calculateDailyTotals();

        this.charts.assetTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dailyTotals.labels,
                datasets: [
                    {
                        label: '总资产',
                        data: dailyTotals.totalAssets,
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        fill: false,
                        tension: 0.4
                    },
                    {
                        label: '现余额',
                        data: dailyTotals.currentBalance,
                        borderColor: '#52c41a',
                        backgroundColor: 'rgba(82, 196, 26, 0.1)',
                        fill: false,
                        tension: 0.4
                    },
                    {
                        label: '债务',
                        data: dailyTotals.totalDebt,
                        borderColor: '#ff4d4f',
                        backgroundColor: 'rgba(255, 77, 79, 0.1)',
                        fill: false,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    zoom: {
                        zoom: {
                            wheel: {
                                enabled: true,
                            },
                            pinch: {
                                enabled: true
                            },
                            mode: 'x',
                        },
                        pan: {
                            enabled: true,
                            mode: 'x',
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toFixed(0);
                            }
                        }
                    },
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: '日期'
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    }

    calculateDailyTotals() {
        // 获取时间范围设置
        const timeRangeSelect = document.getElementById('trend-time-range');
        const timeRange = timeRangeSelect ? timeRangeSelect.value : '30';

        // 确定起始和结束日期
        let startDate, endDate = new Date();
        endDate.setHours(23, 59, 59, 999);

        if (timeRange === 'all') {
            // 使用最早交易记录的日期作为起点
            if (this.data.transactions.length === 0) {
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
            } else {
                const earliestTransaction = this.data.transactions.reduce((earliest, current) => {
                    const currentDate = current.date.includes('T') ? current.date.split('T')[0] : current.date;
                    const earliestDate = earliest.date.includes('T') ? earliest.date.split('T')[0] : earliest.date;
                    return new Date(currentDate) < new Date(earliestDate) ? current : earliest;
                });
                const dateOnly = earliestTransaction.date.includes('T') ? earliestTransaction.date.split('T')[0] : earliestTransaction.date;
                startDate = new Date(dateOnly);
                startDate.setHours(0, 0, 0, 0);
            }
        } else {
            const days = parseInt(timeRange);
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days + 1);
            startDate.setHours(0, 0, 0, 0);
        }

        // 生成日期数组
        const dateArray = [];
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            dateArray.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // 生成标签
        const labels = dateArray.map(date => {
            if (dateArray.length > 90) {
                // 如果时间跨度大于90天，显示月/日格式
                return `${date.getMonth() + 1}/${date.getDate()}`;
            } else {
                // 否则显示月/日格式
                return `${date.getMonth() + 1}/${date.getDate()}`;
            }
        });

        // 初始化数据数组
        const totalAssets = [];
        const currentBalance = [];
        const totalDebt = [];

        // 为每一天计算累积资产状况
        dateArray.forEach(date => {
            // 获取到该日期为止的所有交易
            const transactionsUpToDate = this.data.transactions.filter(t => {
                const transactionDateStr = t.date.includes('T') ? t.date.split('T')[0] : t.date;
                const transactionDate = new Date(transactionDateStr);
                const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                return transactionDate <= targetDate;
            });

            // 基于交易记录重建当日的资产状况
            const dailyBalances = this.calculateDailyAssetBalance(transactionsUpToDate);

            totalAssets.push(dailyBalances.totalAssets);
            currentBalance.push(dailyBalances.currentBalance);
            totalDebt.push(dailyBalances.totalDebt);
        });

        return {
            labels,
            totalAssets,
            currentBalance,
            totalDebt
        };
    }

    calculateDailyAssetBalance(transactionsUpToDate) {
        // 从当前余额开始，然后减去不在范围内的交易
        const tempBalances = JSON.parse(JSON.stringify(this.data.categories));

        // 获取所有不在范围内的交易（即需要减去的交易）
        const transactionsToSubtract = this.data.transactions.filter(t =>
            !transactionsUpToDate.find(included => included.id === t.id)
        );

        // 从当前余额减去不在范围内的交易
        transactionsToSubtract.forEach(transaction => {
            this.subtractTransactionFromBalance(tempBalances, transaction);
        });

        // 计算总额
        let totalAssets = 0;
        let currentBalance = 0;
        let totalDebt = 0;

        this.traverseCategories(tempBalances, (category) => {
            if (!category.children || Object.keys(category.children).length === 0) {
                // 叶子节点，转换货币并累加
                const balanceInBaseCurrency = this.convertToBaseCurrency(category.balance, category.currency);
                totalAssets += Math.abs(balanceInBaseCurrency);

                if (category.isDebt) {
                    totalDebt += Math.abs(balanceInBaseCurrency);
                } else {
                    currentBalance += balanceInBaseCurrency;
                }
            }
        });

        return { totalAssets, currentBalance, totalDebt };
    }

    resetCategoryBalances(categories) {
        this.traverseCategories(categories, (category) => {
            category.balance = 0;
        });
    }

    subtractTransactionFromBalance(categories, transaction) {
        // 找到对应的分类
        let targetCategory = null;

        // 首先找到主分类
        const mainCategory = Object.values(categories).find(cat => cat.name === transaction.category);
        if (!mainCategory) return;

        if (transaction.subcategory) {
            // 找子分类
            targetCategory = this.findSubcategoryByName(mainCategory, transaction.subcategory);
        } else {
            targetCategory = mainCategory;
        }

        if (targetCategory) {
            // 从余额中减去交易金额（注意：减去是因为我们在逆向计算）
            // 交易金额需要根据汇率转换到分类的货币
            let amountToSubtract = transaction.amount;
            const transactionCurrency = transaction.currency || 'CNY';
            const categoryCurrency = targetCategory.currency || 'CNY';

            if (transactionCurrency !== categoryCurrency) {
                // 先转换到基础货币，再转换到目标货币
                const baseCurrencyAmount = this.convertToBaseCurrency(transaction.amount, transactionCurrency);
                amountToSubtract = this.convertFromBaseCurrency(baseCurrencyAmount, categoryCurrency);
            }

            targetCategory.balance -= amountToSubtract;
        }
    }

    findSubcategoryByName(parentCategory, subcategoryName) {
        if (!parentCategory.children) return null;

        // 递归搜索子分类
        for (const child of Object.values(parentCategory.children)) {
            if (child.name === subcategoryName) {
                return child;
            }
            if (child.children) {
                const found = this.findSubcategoryByName(child, subcategoryName);
                if (found) return found;
            }
        }
        return null;
    }

    traverseCategories(categories, callback) {
        const traverse = (cats) => {
            Object.values(cats).forEach(category => {
                callback(category);
                if (category.children) {
                    traverse(category.children);
                }
            });
        };
        traverse(categories);
    }

    // Zoom 功能
    zoomIn() {
        if (this.charts.assetTrend) {
            this.charts.assetTrend.zoom(1.1);
        }
    }

    zoomOut() {
        if (this.charts.assetTrend) {
            this.charts.assetTrend.zoom(0.9);
        }
    }

    // 模态框管理
    showTransactionModal() {
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h3>添加账单</h3>
            <div class="form-group">
                <label>常用模板</label>
                <div class="template-buttons">
                    ${this.renderTransactionTemplates()}
                    <button type="button" class="btn btn-sm btn-secondary" onclick="window.assetTracker.showSaveTemplateForm()">保存为模板</button>
                </div>
            </div>
            <form id="transaction-form">
                <div class="form-group">
                    <label>日期</label>
                    <input type="date" id="transaction-date" value="${new Date().toISOString().split('T')[0]}" required>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="include-time"> 包含具体时间
                    </label>
                </div>
                <div class="form-group time-group" style="display: none;">
                    <label>时间</label>
                    <input type="time" id="transaction-time" value="${new Date().toTimeString().slice(0,5)}">
                </div>
                <div class="form-group">
                    <label>类别</label>
                    <select id="transaction-category" required>
                        <option value="">请选择类别</option>
                        ${Object.values(this.data.categories).map(cat =>
                            `<option value="${cat.name}">${cat.name}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>子类别</label>
                    <select id="transaction-subcategory">
                        <option value="">请选择子类别</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>金额</label>
                    <div class="amount-input-group">
                        <input type="number" id="transaction-amount" step="0.01" required>
                        <select id="transaction-currency" class="currency-selector">
                            <option value="CNY">CNY ¥</option>
                            <option value="SGD">SGD S$</option>
                            <option value="USD">USD $</option>
                            <option value="MYR">MYR RM</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>类型</label>
                    <select id="transaction-type" required>
                        <option value="单次">单次</option>
                        <option value="月会员">月会员</option>
                        <option value="日循环">日循环</option>
                        <option value="自定义周期">自定义周期</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>用途分类</label>
                    <select id="transaction-purpose" required>
                        <option value="">请选择用途</option>
                        ${this.data.purposeCategories.map(purpose =>
                            `<option value="${purpose}">${purpose}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <textarea id="transaction-description" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <button type="submit" class="btn btn-primary">添加账单</button>
                </div>
            </form>
        `;

        // 分类联动
        document.getElementById('transaction-category').addEventListener('change', (e) => {
            this.updateSubcategoryOptions(e.target.value);
        });

        // 时间选项控制
        document.getElementById('include-time').addEventListener('change', (e) => {
            const timeGroup = document.querySelector('.time-group');
            timeGroup.style.display = e.target.checked ? 'block' : 'none';
        });

        // 表单提交
        document.getElementById('transaction-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitTransaction();
        });

        this.showModal();
    }

    updateSubcategoryOptions(categoryName) {
        const subcategorySelect = document.getElementById('transaction-subcategory');
        subcategorySelect.innerHTML = '<option value="">请选择子类别</option>';

        const category = Object.values(this.data.categories).find(cat => cat.name === categoryName);
        if (category && category.children) {
            this.addLeafCategories(category.children, subcategorySelect, '');
        }
    }

    // 递归添加叶子节点分类（只有最底层的分类）
    addLeafCategories(categories, selectElement, prefix) {
        Object.values(categories).forEach(subcategory => {
            const displayName = prefix ? `${prefix} - ${subcategory.name}` : subcategory.name;

            if (!subcategory.children || Object.keys(subcategory.children).length === 0) {
                // 这是叶子节点，添加到选择框
                const option = document.createElement('option');
                option.value = subcategory.name;
                option.textContent = displayName;
                selectElement.appendChild(option);
            } else {
                // 这不是叶子节点，继续递归
                this.addLeafCategories(subcategory.children, selectElement, displayName);
            }
        });
    }

    submitTransaction() {
        let dateValue = document.getElementById('transaction-date').value;
        const includeTime = document.getElementById('include-time').checked;

        if (includeTime) {
            const timeValue = document.getElementById('transaction-time').value;
            dateValue += `T${timeValue}:00`;
        }

        const transaction = {
            date: dateValue,
            category: document.getElementById('transaction-category').value,
            subcategory: document.getElementById('transaction-subcategory').value,
            amount: parseFloat(document.getElementById('transaction-amount').value),
            currency: document.getElementById('transaction-currency').value,
            type: document.getElementById('transaction-type').value,
            purpose: document.getElementById('transaction-purpose').value,
            description: document.getElementById('transaction-description').value,
            includeTime: includeTime
        };

        this.addTransaction(transaction);
        this.closeModal();
        this.showMessage('账单添加成功！', 'success');
    }

    showCategoryModal() {
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h3>添加分类</h3>
            <form id="category-form">
                <div class="form-group">
                    <label>分类名称</label>
                    <input type="text" id="category-name" required>
                </div>
                <div class="form-group">
                    <label>父分类</label>
                    <select id="parent-category">
                        <option value="">顶级分类</option>
                        ${this.generateCategoryOptions()}
                    </select>
                </div>
                <div class="form-group">
                    <label>初始余额</label>
                    <input type="number" id="category-balance" step="0.01" value="0">
                </div>
                <div class="form-group">
                    <button type="submit" class="btn btn-primary">添加分类</button>
                </div>
            </form>
        `;

        document.getElementById('category-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitCategory();
        });

        this.showModal();
    }

    generateCategoryOptions(categories = this.data.categories, prefix = '') {
        let options = '';
        Object.values(categories).forEach(category => {
            options += `<option value="${category.id}">${prefix}${category.name}</option>`;
            if (category.children) {
                options += this.generateCategoryOptions(category.children, prefix + category.name + ' - ');
            }
        });
        return options;
    }

    submitCategory() {
        const name = document.getElementById('category-name').value;
        const parentId = document.getElementById('parent-category').value;
        const balance = parseFloat(document.getElementById('category-balance').value) || 0;

        const newCategory = {
            id: Date.now().toString(),
            name: name,
            balance: balance
        };

        if (parentId) {
            const parent = this.findCategoryById(parentId);
            if (parent) {
                if (!parent.children) {
                    parent.children = {};
                }
                parent.children[newCategory.id] = newCategory;
            }
        } else {
            this.data.categories[newCategory.id] = newCategory;
        }

        this.saveData();
        this.renderCategories();
        this.closeModal();
        this.showMessage('分类添加成功！', 'success');
    }

    findCategoryById(id, categories = this.data.categories) {
        for (const category of Object.values(categories)) {
            if (category.id === id) {
                return category;
            }
            if (category.children) {
                const found = this.findCategoryById(id, category.children);
                if (found) return found;
            }
        }
        return null;
    }

    // 编辑分类名称
    editCategoryName(categoryId) {
        const category = this.findCategoryById(categoryId);
        if (!category) {
            this.showMessage('分类不存在！', 'error');
            return;
        }

        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h3>修改分类名称</h3>
            <form id="edit-category-name-form">
                <div class="form-group">
                    <label>当前名称: <strong>${category.name}</strong></label>
                </div>
                <div class="form-group">
                    <label>新名称</label>
                    <input type="text" id="new-category-name" value="${category.name}" placeholder="请输入新的分类名称" required>
                </div>
                <div class="form-group">
                    <button type="button" class="btn btn-primary" onclick="window.assetTracker.updateCategoryName('${categoryId}')">保存名称</button>
                    <button type="button" class="btn btn-secondary" onclick="window.assetTracker.closeModal()">取消</button>
                </div>
            </form>
        `;

        this.showModal();
    }

    // 更新分类名称
    updateCategoryName(categoryId) {
        const newName = document.getElementById('new-category-name').value.trim();

        if (!newName) {
            this.showMessage('分类名称不能为空！', 'error');
            return;
        }

        // 检查同级别下是否已存在相同名称
        const category = this.findCategoryById(categoryId);
        if (!category) {
            this.showMessage('分类不存在！', 'error');
            return;
        }

        const parent = this.findCategoryParent(categoryId);
        if (!parent) {
            this.showMessage('无法找到父级分类！', 'error');
            return;
        }

        // 获取同级分类容器
        const siblingsContainer = parent.children || parent;

        // 检查同级别是否有重名
        const hasConflict = Object.values(siblingsContainer).some(sibling =>
            sibling.id !== categoryId && sibling.name === newName
        );

        if (hasConflict) {
            this.showMessage('同级别下已存在相同名称的分类！', 'error');
            return;
        }

        // 更新名称
        const oldName = category.name;
        category.name = newName;

        // 如果是在对象的key中存储，需要更新key
        if (parent.children) {
            // 在子分类中
            delete parent.children[oldName];
            parent.children[newName] = category;
        } else {
            // 在顶级分类中
            delete this.data.categories[oldName];
            this.data.categories[newName] = category;
        }

        this.saveData();
        this.renderCategories();
        this.updateDashboard();
        this.closeModal();
        this.showMessage('分类名称更新成功！', 'success');
    }

    // 编辑分类
    editCategory(categoryId) {
        const category = this.findCategoryById(categoryId);
        if (!category) {
            this.showMessage('分类不存在！', 'error');
            return;
        }

        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h3>编辑分类: ${category.name}</h3>
            <form id="edit-category-form">
                <div class="form-group">
                    <label>分类名称</label>
                    <input type="text" id="edit-category-name" value="${category.name}" required>
                </div>
                <div class="form-group">
                    <label>当前余额</label>
                    <input type="number" id="edit-category-balance" step="0.01" value="${category.balance}">
                </div>
                <div class="form-group">
                    <label>币种</label>
                    <select id="edit-category-currency">
                        <option value="CNY" ${category.currency === 'CNY' ? 'selected' : ''}>人民币 (CNY)</option>
                        <option value="SGD" ${category.currency === 'SGD' ? 'selected' : ''}>新加坡元 (SGD)</option>
                        <option value="USD" ${category.currency === 'USD' ? 'selected' : ''}>美元 (USD)</option>
                        <option value="MYR" ${category.currency === 'MYR' ? 'selected' : ''}>马来西亚令吉 (MYR)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="edit-category-is-debt" ${category.isDebt ? 'checked' : ''}>
                        这是债务账户
                    </label>
                </div>
                <div class="form-group">
                    <button type="submit" class="btn btn-primary">保存修改</button>
                    <button type="button" class="btn btn-secondary" onclick="window.assetTracker.closeModal()">取消</button>
                </div>
            </form>
        `;

        document.getElementById('edit-category-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateCategory(categoryId);
        });

        this.showModal();
    }

    // 更新分类
    updateCategory(categoryId) {
        const category = this.findCategoryById(categoryId);
        if (!category) return;

        const name = document.getElementById('edit-category-name').value;
        const balance = parseFloat(document.getElementById('edit-category-balance').value) || 0;
        const currency = document.getElementById('edit-category-currency').value;
        const isDebt = document.getElementById('edit-category-is-debt').checked;

        category.name = name;
        category.balance = balance;
        category.currency = currency;
        category.isDebt = isDebt;

        this.saveData();
        this.renderCategories();
        this.updateDashboard();
        this.closeModal();
        this.showMessage('分类更新成功！', 'success');
    }

    // 删除分类
    deleteCategory(categoryId) {
        const category = this.findCategoryById(categoryId);
        if (!category) {
            this.showMessage('分类不存在！', 'error');
            return;
        }

        if (confirm(`确定要删除分类 "${category.name}" 吗？这将同时删除其所有子分类和相关交易记录。`)) {
            this.removeCategoryById(categoryId);
            this.saveData();
            this.renderCategories();
            this.updateDashboard();
            this.showMessage('分类删除成功！', 'success');
        }
    }

    // 递归删除分类
    removeCategoryById(categoryId, categories = this.data.categories) {
        for (const [key, category] of Object.entries(categories)) {
            if (category.id === categoryId) {
                delete categories[key];
                return true;
            }
            if (category.children) {
                if (this.removeCategoryById(categoryId, category.children)) {
                    return true;
                }
            }
        }
        return false;
    }

    // 显示汇率设置模态框
    showExchangeRateModal(categoryId) {
        const category = this.findCategoryById(categoryId);
        if (!category) {
            this.showMessage('分类不存在！', 'error');
            return;
        }

        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h3>设置汇率: ${category.name}</h3>
            <div class="exchange-rate-modal">
                <div class="form-group">
                    <label>当前币种: ${category.currency}</label>
                </div>
                <div class="form-group">
                    <label>相对于基准币种 ${this.data.settings.baseCurrency} 的汇率</label>
                    <div class="rate-input-group">
                        <span>1 ${category.currency} = </span>
                        <input type="number" id="exchange-rate-input" step="0.0001"
                               value="${this.data.settings.exchangeRates[category.currency] || 1}">
                        <span>${this.data.settings.baseCurrency}</span>
                    </div>
                </div>
                <div class="form-group">
                    <button class="btn btn-primary" onclick="window.assetTracker.updateExchangeRate('${category.currency}')">保存汇率</button>
                    <button class="btn btn-secondary" onclick="window.assetTracker.closeModal()">取消</button>
                </div>
            </div>
        `;

        this.showModal();
    }

    // 更新汇率
    updateExchangeRate(currency) {
        const rate = parseFloat(document.getElementById('exchange-rate-input').value);
        if (isNaN(rate) || rate <= 0) {
            this.showMessage('请输入有效的汇率！', 'error');
            return;
        }

        this.data.settings.exchangeRates[currency] = rate;
        this.saveData();
        this.renderCategories();
        this.updateDashboard();
        this.closeModal();
        this.showMessage(`${currency} 汇率更新成功！`, 'success');
    }

    // 编辑交易
    editTransaction(transactionId) {
        const transaction = this.data.transactions.find(t => t.id === transactionId);
        if (!transaction) {
            this.showMessage('交易记录不存在！', 'error');
            return;
        }

        // 获取当前交易的时间信息
        const hasTime = transaction.date && transaction.date.includes('T');
        const dateOnly = hasTime ? transaction.date.split('T')[0] : transaction.date;
        const timeOnly = hasTime ? transaction.date.split('T')[1].slice(0,5) : '';
        const currentCurrency = transaction.currency || 'CNY';

        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h3>编辑交易记录</h3>
            <div class="form-group">
                <label>常用模板</label>
                <div class="template-buttons">
                    ${this.renderTransactionTemplates('edit')}
                    <button type="button" class="btn btn-sm btn-secondary" onclick="window.assetTracker.showSaveTemplateForm('edit')">保存为模板</button>
                </div>
            </div>
            <form id="edit-transaction-form">
                <div class="form-group">
                    <label>日期</label>
                    <input type="date" id="edit-transaction-date" value="${dateOnly}" required>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="edit-include-time" ${hasTime ? 'checked' : ''}> 包含具体时间
                    </label>
                </div>
                <div class="form-group time-group" style="display: ${hasTime ? 'block' : 'none'};">
                    <label>时间</label>
                    <input type="time" id="edit-transaction-time" value="${timeOnly}">
                </div>
                <div class="form-group">
                    <label>类别</label>
                    <select id="edit-transaction-category" required>
                        <option value="">请选择类别</option>
                        ${Object.values(this.data.categories).map(cat =>
                            `<option value="${cat.name}" ${cat.name === transaction.category ? 'selected' : ''}>${cat.name}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>子类别</label>
                    <select id="edit-transaction-subcategory">
                        <option value="">请选择子类别</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>金额</label>
                    <div class="amount-input-group">
                        <input type="number" id="edit-transaction-amount" step="0.01" value="${transaction.amount}" required>
                        <select id="edit-transaction-currency" class="currency-selector">
                            <option value="CNY" ${currentCurrency === 'CNY' ? 'selected' : ''}>CNY ¥</option>
                            <option value="SGD" ${currentCurrency === 'SGD' ? 'selected' : ''}>SGD S$</option>
                            <option value="USD" ${currentCurrency === 'USD' ? 'selected' : ''}>USD $</option>
                            <option value="MYR" ${currentCurrency === 'MYR' ? 'selected' : ''}>MYR RM</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>类型</label>
                    <select id="edit-transaction-type" required>
                        <option value="单次" ${transaction.type === '单次' ? 'selected' : ''}>单次</option>
                        <option value="月会员" ${transaction.type === '月会员' ? 'selected' : ''}>月会员</option>
                        <option value="日循环" ${transaction.type === '日循环' ? 'selected' : ''}>日循环</option>
                        <option value="自定义周期" ${transaction.type === '自定义周期' ? 'selected' : ''}>自定义周期</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>用途分类</label>
                    <select id="edit-transaction-purpose" required>
                        <option value="">请选择用途</option>
                        ${this.data.purposeCategories.map(purpose =>
                            `<option value="${purpose}" ${purpose === transaction.purpose ? 'selected' : ''}>${purpose}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <textarea id="edit-transaction-description" rows="3">${transaction.description}</textarea>
                </div>
                <div class="form-group">
                    <button type="submit" class="btn btn-primary">保存修改</button>
                    <button type="button" class="btn btn-secondary" onclick="window.assetTracker.closeModal()">取消</button>
                </div>
            </form>
        `;

        // 设置子分类选项
        this.updateEditSubcategoryOptions(transaction.category, transaction.subcategory);

        // 监听分类变化
        document.getElementById('edit-transaction-category').addEventListener('change', (e) => {
            this.updateEditSubcategoryOptions(e.target.value, '');
        });

        // 监听时间选择框变化
        document.getElementById('edit-include-time').addEventListener('change', (e) => {
            const timeGroup = document.querySelector('.time-group');
            timeGroup.style.display = e.target.checked ? 'block' : 'none';
        });

        document.getElementById('edit-transaction-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateTransaction(transactionId);
        });

        this.showModal();
    }

    // 更新编辑模式下的子分类选项
    updateEditSubcategoryOptions(categoryName, selectedSubcategory) {
        const subcategorySelect = document.getElementById('edit-transaction-subcategory');
        subcategorySelect.innerHTML = '<option value="">请选择子类别</option>';

        const category = Object.values(this.data.categories).find(cat => cat.name === categoryName);
        if (category && category.children) {
            this.addLeafCategories(category.children, subcategorySelect, '');

            // 设置选中的子分类
            if (selectedSubcategory) {
                subcategorySelect.value = selectedSubcategory;
            }
        }
    }

    // 更新交易记录
    updateTransaction(transactionId) {
        const transaction = this.data.transactions.find(t => t.id === transactionId);
        if (!transaction) return;

        // 先恢复原来的分类余额
        this.updateCategoryBalance({
            category: transaction.category,
            subcategory: transaction.subcategory,
            amount: -transaction.amount,
            currency: transaction.currency || 'CNY'
        });

        // 处理日期和时间
        const includeTime = document.getElementById('edit-include-time').checked;
        let dateValue = document.getElementById('edit-transaction-date').value;

        if (includeTime) {
            const timeValue = document.getElementById('edit-transaction-time').value;
            dateValue += 'T' + timeValue;
        }

        // 更新交易信息
        transaction.date = dateValue;
        transaction.category = document.getElementById('edit-transaction-category').value;
        transaction.subcategory = document.getElementById('edit-transaction-subcategory').value;
        transaction.amount = parseFloat(document.getElementById('edit-transaction-amount').value);
        transaction.currency = document.getElementById('edit-transaction-currency').value;
        transaction.type = document.getElementById('edit-transaction-type').value;
        transaction.purpose = document.getElementById('edit-transaction-purpose').value;
        transaction.description = document.getElementById('edit-transaction-description').value;
        transaction.includeTime = includeTime;

        // 应用新的分类余额
        this.updateCategoryBalance(transaction);

        this.saveData();
        this.renderTransactions();
        this.renderCategories();
        this.updateDashboard();
        this.closeModal();
        this.showMessage('交易记录更新成功！', 'success');
    }

    // 删除交易
    deleteTransaction(transactionId) {
        const transaction = this.data.transactions.find(t => t.id === transactionId);
        if (!transaction) {
            this.showMessage('交易记录不存在！', 'error');
            return;
        }

        if (confirm(`确定要删除这条交易记录吗？\n金额：¥${transaction.amount}\n描述：${transaction.description}`)) {
            // 恢复分类余额
            this.updateCategoryBalance({
                category: transaction.category,
                subcategory: transaction.subcategory,
                amount: -transaction.amount
            });

            // 删除交易记录
            this.data.transactions = this.data.transactions.filter(t => t.id !== transactionId);

            this.saveData();
            this.renderTransactions();
            this.renderCategories();
            this.updateDashboard();
            this.showMessage('交易记录删除成功！', 'success');
        }
    }

    // 导入导出功能
    exportToExcel() {
        const workbook = XLSX.utils.book_new();

        // 交易记录工作表
        const transactionsData = this.data.transactions.map(t => ({
            '日期': t.date,
            '类别': t.category,
            '子类别': t.subcategory || '',
            '金额': t.amount,
            '货币类型': t.currency || 'CNY',
            '类型': t.type,
            '用途分类': t.purpose || '',
            '描述': t.description
        }));

        const transactionsSheet = XLSX.utils.json_to_sheet(transactionsData);
        XLSX.utils.book_append_sheet(workbook, transactionsSheet, '交易记录');

        // 分类余额工作表
        const categoriesData = this.flattenCategories();
        const categoriesSheet = XLSX.utils.json_to_sheet(categoriesData);
        XLSX.utils.book_append_sheet(workbook, categoriesSheet, '分类余额');

        // 导出文件
        XLSX.writeFile(workbook, `资产记录_${new Date().toISOString().split('T')[0]}.xlsx`);
        this.showMessage('Excel导出成功！', 'success');
    }

    flattenCategories(categories = this.data.categories, parentName = '') {
        let result = [];
        Object.values(categories).forEach(category => {
            const fullName = parentName ? `${parentName} - ${category.name}` : category.name;
            result.push({
                '分类名称': fullName,
                '余额': category.balance
            });

            if (category.children) {
                result = result.concat(this.flattenCategories(category.children, fullName));
            }
        });
        return result;
    }

    exportToJSON() {
        const dataStr = JSON.stringify(this.data, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        const url = URL.createObjectURL(dataBlob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `资产数据_${new Date().toISOString().split('T')[0]}.json`;
        link.click();

        URL.revokeObjectURL(url);
        this.showMessage('JSON导出成功！', 'success');
    }

    downloadTemplate() {
        const templateData = [
            {
                '日期': '2024-01-01',
                '类别': '支付宝',
                '子类别': '余额宝',
                '金额': 1000.00,
                '货币类型': 'CNY',
                '类型': '单次',
                '用途分类': '工资收入',
                '描述': '工资存入'
            },
            {
                '日期': '2024-01-02',
                '类别': '银行卡',
                '子类别': 'ICBC',
                '金额': -500.00,
                '货币类型': 'CNY',
                '类型': '单次',
                '用途分类': '购物消费',
                '描述': '购物消费'
            },
            {
                '日期': '2024-01-03T14:30',
                '类别': '银行卡',
                '子类别': 'DBS',
                '金额': 200.00,
                '货币类型': 'SGD',
                '类型': '单次',
                '用途分类': '投资理财',
                '描述': '新币存入'
            }
        ];

        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '导入模板');

        XLSX.writeFile(workbook, '资产记录导入模板.xlsx');
        this.showMessage('模板下载成功！', 'success');
    }

    importData() {
        const fileInput = document.getElementById('import-file');
        const file = fileInput.files[0];

        if (!file) {
            this.showMessage('请选择要导入的文件！', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const workbook = XLSX.read(e.target.result, {type: 'binary'});
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json(firstSheet);

                let importCount = 0;
                data.forEach(row => {
                    if (row['日期'] && row['类别'] && row['金额']) {
                        const transaction = {
                            date: row['日期'],
                            category: row['类别'],
                            subcategory: row['子类别'] || '',
                            amount: parseFloat(row['金额']) || 0,
                            currency: row['货币类型'] || 'CNY',
                            type: row['类型'] || '单次',
                            purpose: row['用途分类'] || '其他',
                            description: row['描述'] || '',
                            includeTime: row['日期'] && row['日期'].includes('T')
                        };
                        this.addTransaction(transaction);
                        importCount++;
                    }
                });

                this.showMessage(`成功导入 ${importCount} 条记录！`, 'success');
                fileInput.value = '';
            } catch (error) {
                this.showMessage('文件格式错误，请检查文件内容！', 'error');
            }
        };

        reader.readAsBinaryString(file);
    }

    // 工具方法
    showModal() {
        document.getElementById('modal').style.display = 'block';
    }

    closeModal() {
        document.getElementById('modal').style.display = 'none';
    }

    showMessage(text, type = 'success') {
        const message = document.createElement('div');
        message.className = `message ${type}`;
        message.textContent = text;

        document.body.appendChild(message);

        setTimeout(() => {
            message.remove();
        }, 3000);
    }

    backupData() {
        this.exportToJSON();
    }

    // 自动记账规则
    showAutomationRuleModal() {
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h3>添加自动记账规则</h3>
            <form id="automation-rule-form">
                <div class="form-group">
                    <label>规则名称</label>
                    <input type="text" id="rule-name" required>
                </div>
                <div class="form-group">
                    <label>类别</label>
                    <select id="rule-category" required>
                        ${Object.values(this.data.categories).map(cat =>
                            `<option value="${cat.name}">${cat.name}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>金额</label>
                    <input type="number" id="rule-amount" step="0.01" required>
                </div>
                <div class="form-group">
                    <label>频率</label>
                    <select id="rule-frequency" required>
                        <option value="daily">每日</option>
                        <option value="weekly">每周</option>
                        <option value="monthly">每月</option>
                        <option value="yearly">每年</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>开始日期</label>
                    <input type="date" id="rule-start-date" required>
                </div>
                <div class="form-group">
                    <label>结束日期（可选）</label>
                    <input type="date" id="rule-end-date">
                </div>
                <div class="form-group">
                    <button type="submit" class="btn btn-primary">添加规则</button>
                </div>
            </form>
        `;

        document.getElementById('automation-rule-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitAutomationRule();
        });

        this.showModal();
    }

    submitAutomationRule() {
        const rule = {
            id: Date.now().toString(),
            name: document.getElementById('rule-name').value,
            category: document.getElementById('rule-category').value,
            amount: parseFloat(document.getElementById('rule-amount').value),
            frequency: document.getElementById('rule-frequency').value,
            startDate: document.getElementById('rule-start-date').value,
            endDate: document.getElementById('rule-end-date').value,
            lastExecuted: null,
            active: true
        };

        this.data.automationRules.push(rule);
        this.saveData();
        this.renderAutomationRules();
        this.closeModal();
        this.showMessage('自动记账规则添加成功！', 'success');
    }

    renderAutomationRules() {
        const container = document.getElementById('automation-rules');
        if (this.data.automationRules.length === 0) {
            container.innerHTML = '<p class="empty-state">暂无自动记账规则</p>';
            return;
        }

        container.innerHTML = this.data.automationRules.map(rule => `
            <div class="rule-item">
                <div class="rule-header">
                    <span class="rule-name">${rule.name}</span>
                    <span class="rule-frequency">${this.getFrequencyText(rule.frequency)}</span>
                </div>
                <div class="rule-details">
                    类别: ${rule.category} | 金额: ¥${rule.amount} |
                    ${rule.startDate} ${rule.endDate ? `至 ${rule.endDate}` : ''}
                </div>
                <div class="rule-actions">
                    <button class="btn btn-sm" onclick="window.assetTracker.toggleRule('${rule.id}')">
                        ${rule.active ? '暂停' : '启用'}
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="window.assetTracker.fillToToday('${rule.id}')">补齐到今天</button>
                    <button class="btn btn-sm" onclick="window.assetTracker.deleteRule('${rule.id}')">删除</button>
                </div>
            </div>
        `).join('');
    }

    getFrequencyText(frequency) {
        const map = {
            'daily': '每日',
            'weekly': '每周',
            'monthly': '每月',
            'yearly': '每年'
        };
        return map[frequency] || frequency;
    }

    // 补齐到今天功能
    fillToToday(ruleId) {
        const rule = this.data.automationRules.find(r => r.id === ruleId);
        if (!rule || !rule.active) {
            this.showMessage('规则不存在或已禁用！', 'error');
            return;
        }

        const startDate = new Date(rule.startDate);
        const today = new Date();
        const endDate = rule.endDate ? new Date(rule.endDate) : today;

        const actualEndDate = endDate > today ? today : endDate;

        if (startDate > today) {
            this.showMessage('开始日期晚于今天，无需补齐！', 'error');
            return;
        }

        const missingTransactions = this.getMissingTransactions(rule, startDate, actualEndDate);

        if (missingTransactions.length === 0) {
            this.showMessage('已无需补齐的交易！', 'success');
            return;
        }

        // 批量添加缺失的交易
        missingTransactions.forEach(transaction => {
            this.addTransaction(transaction);
        });

        // 更新最后执行时间
        rule.lastExecuted = actualEndDate.toISOString();
        this.saveData();

        this.showMessage(`成功补齐 ${missingTransactions.length} 条交易记录！`, 'success');
    }

    getMissingTransactions(rule, startDate, endDate) {
        const transactions = [];
        const current = new Date(startDate);

        while (current <= endDate) {
            const dateStr = current.toISOString().split('T')[0];

            // 检查这个日期是否已有对应的交易记录
            const existingTransaction = this.data.transactions.find(t =>
                t.date === dateStr &&
                t.category === rule.category &&
                t.description.includes(`[${rule.name}]`)
            );

            if (!existingTransaction) {
                transactions.push({
                    date: dateStr,
                    category: rule.category,
                    subcategory: rule.subcategory || '',
                    amount: rule.amount,
                    type: `自动${this.getFrequencyText(rule.frequency)}`,
                    description: `[${rule.name}] 自动记账规则补齐`
                });
            }

            // 根据频率递增日期
            this.incrementDate(current, rule.frequency);
        }

        return transactions;
    }

    incrementDate(date, frequency) {
        switch (frequency) {
            case 'daily':
                date.setDate(date.getDate() + 1);
                break;
            case 'weekly':
                date.setDate(date.getDate() + 7);
                break;
            case 'monthly':
                date.setMonth(date.getMonth() + 1);
                break;
            case 'yearly':
                date.setFullYear(date.getFullYear() + 1);
                break;
        }
    }

    // 数据分析功能
    updateAnalyticsOptions() {
        const categorySelect = document.getElementById('chart-categories');
        categorySelect.innerHTML = '';

        Object.values(this.data.categories).forEach(category => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = category.name;
            categorySelect.appendChild(option);
        });
    }

    generateCustomChart() {
        const chartType = document.getElementById('chart-type').value;
        const selectedCategories = Array.from(document.getElementById('chart-categories').selectedOptions)
            .map(option => option.value);
        const timeRange = parseInt(document.getElementById('time-range').value);

        if (selectedCategories.length === 0) {
            this.showMessage('请至少选择一个分类！', 'error');
            return;
        }

        const ctx = document.getElementById('customChart').getContext('2d');

        if (this.charts.custom) {
            this.charts.custom.destroy();
        }

        const chartData = this.prepareChartData(selectedCategories, timeRange);

        this.charts.custom = new Chart(ctx, {
            type: chartType,
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `${selectedCategories.join(', ')} - 最近${timeRange}天`
                    }
                },
                scales: chartType !== 'pie' ? {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toFixed(0);
                            }
                        }
                    }
                } : {}
            }
        });

        this.generatePredictionChart(selectedCategories);
    }

    prepareChartData(categories, timeRange) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - timeRange);

        const labels = [];
        const datasets = [];

        // 生成日期标签
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
        }

        // 为每个分类生成数据
        categories.forEach((categoryName, index) => {
            const categoryData = labels.map(() => Math.random() * 1000); // 模拟数据

            datasets.push({
                label: categoryName,
                data: categoryData,
                borderColor: this.getChartColor(index),
                backgroundColor: this.getChartColor(index, 0.1),
                fill: false
            });
        });

        return { labels, datasets };
    }

    getChartColor(index, alpha = 1) {
        const colors = [
            '#667eea', '#764ba2', '#f093fb', '#f5576c',
            '#4facfe', '#00f2fe', '#43e97b', '#38f9d7'
        ];
        const color = colors[index % colors.length];

        if (alpha < 1) {
            const rgb = this.hexToRgb(color);
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        }

        return color;
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    generatePredictionChart(categories, hypotheses = {}) {
        const ctx = document.getElementById('predictionChart').getContext('2d');

        if (this.charts.prediction) {
            this.charts.prediction.destroy();
        }

        // 生成历史30天 + 未来30天数据
        const allLabels = [];
        const today = new Date();

        // 历史30天
        for (let i = 29; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            allLabels.push(`${date.getMonth() + 1}/${date.getDate()}`);
        }

        // 未来30天
        for (let i = 1; i <= 30; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() + i);
            allLabels.push(`${date.getMonth() + 1}/${date.getDate()}`);
        }

        const datasets = [];

        categories.forEach((categoryName, index) => {
            // 获取历史数据
            const historicalData = this.getHistoricalData(categoryName, 30);

            // 计算预测数据
            const predictions = this.calculatePredictions(categoryName, historicalData, hypotheses[categoryName]);

            // 历史数据线
            datasets.push({
                label: `${categoryName} (历史)`,
                data: [...historicalData, ...Array(30).fill(null)],
                borderColor: this.getChartColor(index),
                backgroundColor: this.getChartColor(index, 0.1),
                fill: false,
                pointRadius: 2
            });

            // 预测数据线
            datasets.push({
                label: `${categoryName} (预测)`,
                data: [...Array(30).fill(null), ...predictions],
                borderColor: this.getChartColor(index),
                backgroundColor: this.getChartColor(index, 0.1),
                borderDash: [5, 5],
                fill: false,
                pointRadius: 2
            });

            // 如果有假设，添加假设情景线
            if (hypotheses[categoryName]) {
                const hypothesisData = this.calculateHypothesisScenario(
                    categoryName,
                    historicalData,
                    hypotheses[categoryName]
                );

                datasets.push({
                    label: `${categoryName} (假设: ${hypotheses[categoryName].name})`,
                    data: [...Array(30).fill(null), ...hypothesisData],
                    borderColor: this.getChartColor(index + 4),
                    backgroundColor: this.getChartColor(index + 4, 0.1),
                    borderDash: [10, 5],
                    fill: false,
                    pointRadius: 1
                });
            }
        });

        this.charts.prediction = new Chart(ctx, {
            type: 'line',
            data: {
                labels: allLabels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: '历史数据与未来预测'
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: function(context) {
                                return context.index === 30 ? '#ff0000' : '#e5e5e5';
                            },
                            lineWidth: function(context) {
                                return context.index === 30 ? 2 : 1;
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return assetTracker.formatCurrency(value);
                            }
                        }
                    }
                },
                elements: {
                    point: {
                        hoverRadius: 6
                    }
                }
            }
        });
    }

    // 获取历史数据
    getHistoricalData(categoryName, days) {
        const data = [];
        const today = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            // 计算当天该分类的交易总额
            const dayTransactions = this.data.transactions.filter(t =>
                t.date === dateStr && t.category === categoryName
            );

            const dayTotal = dayTransactions.reduce((sum, t) => sum + t.amount, 0);

            // 如果没有交易，使用前一天的数据或0
            const value = dayTotal || (data.length > 0 ? data[data.length - 1] : 0);
            data.push(Math.max(0, value));
        }

        return data;
    }

    // 计算预测数据
    calculatePredictions(categoryName, historicalData, hypothesis = null) {
        const predictions = [];
        const trend = this.calculateTrend(historicalData);
        const average = historicalData.reduce((sum, val) => sum + val, 0) / historicalData.length;

        let lastValue = historicalData[historicalData.length - 1] || average;

        for (let i = 0; i < 30; i++) {
            // 基础预测：趋势 + 随机波动
            let prediction = lastValue + trend + (Math.random() - 0.5) * average * 0.1;

            // 应用自动记账规则影响
            prediction += this.getAutomationRuleImpact(categoryName, i);

            predictions.push(Math.max(0, prediction));
            lastValue = prediction;
        }

        return predictions;
    }

    // 计算假设情景
    calculateHypothesisScenario(categoryName, historicalData, hypothesis) {
        const scenarios = [];
        const baseValue = historicalData[historicalData.length - 1] || 0;

        for (let i = 0; i < 30; i++) {
            let value = baseValue;

            switch (hypothesis.type) {
                case 'linear':
                    value += hypothesis.dailyChange * (i + 1);
                    break;
                case 'percentage':
                    value *= Math.pow(1 + hypothesis.dailyGrowthRate, i + 1);
                    break;
                case 'fixed':
                    value = hypothesis.targetValue;
                    break;
                case 'compound':
                    value = baseValue * Math.pow(1 + hypothesis.monthlyRate / 30, i + 1);
                    break;
            }

            scenarios.push(Math.max(0, value));
        }

        return scenarios;
    }

    // 计算趋势
    calculateTrend(data) {
        if (data.length < 2) return 0;

        const n = data.length;
        const xSum = (n * (n - 1)) / 2;
        const ySum = data.reduce((sum, val) => sum + val, 0);
        const xySum = data.reduce((sum, val, index) => sum + val * index, 0);
        const xSquareSum = (n * (n - 1) * (2 * n - 1)) / 6;

        return (n * xySum - xSum * ySum) / (n * xSquareSum - xSum * xSum);
    }

    // 获取自动记账规则对预测的影响
    getAutomationRuleImpact(categoryName, dayOffset) {
        let impact = 0;

        this.data.automationRules
            .filter(rule => rule.active && rule.category === categoryName)
            .forEach(rule => {
                const ruleImpact = this.calculateRuleImpactForDay(rule, dayOffset);
                impact += ruleImpact;
            });

        return impact;
    }

    calculateRuleImpactForDay(rule, dayOffset) {
        const today = new Date();
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() + dayOffset + 1);

        const startDate = new Date(rule.startDate);
        const endDate = rule.endDate ? new Date(rule.endDate) : null;

        if (targetDate < startDate || (endDate && targetDate > endDate)) {
            return 0;
        }

        // 根据频率计算是否在目标日期有影响
        const daysSinceStart = Math.floor((targetDate - startDate) / (1000 * 60 * 60 * 24));

        switch (rule.frequency) {
            case 'daily':
                return rule.amount;
            case 'weekly':
                return daysSinceStart % 7 === 0 ? rule.amount : 0;
            case 'monthly':
                return targetDate.getDate() === startDate.getDate() ? rule.amount : 0;
            case 'yearly':
                return (targetDate.getMonth() === startDate.getMonth() &&
                       targetDate.getDate() === startDate.getDate()) ? rule.amount : 0;
            default:
                return 0;
        }
    }

    // 汇率设置功能
    initializeSettings() {
        // 设置基准币种选择器的当前值
        const baseCurrencySelect = document.getElementById('base-currency');
        baseCurrencySelect.value = this.data.settings.baseCurrency;

        // 渲染汇率列表
        this.renderExchangeRatesList();
    }

    renderExchangeRatesList() {
        const container = document.getElementById('exchange-rates-list');
        const baseCurrency = document.getElementById('base-currency').value;

        // 获取所有可用的币种
        const availableCurrencies = ['CNY', 'SGD', 'USD', 'MYR'];
        const otherCurrencies = availableCurrencies.filter(curr => curr !== baseCurrency);

        container.innerHTML = otherCurrencies.map(currency => {
            const currentRate = this.data.settings.exchangeRates[currency] || 1.0;
            return `
                <div class="form-group exchange-rate-item">
                    <label>1 ${currency} = </label>
                    <input type="number"
                           id="rate-${currency}"
                           value="${currentRate}"
                           step="0.0001"
                           min="0.0001"
                           class="exchange-rate-input">
                    <span class="currency-label">${baseCurrency}</span>
                </div>
            `;
        }).join('');
    }

    saveCurrencySettings() {
        const baseCurrency = document.getElementById('base-currency').value;
        const availableCurrencies = ['CNY', 'SGD', 'USD', 'MYR'];

        // 更新基准币种
        const oldBaseCurrency = this.data.settings.baseCurrency;
        this.data.settings.baseCurrency = baseCurrency;

        // 更新汇率数据
        const newExchangeRates = { [baseCurrency]: 1.0 };

        availableCurrencies.forEach(currency => {
            if (currency !== baseCurrency) {
                const rateInput = document.getElementById(`rate-${currency}`);
                if (rateInput) {
                    const rate = parseFloat(rateInput.value);
                    if (rate > 0) {
                        newExchangeRates[currency] = rate;
                    } else {
                        this.showMessage(`${currency} 汇率必须大于0`, 'error');
                        return;
                    }
                }
            }
        });

        this.data.settings.exchangeRates = newExchangeRates;ƒ

        // 如果基准币种发生变化，需要重新计算和显示
        if (oldBaseCurrency !== baseCurrency) {
            this.convertAllBalancesToNewBaseCurrency(oldBaseCurrency, baseCurrency);
        }

        this.saveData();
        this.renderCategories();
        this.updateDashboard();
        this.showMessage('汇率设置保存成功！', 'success');
    }

    convertAllBalancesToNewBaseCurrency(oldBase, newBase) {
        // 当基准币种改变时，需要将所有以旧基准币种计价的资产转换为新基准币种
        // 这里只是一个简单的实现，实际场景可能需要更复杂的处理

        const convertCategory = (category) => {
            if (category.currency === oldBase) {
                // 将旧基准币种的资产转换为新基准币种
                const oldRate = this.data.settings.exchangeRates[oldBase] || 1.0;
                const newRate = this.data.settings.exchangeRates[newBase] || 1.0;
                category.balance = category.balance * oldRate / newRate;
                category.currency = newBase;
            }

            if (category.children) {
                Object.values(category.children).forEach(convertCategory);
            }
        };

        Object.values(this.data.categories).forEach(convertCategory);
    }

    // 独立资产初始化功能
    addInitialAsset() {
        const time = document.getElementById('init-asset-time').value;
        const categoryName = document.getElementById('init-asset-category').value;
        const subcategoryName = document.getElementById('init-asset-subcategory').value;
        const amount = parseFloat(document.getElementById('init-asset-amount').value);
        const currency = document.getElementById('init-asset-currency').value;

        if (!time || !categoryName || isNaN(amount)) {
            this.showMessage('请填写完整的初始资产信息！', 'error');
            return;
        }

        const initialAsset = {
            id: Date.now().toString(),
            time: time,
            category: categoryName,
            subcategory: subcategoryName,
            amount: amount,
            currency: currency,
            createdAt: new Date().toISOString()
        };

        // 初始化initialAssets数组（如果不存在）
        if (!this.data.initialAssets) {
            this.data.initialAssets = [];
        }

        this.data.initialAssets.push(initialAsset);
        this.saveData();
        this.renderInitialAssetsList();
        this.clearInitialAssetForm();
        this.showMessage('初始资产添加成功！', 'success');
    }

    updateInitAssetSubcategoryOptions(categoryName) {
        const subcategorySelect = document.getElementById('init-asset-subcategory');
        subcategorySelect.innerHTML = '<option value="">请选择子分类</option>';

        if (!categoryName) return;

        const category = Object.values(this.data.categories).find(cat => cat.name === categoryName);
        if (category && category.children) {
            this.addLeafCategories(category.children, subcategorySelect, '');
        }
    }

    renderInitialAssetsList() {
        const container = document.getElementById('initial-assets-list');
        if (!this.data.initialAssets || this.data.initialAssets.length === 0) {
            container.innerHTML = '<p class="empty-state">暂无初始资产设置</p>';
            return;
        }

        const assetsHtml = this.data.initialAssets.map(asset => {
            const timeStr = new Date(asset.time).toLocaleString('zh-CN');
            const categoryPath = asset.subcategory ? `${asset.category} > ${asset.subcategory}` : asset.category;
            return `
                <div class="initial-asset-item">
                    <div class="asset-info">
                        <strong>${categoryPath}</strong>
                        <span class="time">${timeStr}</span>
                        <span class="amount">${this.formatCurrency(asset.amount, asset.currency)}</span>
                    </div>
                    <button class="btn btn-sm btn-danger" onclick="window.assetTracker.deleteInitialAsset('${asset.id}')">删除</button>
                </div>
            `;
        }).join('');

        container.innerHTML = assetsHtml;
    }

    deleteInitialAsset(assetId) {
        if (!this.data.initialAssets) return;

        this.data.initialAssets = this.data.initialAssets.filter(asset => asset.id !== assetId);
        this.saveData();
        this.renderInitialAssetsList();
        this.showMessage('初始资产已删除', 'success');
    }

    clearInitialAssetForm() {
        document.getElementById('init-asset-time').value = '';
        document.getElementById('init-asset-category').value = '';
        document.getElementById('init-asset-subcategory').innerHTML = '<option value="">请选择子分类</option>';
        document.getElementById('init-asset-amount').value = '';
        document.getElementById('init-asset-currency').value = 'CNY';
    }

    populateInitAssetCategoryOptions() {
        const select = document.getElementById('init-asset-category');
        select.innerHTML = '<option value="">请选择分类</option>';

        Object.values(this.data.categories).forEach(category => {
            select.innerHTML += `<option value="${category.name}">${category.name}</option>`;
        });
    }

    // 交易模板功能
    renderTransactionTemplates(formType = 'add') {
        if (!this.data.transactionTemplates || this.data.transactionTemplates.length === 0) {
            return '<span class="empty-state">暂无常用模板</span>';
        }

        return this.data.transactionTemplates.map(template =>
            `<button type="button" class="btn btn-sm btn-primary template-btn"
                onclick="window.assetTracker.applyTransactionTemplate('${template.id}', '${formType}')">
                ${template.name}
            </button>`
        ).join('');
    }

    applyTransactionTemplate(templateId, formType = 'add') {
        const template = this.data.transactionTemplates.find(t => t.id === templateId);
        if (!template) return;

        const prefix = formType === 'edit' ? 'edit-' : '';

        // 设置表单值
        document.getElementById(`${prefix}transaction-category`).value = template.category;
        document.getElementById(`${prefix}transaction-amount`).value = template.amount;
        document.getElementById(`${prefix}transaction-currency`).value = template.currency;
        document.getElementById(`${prefix}transaction-type`).value = template.type;
        document.getElementById(`${prefix}transaction-purpose`).value = template.purpose;
        document.getElementById(`${prefix}transaction-description`).value = template.description;

        // 触发分类变化事件以更新子分类
        const categorySelect = document.getElementById(`${prefix}transaction-category`);
        categorySelect.dispatchEvent(new Event('change'));

        // 等待子分类更新后设置子分类值
        setTimeout(() => {
            if (template.subcategory) {
                document.getElementById(`${prefix}transaction-subcategory`).value = template.subcategory;
            }
        }, 100);

        this.showMessage(`已应用模板：${template.name}`, 'success');
    }

    showSaveTemplateForm(formType = 'add') {
        const prefix = formType === 'edit' ? 'edit-' : '';

        // 获取当前表单的值
        const category = document.getElementById(`${prefix}transaction-category`).value;
        const subcategory = document.getElementById(`${prefix}transaction-subcategory`).value;
        const amount = document.getElementById(`${prefix}transaction-amount`).value;
        const currency = document.getElementById(`${prefix}transaction-currency`).value;
        const type = document.getElementById(`${prefix}transaction-type`).value;
        const purpose = document.getElementById(`${prefix}transaction-purpose`).value;
        const description = document.getElementById(`${prefix}transaction-description`).value;

        if (!category || !amount || !purpose) {
            this.showMessage('请先填写完整的交易信息！', 'error');
            return;
        }

        const templateName = prompt('请输入模板名称：', `${category}-${purpose}`);
        if (!templateName) return;

        const template = {
            id: Date.now().toString(),
            name: templateName,
            category: category,
            subcategory: subcategory,
            amount: parseFloat(amount),
            currency: currency,
            type: type,
            purpose: purpose,
            description: description,
            createdAt: new Date().toISOString()
        };

        // 初始化模板数组（如果不存在）
        if (!this.data.transactionTemplates) {
            this.data.transactionTemplates = [];
        }

        this.data.transactionTemplates.push(template);
        this.saveData();
        this.showMessage(`模板"${templateName}"保存成功！`, 'success');

        // 重新渲染模板按钮
        this.refreshTemplateButtons(formType);
    }

    refreshTemplateButtons(formType = 'add') {
        const templateButtons = document.querySelector('.template-buttons');
        if (templateButtons) {
            templateButtons.innerHTML = `
                ${this.renderTransactionTemplates(formType)}
                <button type="button" class="btn btn-sm btn-secondary" onclick="window.assetTracker.showSaveTemplateForm('${formType}')">保存为模板</button>
            `;
        }
    }

    deleteTransactionTemplate(templateId) {
        if (!this.data.transactionTemplates) return;

        this.data.transactionTemplates = this.data.transactionTemplates.filter(t => t.id !== templateId);
        this.saveData();
        this.showMessage('模板已删除', 'success');
    }

    // 备忘录功能
    editMemo() {
        const currentMemo = this.data.memo || '';
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>编辑备忘录</h3>
            <form id="memo-form">
                <div class="form-group">
                    <label>备忘录内容</label>
                    <textarea id="memo-text" rows="8" placeholder="请输入备忘录内容...">${currentMemo}</textarea>
                </div>
                <div class="form-group">
                    <button type="submit" class="btn btn-primary">保存备忘录</button>
                    <button type="button" class="btn btn-secondary" onclick="window.assetTracker.closeModal()">取消</button>
                </div>
            </form>
        `;

        document.getElementById('memo-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveMemo();
        });

        this.showModal();
    }

    saveMemo() {
        const memoText = document.getElementById('memo-text').value.trim();
        this.data.memo = memoText;
        this.saveData();
        this.renderMemo();
        this.closeModal();
        this.showMessage('备忘录保存成功！', 'success');
    }

    renderMemo() {
        const memoContent = document.getElementById('memo-content');
        if (!this.data.memo || this.data.memo.trim() === '') {
            memoContent.innerHTML = '<p class="empty-state">点击编辑添加备忘录内容</p>';
        } else {
            // 将换行符转换为HTML换行
            const formattedMemo = this.data.memo.replace(/\n/g, '<br>');
            memoContent.innerHTML = `<div class="memo-text">${formattedMemo}</div>`;
        }
    }

    // 交易筛选功能
    initializeTransactionFilters() {
        // 设置默认时间范围：最近一个月
        const today = new Date();
        const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

        const dateFromInput = document.getElementById('date-from');
        const dateToInput = document.getElementById('date-to');

        if (dateFromInput) {
            dateFromInput.value = oneMonthAgo.toISOString().split('T')[0];
        }
        if (dateToInput) {
            dateToInput.value = today.toISOString().split('T')[0];
        }

        // 填充分类筛选选项
        this.populateCategoryFilter();
    }

    populateCategoryFilter() {
        const categoryFilter = document.getElementById('category-filter');
        if (!categoryFilter) return;

        categoryFilter.innerHTML = '<option value="">全部分类</option>';
        Object.values(this.data.categories).forEach(category => {
            categoryFilter.innerHTML += `<option value="${category.name}">${category.name}</option>`;
        });
    }

    filterTransactions() {
        this.renderTransactions();
    }

    // 计算货币细分数据
    // 点击显示详情功能（替代悬停）
    showAssetDetails(assetType) {
        const breakdown = this.calculateAssetBreakdown(assetType);
        let title = '';

        switch(assetType) {
            case 'total': title = '总资产明细'; break;
            case 'digital': title = '数字资产明细'; break;
            case 'cash': title = '现金明细'; break;
            case 'debt': title = '待还款明细'; break;
            case 'balance': title = '现余额明细'; break;
        }

        let content = `<h3>${title}</h3><div class="asset-details">`;

        if (breakdown && Object.keys(breakdown).length > 0) {
            for (const [currency, amount] of Object.entries(breakdown)) {
                if (amount !== 0) {
                    content += `<div class="currency-item">${currency}: ${this.formatCurrency(amount, currency)}</div>`;
                }
            }
        } else {
            content += '<div>暂无明细数据</div>';
        }

        content += '</div>';

        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = content;
        this.showModal();
    }

    calculateAssetBreakdown(assetType) {
        const breakdown = {};
        const baseCurrency = this.data.settings.baseCurrency;

        Object.values(this.data.categories).forEach(category => {
            this.traverseForAssetBreakdown(category, breakdown, assetType, baseCurrency);
        });

        return breakdown;
    }

    traverseForAssetBreakdown(category, breakdown, assetType, baseCurrency) {
        if (!category.children || Object.keys(category.children).length === 0) {
            const balance = category.balance || 0;
            const currency = category.currency || baseCurrency;

            if (balance === 0) return;

            let shouldInclude = false;

            switch(assetType) {
                case 'total':
                    shouldInclude = true;
                    break;
                case 'digital':
                    shouldInclude = category.name && category.name.includes('数字');
                    break;
                case 'cash':
                    shouldInclude = category.name && category.name.includes('现金');
                    break;
                case 'debt':
                    shouldInclude = category.isDebt;
                    break;
                case 'balance':
                    shouldInclude = !category.isDebt;
                    break;
            }

            if (shouldInclude) {
                if (!breakdown[currency]) {
                    breakdown[currency] = 0;
                }
                breakdown[currency] += assetType === 'total' ? Math.abs(balance) : balance;
            }
        } else {
            Object.values(category.children).forEach(child => {
                this.traverseForAssetBreakdown(child, breakdown, assetType, baseCurrency);
            });
        }
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.assetTracker = new AssetTracker();
    // 确保兼容性
    window.assetTracker.initialized = true;
});