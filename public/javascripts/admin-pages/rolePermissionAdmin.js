/**
 * rolePermissionAdmin.js —— 由 views/admin-pages/rolePermissionAdmin.jade 提取。
 * 懒加载：用户切换到「role-permission-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const RolePermissionAdminPage = () => {
    const [roles, setRoles] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [selectedRole, setSelectedRole] = useState(null);
    const [detail, setDetail] = useState({ role: null, moduleIds: [], permissionItemIds: [], modules: [], permissionItems: [] });
    const [detailLoading, setDetailLoading] = useState(false);
    const [moduleTree, setModuleTree] = useState([]);
    const [permissionTree, setPermissionTree] = useState([]);
    const [selectedModuleIds, setSelectedModuleIds] = useState([]);
    const [selectedPermissionItemIds, setSelectedPermissionItemIds] = useState([]);
    const [savingModules, setSavingModules] = useState(false);
    const [savingPermissions, setSavingPermissions] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });

    const CheckboxComponent =
      typeof Checkbox !== 'undefined'
        ? Checkbox
        : typeof MaterialUI !== 'undefined'
          ? MaterialUI.Checkbox
          : null;

    const closeNotify = () => setNotify((prev) => ({ ...prev, open: false }));

    const loadRoles = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (keyword) {
          params.append('keyword', keyword);
        }
        const resp = await fetch(`/role-permission-admin/roles?${params.toString()}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '获取角色失败');
        }
        const list = result.data || [];
        setRoles(list);
        setTotal(result.total || 0);
        if (list.length && (!selectedRole || !list.find((item) => item.id === selectedRole.id))) {
          setSelectedRole(list[0]);
        }
        if (!list.length) {
          setSelectedRole(null);
        }
      } catch (err) {
        setError(err.message || '获取角色失败');
      } finally {
        setLoading(false);
      }
    }, [page, pageSize, keyword, selectedRole]);

    useEffect(() => {
      loadRoles();
    }, [loadRoles]);

    useEffect(() => {
      if (selectedRole && !roles.find((item) => item.id === selectedRole.id)) {
        setSelectedRole(null);
      }
    }, [roles, selectedRole]);

    const loadMeta = useCallback(async () => {
      try {
        const [moduleResp, permissionResp] = await Promise.all([
          fetch('/role-permission-admin/modules'),
          fetch('/role-permission-admin/permission-items')
        ]);
        if (moduleResp.status === 401 || permissionResp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const moduleResult = await moduleResp.json();
        const permissionResult = await permissionResp.json();
        if (moduleResp.ok) {
          setModuleTree(moduleResult.data || []);
        }
        if (permissionResp.ok) {
          setPermissionTree(permissionResult.data || []);
        }
      } catch (error) {
        console.error(error);
      }
    }, []);

    useEffect(() => {
      loadMeta();
    }, [loadMeta]);

    const loadDetail = useCallback(async (role) => {
      if (!role) {
        setDetail({ role: null, moduleIds: [], permissionItemIds: [], modules: [], permissionItems: [] });
        setSelectedModuleIds([]);
        setSelectedPermissionItemIds([]);
        return;
      }
      setDetailLoading(true);
      try {
        const resp = await fetch(`/role-permission-admin/roles/${role.id}/detail`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '获取角色权限详情失败');
        }
        const payload = result.data || {};
        setDetail(payload);
        setSelectedModuleIds(payload.moduleIds || []);
        setSelectedPermissionItemIds(payload.permissionItemIds || []);
      } catch (error) {
        console.error(error);
        setDetail({ role, moduleIds: [], permissionItemIds: [], modules: [], permissionItems: [] });
        setSelectedModuleIds([]);
        setSelectedPermissionItemIds([]);
      } finally {
        setDetailLoading(false);
      }
    }, []);

    useEffect(() => {
      if (selectedRole) {
        loadDetail(selectedRole);
      } else {
        setDetail({ role: null, moduleIds: [], permissionItemIds: [], modules: [], permissionItems: [] });
        setSelectedModuleIds([]);
        setSelectedPermissionItemIds([]);
      }
    }, [selectedRole, loadDetail]);

    const handleSearch = () => {
      setPage(1);
      setKeyword(searchInput.trim());
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const toggleCollectionValue = (selected, id) => {
      if (selected.includes(id)) {
        return selected.filter((item) => item !== id);
      }
      return [...selected, id];
    };

    const handleToggleModule = (moduleId) => {
      setSelectedModuleIds((prev) => toggleCollectionValue(prev, moduleId));
    };

    const handleTogglePermissionItem = (permissionId) => {
      setSelectedPermissionItemIds((prev) => toggleCollectionValue(prev, permissionId));
    };

    const createCheckboxControl = (checked, onChange) =>
      CheckboxComponent
        ? React.createElement(CheckboxComponent, { size: 'small', checked, onChange })
        : React.createElement('input', {
            type: 'checkbox',
            checked,
            onChange: onChange,
            style: { marginRight: 8 }
          });

    const renderTreeNodes = (nodes = [], selectedIds = [], onToggle, depth = 0) =>
      nodes.map((node) =>
        React.createElement(Box, { key: node.id, sx: { pl: depth ? depth * 2 : 0, py: 0.25 } },
          React.createElement(FormControlLabel, {
            control: createCheckboxControl(selectedIds.includes(node.id), () => onToggle(node.id)),
            label: `${node.name}${node.code ? ` (${node.code})` : ''}`,
            sx: { width: '100%', m: 0 }
          }),
          node.children?.length ? renderTreeNodes(node.children, selectedIds, onToggle, depth + 1) : null
        )
      );

    const handleSaveModules = async () => {
      if (!selectedRole) {
        return;
      }
      setSavingModules(true);
      try {
        const resp = await fetch(`/role-permission-admin/roles/${selectedRole.id}/modules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleIds: selectedModuleIds })
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存模块权限失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '模块权限已保存' });
        await loadDetail(selectedRole);
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '保存模块权限失败' });
      } finally {
        setSavingModules(false);
      }
    };

    const handleSavePermissions = async () => {
      if (!selectedRole) {
        return;
      }
      setSavingPermissions(true);
      try {
        const resp = await fetch(`/role-permission-admin/roles/${selectedRole.id}/permission-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionItemIds: selectedPermissionItemIds })
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存操作权限失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '操作权限已保存' });
        await loadDetail(selectedRole);
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '保存操作权限失败' });
      } finally {
        setSavingPermissions(false);
      }
    };

    const renderTagList = (items = [], emptyText) => {
      if (!items.length) {
        return React.createElement(Typography, { variant: 'body2', color: 'text.secondary', mt: 1 }, emptyText);
      }
      return React.createElement(Stack, { direction: 'row', spacing: 1, flexWrap: 'wrap', mt: 1 },
        items.map((item) =>
          React.createElement(Chip, {
            key: item.id || item.ID,
            label: item.name || item.fullName || item.code || '未命名',
            variant: 'outlined'
          })
        )
      );
    };

    return React.createElement(Box, {
      sx: {
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', lg: '360px 1fr' }
      }
    },
      React.createElement(Paper, { sx: { p: 2, borderRadius: 3, height: 'fit-content' } },
        React.createElement(Stack, { spacing: 1.5 },
          React.createElement(TextField, {
            label: '搜索角色（编码 / 名称）',
            size: 'small',
            value: searchInput,
            onChange: (event) => setSearchInput(event.target.value)
          }),
          React.createElement(Button, { variant: 'text', size: 'small', onClick: handleSearch }, '搜索'),
          error ? React.createElement(Alert, { severity: 'error' }, error) : null,
          React.createElement(Divider, null),
          loading
            ? React.createElement(Box, { sx: { display: 'flex', justifyContent: 'center', py: 4 } },
                React.createElement(CircularProgress, { size: 28 })
              )
            : React.createElement(List, { sx: { maxHeight: 480, overflowY: 'auto' } },
                roles.length
                  ? roles.map((role) =>
                      React.createElement(ListItemButton, {
                        key: role.id,
                        selected: selectedRole?.id === role.id,
                        onClick: () => setSelectedRole(role)
                      },
                        React.createElement(ListItemText, {
                          primary: role.realName || role.code || '未命名角色',
                          secondary: role.code || role.category || ''
                        })
                      )
                    )
                  : React.createElement(Typography, {
                      variant: 'body2',
                      color: 'text.secondary',
                      sx: { textAlign: 'center', py: 4 }
                    }, '暂无满足条件的角色')
              ),
          React.createElement(Box, { sx: { display: 'flex', justifyContent: 'center', mt: 2 } },
            React.createElement(Pagination, {
              count: totalPages,
              page,
              onChange: (event, value) => setPage(value),
              color: 'primary'
            })
          )
        )
      ),
      React.createElement(Box, null,
        selectedRole
          ? React.createElement(Paper, { sx: { p: 2, borderRadius: 3, mb: 2 } },
              React.createElement(Stack, { spacing: 0.5 },
                React.createElement(Typography, { variant: 'h6' }, selectedRole.realName || selectedRole.code),
                React.createElement(Typography, { variant: 'body2', color: 'text.secondary' },
                  '编码：' + (selectedRole.code || '-')),
                React.createElement(Typography, { variant: 'body2', color: 'text.secondary' },
                  '类别：' + (selectedRole.category || '-'))
              )
            )
          : React.createElement(Paper, { sx: { p: 2, borderRadius: 3, mb: 2 } },
              React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '请选择左侧角色')
            ),
        selectedRole
          ? React.createElement(Stack, { spacing: 2 },
              React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                React.createElement(Typography, { variant: 'subtitle1', mb: 1 }, '模块权限'),
                detailLoading ? React.createElement(LinearProgress, null) : null,
                React.createElement(Box, {
                  sx: {
                    border: '1px solid #e5e7eb',
                    borderRadius: 2,
                    maxHeight: 320,
                    overflowY: 'auto',
                    p: 1
                  }
                },
                  moduleTree.length
                    ? renderTreeNodes(moduleTree, selectedModuleIds, handleToggleModule)
                    : React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '暂无模块数据')
                ),
                React.createElement(Stack, { direction: 'row', justifyContent: 'flex-end', mt: 2 },
                  React.createElement(Button, {
                    variant: 'contained',
                    onClick: handleSaveModules,
                    disabled: savingModules
                  }, savingModules ? '保存中...' : '保存模块权限')
                )
              ),
              React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                React.createElement(Typography, { variant: 'subtitle1', mb: 1 }, '操作权限'),
                detailLoading ? React.createElement(LinearProgress, null) : null,
                React.createElement(Box, {
                  sx: {
                    border: '1px solid #e5e7eb',
                    borderRadius: 2,
                    maxHeight: 320,
                    overflowY: 'auto',
                    p: 1
                  }
                },
                  permissionTree.length
                    ? renderTreeNodes(permissionTree, selectedPermissionItemIds, handleTogglePermissionItem)
                    : React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '暂无操作权限')
                ),
                React.createElement(Stack, { direction: 'row', justifyContent: 'flex-end', mt: 2 },
                  React.createElement(Button, {
                    variant: 'contained',
                    onClick: handleSavePermissions,
                    disabled: savingPermissions
                  }, savingPermissions ? '保存中...' : '保存操作权限')
                )
              ),
              React.createElement(Box, { sx: { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } } },
                React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                  React.createElement(Stack, { direction: 'row', alignItems: 'center', justifyContent: 'space-between' },
                    React.createElement(Typography, { variant: 'subtitle1' }, '模块概览'),
                    detailLoading ? React.createElement(CircularProgress, { size: 18 }) : null
                  ),
                  renderTagList(detail.modules, '暂无关联模块')
                ),
                React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                  React.createElement(Stack, { direction: 'row', alignItems: 'center', justifyContent: 'space-between' },
                    React.createElement(Typography, { variant: 'subtitle1' }, '操作权限概览'),
                    detailLoading ? React.createElement(CircularProgress, { size: 18 }) : null
                  ),
                  renderTagList(detail.permissionItems, '暂无直接授权的操作权限')
                )
              )
            )
          : null
      ),
      React.createElement(Snackbar, { open: notify.open, autoHideDuration: 3200, onClose: closeNotify },
        React.createElement(Alert, { severity: notify.severity, onClose: closeNotify, sx: { width: '100%' } }, notify.message)
      )
    );
  };

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['role-permission-admin'] = RolePermissionAdminPage;
})();
