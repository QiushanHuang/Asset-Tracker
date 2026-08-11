export function buildShell(): HTMLDivElement {
  const root = document.createElement('div');
  root.dataset.appShell = 'true';
  root.innerHTML = `
    <div class="app-container">
      <nav class="sidebar">
        <div class="logo">
          <h1>💰 Asset Tracker</h1>
        </div>
        <ul class="nav-menu">
          <li><a href="#dashboard" class="nav-link active" data-section="dashboard">📊 资产概览</a></li>
          <li><a href="#categories" class="nav-link" data-section="categories">🏷️ 分类管理</a></li>
          <li><a href="#transactions" class="nav-link" data-section="transactions">💳 账单记录</a></li>
          <li><a href="#automation" class="nav-link" data-section="automation">⚙️ 自动记账</a></li>
          <li><a href="#analytics" class="nav-link" data-section="analytics">📈 数据分析</a></li>
          <li><a href="#settings" class="nav-link" data-section="settings">⚙️ 系统设置</a></li>
          <li><a href="#import-export" class="nav-link" data-section="import-export">📁 导入导出</a></li>
        </ul>
      </nav>
      <main class="main-content">
        <header class="header">
          <div class="header-left">
            <h2 id="section-title">资产概览</h2>
            <p data-role="boot-status">Loading local book...</p>
          </div>
          <div class="header-right">
            <button class="btn btn-primary" id="add-transaction-btn" type="button">+ 添加账单</button>
            <button class="btn btn-secondary" id="backup-btn" type="button">备份数据</button>
          </div>
        </header>
        <div id="app-root"></div>
      </main>
      <div id="modal" class="modal" aria-hidden="true">
        <div class="modal-content">
          <button class="close" type="button" aria-label="关闭">×</button>
          <div id="modal-body"></div>
        </div>
      </div>
    </div>
  `;
  return root;
}
