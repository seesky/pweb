/**
 * pm-shared.js —— admin 外壳与各懒加载页面共享的工具集。
 * 必须在 loader.js 和各页面 .js 之前同步加载。
 *
 * 这里只放「跨文件共享」的符号；页面内部专用的工具仍留在各自 .js 内。
 * 共享符号来源：原 views/admin-pages/peerManage.jade 顶部的全局工具
 * （PM_H / pmIcon / PM_GRADS / PM_CARD_SX / pmFormatDate / pmTimeAgo /
 *   PmKpiCard / PmPanel / PmEmpty 等），被 peerManage / platformAdmin /
 *   relayAdmin 三个页面共同使用。
 *
 * 另外：admin.jade 外壳原本在同一个 <script> 作用域里解构了 React /
 * MaterialUI 的 hooks 与组件（useState / Box / Typography ...），各页面
 * 子模板直接引用这些全局名。拆成独立 IIFE 后作用域隔离，页面拿不到。
 * 这里把它们重新挂到全局，恢复原行为，使提取出的页面 .js 无需改动即可运行。
 */
(function () {
  'use strict';

  // ---- React / MaterialUI 全局解构（原 admin.jade 外壳顶部）----
  // 各页面 .js 的 IIFE 直接引用这些全局名（useState / Box / ...），不重复解构。
  window.useState = React.useState;
  window.useEffect = React.useEffect;
  window.useMemo = React.useMemo;
  window.useCallback = React.useCallback;
  window.createRoot = ReactDOM.createRoot;
  var M = MaterialUI;
  window.Box = M.Box;
  window.CssBaseline = M.CssBaseline;
  window.AppBar = M.AppBar;
  window.Toolbar = M.Toolbar;
  window.Typography = M.Typography;
  window.Drawer = M.Drawer;
  window.List = M.List;
  window.ListItemButton = M.ListItemButton;
  window.ListItemIcon = M.ListItemIcon;
  window.ListItemText = M.ListItemText;
  window.Collapse = M.Collapse;
  window.IconButton = M.IconButton;
  window.Divider = M.Divider;
  window.Button = M.Button;
  window.Avatar = M.Avatar;
  window.Paper = M.Paper;
  window.Icon = M.Icon;
  window.Stack = M.Stack;
  window.Chip = M.Chip;
  window.Table = M.Table;
  window.TableBody = M.TableBody;
  window.TableCell = M.TableCell;
  window.TableContainer = M.TableContainer;
  window.TableHead = M.TableHead;
  window.TableRow = M.TableRow;
  window.TextField = M.TextField;
  window.Dialog = M.Dialog;
  window.DialogTitle = M.DialogTitle;
  window.DialogContent = M.DialogContent;
  window.DialogActions = M.DialogActions;
  window.FormControlLabel = M.FormControlLabel;
  window.Switch = M.Switch;
  window.Snackbar = M.Snackbar;
  window.Alert = M.Alert;
  window.CircularProgress = M.CircularProgress;
  window.LinearProgress = M.LinearProgress;
  window.Tooltip = M.Tooltip;
  window.MenuItem = M.MenuItem;
  window.Pagination = M.Pagination;
  window.Checkbox = M.Checkbox;
  // 外壳里基于 Icon 定义的图标组件
  window.ExpandLess = function (props) { return React.createElement(M.Icon, props, 'expand_less'); };
  window.ExpandMore = function (props) { return React.createElement(M.Icon, props, 'expand_more'); };
  window.MenuIcon = function (props) { return React.createElement(M.Icon, props, 'menu'); };
  window.LogoutIcon = function (props) { return React.createElement(M.Icon, props, 'logout'); };

  // ---- PM 共享工具（原 peerManage.jade 顶部）----
  var PM = (window.PM = window.PM || {});

  // React.createElement 的简写别名
  PM.H = React.createElement;

  // 通用图标工厂
  PM.icon = function (name, props) {
    return PM.H(MaterialUI.Icon, Object.assign({ fontSize: 'small' }, props || {}), name);
  };

  // 渐变色板（KPI 卡片等用）
  PM.GRADS = {
    indigo: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    blue: 'linear-gradient(135deg,#0ea5e9,#3b82f6)',
    emerald: 'linear-gradient(135deg,#10b981,#34d399)',
    amber: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
    rose: 'linear-gradient(135deg,#f43f5e,#fb7185)',
    slate: 'linear-gradient(135deg,#64748b,#94a3b8)'
  };

  // 通用卡片样式
  PM.CARD_SX = {
    borderRadius: 3,
    border: '1px solid #eef0f4',
    boxShadow: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)'
  };

  // 日期/时间格式化
  PM.formatDate = function (value) {
    return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
  };
  PM.isToday = function (value) {
    if (!value) return false;
    var d = new Date(value); var n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };
  PM.timeAgo = function (value) {
    if (!value) return '从未';
    var diff = Date.now() - new Date(value).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 2592000000) return Math.floor(diff / 86400000) + ' 天前';
    return new Date(value).toLocaleDateString('zh-CN');
  };
  PM.formatDuration = function (sec) {
    if (!sec && sec !== 0) return '-';
    if (sec < 60) return sec + ' 秒';
    if (sec < 3600) return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
    return Math.floor(sec / 3600) + ' 时 ' + Math.floor((sec % 3600) / 60) + ' 分';
  };

  // KPI 卡片
  PM.KpiCard = function (_a) {
    var label = _a.label, value = _a.value, hint = _a.hint, icon = _a.icon, grad = _a.grad;
    return PM.H(MaterialUI.Paper, { sx: Object.assign({ p: 2.5, display: 'flex', alignItems: 'center', gap: 2 }, PM.CARD_SX) },
      PM.H(MaterialUI.Box, {
        sx: { width: 50, height: 50, borderRadius: 2.5, background: PM.GRADS[grad] || PM.GRADS.indigo, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 6px 16px rgba(99,102,241,.25)' }
      }, PM.icon(icon, { sx: { fontSize: 26 } })),
      PM.H(MaterialUI.Box, { sx: { minWidth: 0 } },
        PM.H(MaterialUI.Typography, { sx: { fontSize: 28, fontWeight: 800, lineHeight: 1.1, color: '#101828' } }, String(value)),
        PM.H(MaterialUI.Typography, { variant: 'body2', sx: { color: '#667085', mt: 0.25 } }, label),
        hint ? PM.H(MaterialUI.Typography, { variant: 'caption', sx: { color: '#98a2b3' } }, hint) : null
      )
    );
  };

  // 内容区卡片（带标题）
  PM.Panel = function (_a) {
    var title = _a.title, subtitle = _a.subtitle, action = _a.action, dense = _a.dense, children = _a.children;
    return PM.H(MaterialUI.Paper, { sx: Object.assign({ overflow: 'hidden' }, PM.CARD_SX) },
      (title || action)
        ? PM.H(MaterialUI.Box, { sx: { px: 2.5, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f1f4' } },
            PM.H(MaterialUI.Box, null,
              title ? PM.H(MaterialUI.Typography, { sx: { fontWeight: 700, color: '#101828' } }, title) : null,
              subtitle ? PM.H(MaterialUI.Typography, { variant: 'caption', sx: { color: '#98a2b3' } }, subtitle) : null
            ),
            action || null
          )
        : null,
      PM.H(MaterialUI.Box, { sx: { p: dense ? 0 : 2.5 } }, children)
    );
  };

  // 在线/离线状态标记
  PM.StatusChip = function (status) {
    return PM.H(MaterialUI.Box, { sx: { display: 'inline-flex', alignItems: 'center', gap: 0.75 } },
      PM.H(MaterialUI.Box, { sx: { width: 8, height: 8, borderRadius: '50%', background: status === 'online' ? '#12b76a' : '#d0d5dd', boxShadow: status === 'online' ? '0 0 0 3px rgba(18,183,106,.15)' : 'none' } }),
      PM.H(MaterialUI.Typography, { variant: 'body2', sx: { color: status === 'online' ? '#027a48' : '#667085', fontWeight: 500 } }, status === 'online' ? '在线' : '离线')
    );
  };

  // 空状态
  PM.Empty = function (_a) {
    var icon = _a.icon, title = _a.title, hint = _a.hint;
    return PM.H(MaterialUI.Box, { sx: { py: 7, textAlign: 'center' } },
      PM.H(MaterialUI.Box, { sx: { width: 64, height: 64, borderRadius: '50%', background: '#f2f4f7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#98a2b3', mb: 1.5 } }, PM.icon(icon, { sx: { fontSize: 30 } })),
      PM.H(MaterialUI.Typography, { sx: { fontWeight: 600, color: '#475467' } }, title),
      hint ? PM.H(MaterialUI.Typography, { variant: 'body2', sx: { color: '#98a2b3', mt: 0.5, maxWidth: 420, mx: 'auto' } }, hint) : null
    );
  };

  // ---- 模块管理（moduleAdmin）共享符号 ----
  // 原 admin.jade 外壳里定义，被 moduleAdmin.js 引用。提升到全局后两者都可访问。
  // 依赖全局的 useState / ListItemButton / ListItemText / Collapse / List（已在上方解构）。

  // 模块层级构建
  window.buildModuleHierarchy = function (items) {
    items = items || [];
    var lookup = new Map();
    items.forEach(function (item) { lookup.set(item.id, Object.assign({}, item, { children: [] })); });
    var roots = [];
    lookup.forEach(function (node) {
      if (node.parentId && lookup.has(node.parentId)) {
        lookup.get(node.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    });
    var sortFn = function (a, b) { return (a.sortCode || 0) - (b.sortCode || 0); };
    lookup.forEach(function (node) { node.children.sort(sortFn); });
    return roots.sort(sortFn);
  };

  // 模块树节点（递归 React 组件）
  window.ModuleTreeNode = function (_a) {
    var node = _a.node, selectedId = _a.selectedId, onSelect = _a.onSelect, depth = _a.depth === undefined ? 0 : _a.depth;
    var hasChildren = node.children && node.children.length > 0;
    var openState = useState(depth < 1);
    var open = openState[0], setOpen = openState[1];
    var handleClick = function () {
      onSelect(node.id);
      if (hasChildren) { setOpen(function (prev) { return !prev; }); }
    };
    return React.createElement(React.Fragment, null,
      React.createElement(ListItemButton, {
        onClick: handleClick,
        selected: selectedId === node.id,
        sx: { pl: 2 + depth * 1.5, borderRadius: 1.5, mb: 0.25, '&.Mui-selected': { backgroundColor: 'rgba(99,102,241,0.15)' } }
      },
        React.createElement(ListItemText, { primary: node.fullName || node.fullname || node.code, secondary: node.code })
      ),
      hasChildren ? React.createElement(Collapse, { in: open, timeout: 'auto', unmountOnExit: true },
        React.createElement(List, { disablePadding: true },
          node.children.map(function (child) {
            return React.createElement(ModuleTreeNode, { key: child.id, node: child, selectedId: selectedId, onSelect: onSelect, depth: depth + 1 });
          })
        )
      ) : null
    );
  };

  // 模块树
  window.ModuleTree = function (_a) {
    var data = _a.data === undefined ? [] : _a.data, selectedId = _a.selectedId, onSelect = _a.onSelect;
    return React.createElement(List, { component: 'nav' },
      React.createElement(ListItemButton, {
        selected: selectedId === null,
        onClick: function () { onSelect(null); },
        sx: { borderRadius: 1.5, mb: 0.5 }
      },
        React.createElement(ListItemText, { primary: '全部模块' })
      ),
      data.map(function (node) {
        return React.createElement(ModuleTreeNode, { key: node.id, node: node, selectedId: selectedId, onSelect: onSelect, depth: 0 });
      })
    );
  };

  // 模块类型映射
  window.moduleTypeMap = { 1: '系统', 2: '平台', 3: '应用', 4: '窗体', 5: '报表', 6: '菜单' };

  // 模块表单默认值
  window.createDefaultForm = function (parentId) {
    return {
      id: '', parentId: parentId || '', code: '', fullName: '', category: '',
      moduleType: 6, navigateUrl: '', mvcNavigateUrl: '', iconCss: '', iconUrl: '',
      description: '', sortCode: '', enabled: true, isPublic: false, isMenu: true,
      allowEdit: true, allowDelete: true, expand: false
    };
  };

  // 记录 → 表单值
  window.mapRecordToFormValues = function (record) {
    return record ? {
      id: record.id, parentId: record.parentId || '', code: record.code || '',
      fullName: record.fullName || '', category: record.category || '',
      moduleType: record.moduleType || 6, navigateUrl: record.navigateUrl || '',
      mvcNavigateUrl: record.mvcNavigateUrl || '', iconCss: record.iconCss || '',
      iconUrl: record.iconUrl || '', description: record.description || '',
      sortCode: record.sortCode == null ? '' : record.sortCode,
      enabled: !!record.enabled, isPublic: !!record.isPublic, isMenu: !!record.isMenu,
      allowEdit: !!record.allowEdit, allowDelete: !!record.allowDelete, expand: !!record.expand
    } : createDefaultForm();
  };

  // 表单值 → 序列化（提交后端）
  window.serializeFormValues = function (values) {
    return {
      parentId: values.parentId || null, code: values.code && values.code.trim(),
      fullName: values.fullName && values.fullName.trim(),
      category: (values.category && values.category.trim()) || null,
      moduleType: Number(values.moduleType) || 6,
      navigateUrl: values.navigateUrl || '#', mvcNavigateUrl: values.mvcNavigateUrl || '#',
      iconCss: values.iconCss || null, iconUrl: values.iconUrl || null,
      description: values.description || null,
      sortCode: values.sortCode === '' ? null : Number(values.sortCode),
      enabled: !!values.enabled, isPublic: !!values.isPublic, isMenu: !!values.isMenu,
      allowEdit: !!values.allowEdit, allowDelete: !!values.allowDelete, expand: !!values.expand
    };
  };

  // 控制台侧栏区块定义（admin.jade 外壳侧栏在渲染前就需要它）
  // 原样来自 views/admin-pages/peerManage.jade（PM_SECTIONS）。
  window.PM_SECTIONS = [
    { key: 'overview', label: '总览', icon: 'dashboard', title: '总览', subtitle: '远程控制服务的整体运行态势' },
    { key: 'devices', label: '设备资产', icon: 'devices', title: '设备资产', subtitle: '纳管设备、设备组与注册令牌' },
    { key: 'sessions', label: '会话记录', icon: 'cast_connected', title: '会话记录', subtitle: '远程控制会话与连接质量' },
    { key: 'network', label: '网络与中继', icon: 'settings_ethernet', title: '网络与中继', subtitle: 'P2P 成功率、中继占比与 NAT 分布' },
    { key: 'access', label: '访问授权', icon: 'verified_user', title: '访问授权', subtitle: '谁可以连接哪些设备' },
    { key: 'members', label: '成员管理', icon: 'group', title: '成员管理', subtitle: '空间成员与角色（角色授权的依据）' },
    { key: 'policies', label: '权限模板', icon: 'tune', title: '权限模板', subtitle: '一次会话允许的能力（键鼠/文件/剪贴板/确认/超时）' },
    { key: 'devicePolicies', label: '设备策略', icon: 'settings', title: '设备策略', subtitle: '设备侧客户端运行配置（码率/帧率/传输/更新/日志），可按设备或设备组绑定并继承' },
    { key: 'deploy', label: '部署中心', icon: 'cloud_download', title: '部署中心', subtitle: '客户端版本发布、渠道管理与安装纳管指引' },
    { key: 'tickets', label: '支持工单', icon: 'confirmation_number', title: '支持工单', subtitle: '报修、接单、指派、沟通与处理' },
    { key: 'audit', label: '审计日志', icon: 'assignment', title: '审计日志', subtitle: '关键操作的合规记录' },
    { key: 'settings', label: '企业设置', icon: 'business', title: '企业设置', subtitle: '企业信息、配额用量与成员邀请' }
  ];
})();
