/**
 * userPermissionAdmin.js —— 由 views/admin-pages/userPermissionAdmin.jade 提取。
 * 懒加载：用户切换到「user-permission-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const UserPermissionAdminPage = () => {
    const [users, setUsers] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [selectedUser, setSelectedUser] = useState(null);
    const [detail, setDetail] = useState({ user: null, roles: [], modules: [], permissionItems: [] });
    const [detailLoading, setDetailLoading] = useState(false);
    const [roleOptions, setRoleOptions] = useState([]);
    const [moduleTree, setModuleTree] = useState([]);
    const [permissionTree, setPermissionTree] = useState([]);
    const [organizeTree, setOrganizeTree] = useState([]);
    const [roleSelection, setRoleSelection] = useState({ primaryRoleId: '', extraRoleIds: [] });
    const [selectedModuleIds, setSelectedModuleIds] = useState([]);
    const [selectedPermissionIds, setSelectedPermissionIds] = useState([]);
    const [selectedOrganizeIds, setSelectedOrganizeIds] = useState([]);
    const [savingRoles, setSavingRoles] = useState(false);
    const [savingModules, setSavingModules] = useState(false);
    const [savingPermissions, setSavingPermissions] = useState(false);
    const [savingOrganizeScope, setSavingOrganizeScope] = useState(false);
    const [organizeScopeLoading, setOrganizeScopeLoading] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });
    const CheckboxComponent =
      typeof Checkbox !== 'undefined'
        ? Checkbox
        : typeof MaterialUI !== 'undefined'
          ? MaterialUI.Checkbox
          : null;

    const closeNotify = () => setNotify((prev) => ({ ...prev, open: false }));

    const loadUsers = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (keyword) {
          params.append('keyword', keyword);
        }
        const resp = await fetch(`/user-permission/users?${params.toString()}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '获取用户失败');
        }
        const list = result.data || [];
        setUsers(list);
        setTotal(result.total || 0);
        if (list.length && (!selectedUser || !list.find((item) => item.id === selectedUser.id))) {
          setSelectedUser(list[0]);
        }
        if (!list.length) {
          setSelectedUser(null);
        }
      } catch (err) {
        setError(err.message || '获取用户失败');
      } finally {
        setLoading(false);
      }
    }, [page, pageSize, keyword, selectedUser]);

    useEffect(() => {
      loadUsers();
    }, [loadUsers]);

    useEffect(() => {
      if (selectedUser && !users.find((item) => item.id === selectedUser.id)) {
        setSelectedUser(null);
      }
    }, [users, selectedUser]);

    const loadDetail = useCallback(async (userInfo) => {
      if (!userInfo) {
        setDetail({ user: null, roles: [], modules: [], permissionItems: [] });
        return;
      }
      setDetailLoading(true);
      try {
        const resp = await fetch(`/user-permission/users/${userInfo.id}/detail`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '获取权限详情失败');
        }
        const payload = {
          user: result.data?.user || userInfo,
          roles: result.data?.roles || [],
          modules: result.data?.modules || [],
          permissionItems: result.data?.permissionItems || []
        };
        setDetail(payload);
        const primaryRoleId = payload.user?.roleId || '';
        const extraRoleIds = payload.roles
          .map((role) => role.ID)
          .filter((roleId) => roleId && roleId !== primaryRoleId);
        setRoleSelection({ primaryRoleId, extraRoleIds });
        setSelectedModuleIds(payload.modules.map((module) => module.id));
        setSelectedPermissionIds(payload.permissionItems.map((item) => item.ID));
      } catch (err) {
        setDetail({ user: userInfo, roles: [], modules: [], permissionItems: [] });
        setSelectedModuleIds([]);
        setSelectedPermissionIds([]);
        setRoleSelection({ primaryRoleId: '', extraRoleIds: [] });
      } finally {
        setDetailLoading(false);
      }
    }, []);

    useEffect(() => {
      if (selectedUser) {
        loadDetail(selectedUser);
      } else {
        setDetail({ user: null, roles: [], modules: [], permissionItems: [] });
        setRoleSelection({ primaryRoleId: '', extraRoleIds: [] });
        setSelectedModuleIds([]);
        setSelectedPermissionIds([]);
        setSelectedOrganizeIds([]);
      }
    }, [selectedUser, loadDetail]);

    const loadOrganizeScope = useCallback(async (userInfo) => {
      if (!userInfo) {
        setSelectedOrganizeIds([]);
        return;
      }
      setOrganizeScopeLoading(true);
      try {
        const resp = await fetch(`/user-permission/users/${userInfo.id}/organize-scope`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '获取组织范围失败');
        }
        setSelectedOrganizeIds(Array.isArray(result.data) ? result.data : []);
      } catch (error) {
        console.error(error);
        setSelectedOrganizeIds([]);
      } finally {
        setOrganizeScopeLoading(false);
      }
    }, []);

    useEffect(() => {
      if (selectedUser) {
        loadOrganizeScope(selectedUser);
      } else {
        setSelectedOrganizeIds([]);
      }
    }, [selectedUser, loadOrganizeScope]);

    const loadMeta = useCallback(async () => {
      try {
        const [roleResp, moduleResp, permissionResp, organizeResp] = await Promise.all([
          fetch('/user-permission/roles'),
          fetch('/user-permission/modules'),
          fetch('/user-permission/permission-items'),
          fetch('/user-permission/organizes')
        ]);
        const unauthorized = [roleResp, moduleResp, permissionResp, organizeResp].some((resp) => resp.status === 401);
        if (unauthorized) {
          window.location.href = '/login';
          return;
        }
        const roleResult = await roleResp.json();
        const moduleResult = await moduleResp.json();
        const permissionResult = await permissionResp.json();
        const organizeResult = await organizeResp.json();
        if (roleResp.ok) {
          setRoleOptions(roleResult.data || []);
        }
        if (moduleResp.ok) {
          setModuleTree(moduleResult.data || []);
        }
        if (permissionResp.ok) {
          setPermissionTree(permissionResult.data || []);
        }
        if (organizeResp.ok) {
          setOrganizeTree(organizeResult.data || []);
        }
      } catch (error) {
        console.error(error);
      }
    }, []);

    useEffect(() => {
      loadMeta();
    }, [loadMeta]);

    const handleSearch = () => {
      setPage(1);
      setKeyword(searchInput.trim());
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const handlePrimaryRoleChange = (event) => {
      const value = event.target.value || '';
      setRoleSelection((prev) => ({
        primaryRoleId: value,
        extraRoleIds: prev.extraRoleIds.filter((roleId) => roleId !== value)
      }));
    };

    const handleToggleExtraRole = (roleId) => {
      setRoleSelection((prev) => {
        if (prev.extraRoleIds.includes(roleId)) {
          return { ...prev, extraRoleIds: prev.extraRoleIds.filter((id) => id !== roleId) };
        }
        return { ...prev, extraRoleIds: [...prev.extraRoleIds, roleId] };
      });
    };

    const handleToggleModule = (moduleId) => {
      setSelectedModuleIds((prev) => {
        if (prev.includes(moduleId)) {
          return prev.filter((id) => id !== moduleId);
        }
        return [...prev, moduleId];
      });
    };

    const handleTogglePermission = (permissionId) => {
      setSelectedPermissionIds((prev) => {
        if (prev.includes(permissionId)) {
          return prev.filter((id) => id !== permissionId);
        }
        return [...prev, permissionId];
      });
    };

    const handleToggleOrganize = (organizeId) => {
      setSelectedOrganizeIds((prev) => {
        if (prev.includes(organizeId)) {
          return prev.filter((id) => id !== organizeId);
        }
        return [...prev, organizeId];
      });
    };

    const handleSaveRoles = async () => {
      if (!selectedUser) {
        return;
      }
      setSavingRoles(true);
      try {
        const resp = await fetch(`/user-permission/users/${selectedUser.id}/roles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(roleSelection)
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存角色失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '角色配置已保存' });
        await loadDetail(selectedUser);
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '保存角色失败' });
      } finally {
        setSavingRoles(false);
      }
    };

    const handleSaveModules = async () => {
      if (!selectedUser) {
        return;
      }
      setSavingModules(true);
      try {
        const resp = await fetch(`/user-permission/users/${selectedUser.id}/modules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleIds: selectedModuleIds })
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存模块权限失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '模块权限已保存' });
        await loadDetail(selectedUser);
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '保存模块权限失败' });
      } finally {
        setSavingModules(false);
      }
    };

    const handleSavePermissions = async () => {
      if (!selectedUser) {
        return;
      }
      setSavingPermissions(true);
      try {
        const resp = await fetch(`/user-permission/users/${selectedUser.id}/permission-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionItemIds: selectedPermissionIds })
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存操作权限失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '操作权限已保存' });
        await loadDetail(selectedUser);
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '保存操作权限失败' });
      } finally {
        setSavingPermissions(false);
      }
    };

    const handleSaveOrganizeScope = async () => {
      if (!selectedUser) {
        return;
      }
      setSavingOrganizeScope(true);
      try {
        const resp = await fetch(`/user-permission/users/${selectedUser.id}/organize-scope`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizeIds: selectedOrganizeIds })
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存组织范围失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '组织授权范围已保存' });
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '保存组织范围失败' });
      } finally {
        setSavingOrganizeScope(false);
      }
    };

    const createCheckboxControl = (checked, onToggle) =>
      CheckboxComponent
        ? React.createElement(CheckboxComponent, { size: 'small', checked, onChange: onToggle })
        : React.createElement('input', {
            type: 'checkbox',
            checked,
            onChange: (event) => {
              event.stopPropagation?.();
              onToggle();
            },
            style: { marginRight: 8 }
          });

    const renderTreeNodes = (nodes = [], selectedIds = [], onToggle, level = 0) =>
      nodes.map((node) =>
        React.createElement(Box, { key: node.id, sx: { pl: level ? level * 2 : 0, py: 0.25 } },
          React.createElement(FormControlLabel, {
            control: createCheckboxControl(selectedIds.includes(node.id), () => onToggle(node.id)),
            label: `${node.name}${node.code ? ` (${node.code})` : ''}`,
            sx: { width: '100%', m: 0 }
          }),
          node.children?.length ? renderTreeNodes(node.children, selectedIds, onToggle, level + 1) : null
        )
      );

    const organizeNodeMap = useMemo(() => {
      const map = new Map();
      const walk = (nodes = []) => {
        nodes.forEach((node) => {
          map.set(node.id, node);
          if (node.children?.length) {
            walk(node.children);
          }
        });
      };
      walk(organizeTree);
      return map;
    }, [organizeTree]);

    const organizeTagList = useMemo(() => {
      if (!selectedOrganizeIds.length) {
        return [];
      }
      return selectedOrganizeIds.map((id) => {
        const node = organizeNodeMap.get(id);
        return {
          id,
          name: node?.name || node?.code || '未命名组织'
        };
      });
    }, [selectedOrganizeIds, organizeNodeMap]);

    const renderTagList = (items = [], emptyText) => {
      if (!items.length) {
        return React.createElement(Typography, { variant: 'body2', color: 'text.secondary', mt: 2 }, emptyText);
      }
      return React.createElement(Stack, { direction: 'row', spacing: 1, flexWrap: 'wrap', mt: 2 },
        items.map((item) =>
          React.createElement(Chip, {
            key: item.id || item.ID,
            label: item.name || item.fullName || item.FULLNAME || item.code || item.CODE || '未命名',
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
            label: '搜索用户名 / 姓名 / 编号',
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
                users.length
                  ? users.map((userItem) =>
                      React.createElement(ListItemButton, {
                        key: userItem.id,
                        selected: selectedUser?.id === userItem.id,
                        onClick: () => setSelectedUser(userItem)
                      },
                        React.createElement(ListItemText, {
                          primary: userItem.realName || userItem.userName || '未命名',
                          secondary: userItem.userName || userItem.code || ''
                        })
                      )
                    )
                  : React.createElement(Typography, {
                      variant: 'body2',
                      color: 'text.secondary',
                      sx: { py: 4, textAlign: 'center' }
                    }, '暂无满足条件的用户')
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
        selectedUser
          ? React.createElement(Paper, { sx: { p: 2, borderRadius: 3, mb: 2 } },
              React.createElement(Stack, { spacing: 0.5 },
                React.createElement(Typography, { variant: 'h6' }, selectedUser.realName || selectedUser.userName),
                React.createElement(Typography, { variant: 'body2', color: 'text.secondary' },
                  '账号：' + (selectedUser.userName || '-')),
                React.createElement(Typography, { variant: 'body2', color: 'text.secondary' },
                  '编号：' + (selectedUser.code || '-'))
              )
            )
          : React.createElement(Paper, { sx: { p: 2, borderRadius: 3, mb: 2 } },
              React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '请选择左侧用户')
            ),
        selectedUser
          ? React.createElement(Stack, { spacing: 2 },
              React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                React.createElement(Stack, { direction: { xs: 'column', md: 'row' }, spacing: 2 },
                  React.createElement(TextField, {
                    select: true,
                    label: '主角色',
                    size: 'small',
                    sx: { minWidth: 220 },
                    value: roleSelection.primaryRoleId,
                    onChange: handlePrimaryRoleChange,
                    children: [
                      React.createElement(MenuItem, { key: 'none', value: '' }, '无主角色'),
                      ...roleOptions.map((role) =>
                        React.createElement(MenuItem, { key: role.id, value: role.id }, role.name || role.code || '未命名')
                      )
                    ]
                  }),
                  React.createElement(Box, {
                    sx: {
                      flexGrow: 1,
                      border: '1px solid #e5e7eb',
                      borderRadius: 2,
                      maxHeight: 220,
                      overflowY: 'auto',
                      p: 1
                    }
                  },
                    roleOptions.length
                      ? roleOptions.map((role) =>
                          React.createElement(FormControlLabel, {
                            key: role.id,
                            control: createCheckboxControl(roleSelection.extraRoleIds.includes(role.id), () => handleToggleExtraRole(role.id)),
                            label: role.name || role.code || '未命名',
                            sx: { width: '100%', m: 0 }
                          })
                        )
                      : React.createElement(Typography, { variant: 'body2', color: 'text.secondary', sx: { p: 1 } }, '暂无可用角色')
                  )
                ),
                React.createElement(Stack, { direction: 'row', justifyContent: 'flex-end', mt: 2 },
                  React.createElement(Button, {
                    variant: 'contained',
                    onClick: handleSaveRoles,
                    disabled: savingRoles
                  }, savingRoles ? '保存中...' : '保存角色')
                )
              ),
              React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                React.createElement(Typography, { variant: 'subtitle1', mb: 1 }, '模块权限'),
                React.createElement(Box, {
                  sx: {
                    border: '1px solid #e5e7eb',
                    borderRadius: 2,
                    maxHeight: 320,
                    overflowY: 'auto',
                    p: 1
                  }
                }, moduleTree.length
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
                React.createElement(Box, {
                  sx: {
                    border: '1px solid #e5e7eb',
                    borderRadius: 2,
                    maxHeight: 320,
                    overflowY: 'auto',
                    p: 1
                  }
                }, permissionTree.length
                  ? renderTreeNodes(permissionTree, selectedPermissionIds, handleTogglePermission)
                  : React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '暂无权限数据')
                ),
                React.createElement(Stack, { direction: 'row', justifyContent: 'flex-end', mt: 2 },
                  React.createElement(Button, {
                    variant: 'contained',
                    onClick: handleSavePermissions,
                    disabled: savingPermissions
                  }, savingPermissions ? '保存中...' : '保存操作权限')
                )
              ),
              React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                React.createElement(Stack, { direction: 'row', alignItems: 'center', justifyContent: 'space-between', mb: 1 },
                  React.createElement(Typography, { variant: 'subtitle1' }, '组织授权范围'),
                  organizeScopeLoading ? React.createElement(CircularProgress, { size: 18 }) : null
                ),
                React.createElement(Box, {
                  sx: {
                    border: '1px solid #e5e7eb',
                    borderRadius: 2,
                    maxHeight: 320,
                    overflowY: 'auto',
                    p: 1
                  }
                }, organizeTree.length
                  ? renderTreeNodes(organizeTree, selectedOrganizeIds, handleToggleOrganize)
                  : React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '暂无组织数据')
                ),
                React.createElement(Stack, { direction: 'row', justifyContent: 'flex-end', mt: 2 },
                  React.createElement(Button, {
                    variant: 'contained',
                    onClick: handleSaveOrganizeScope,
                    disabled: savingOrganizeScope
                  }, savingOrganizeScope ? '保存中...' : '保存组织范围')
                )
              ),
              React.createElement(Box, { sx: { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } } },
                React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                  React.createElement(Stack, { direction: 'row', alignItems: 'center', justifyContent: 'space-between' },
                    React.createElement(Typography, { variant: 'subtitle1' }, '角色概览'),
                    detailLoading ? React.createElement(CircularProgress, { size: 18 }) : null
                  ),
                  renderTagList(detail.roles?.map((role) => ({
                    id: role.ID,
                    name: role.REALNAME || role.CODE
                  })), '暂无角色')
                ),
                React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                  React.createElement(Stack, { direction: 'row', alignItems: 'center', justifyContent: 'space-between' },
                    React.createElement(Typography, { variant: 'subtitle1' }, '模块概览'),
                    detailLoading ? React.createElement(CircularProgress, { size: 18 }) : null
                  ),
                  renderTagList(detail.modules, '暂无模块权限')
                ),
                React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
                  React.createElement(Stack, { direction: 'row', alignItems: 'center', justifyContent: 'space-between' },
                    React.createElement(Typography, { variant: 'subtitle1' }, '组织范围概览'),
                    organizeScopeLoading ? React.createElement(CircularProgress, { size: 18 }) : null
                  ),
                  renderTagList(organizeTagList, '暂无组织范围')
                ),
                React.createElement(Paper, { sx: { p: 2, borderRadius: 3, gridColumn: { xs: 'span 1', md: 'span 2' } } },
                  React.createElement(Stack, { direction: 'row', alignItems: 'center', justifyContent: 'space-between' },
                    React.createElement(Typography, { variant: 'subtitle1' }, '直接操作权限概览'),
                    detailLoading ? React.createElement(CircularProgress, { size: 18 }) : null
                  ),
                  renderTagList(detail.permissionItems?.map((item) => ({
                    id: item.ID,
                    name: item.FULLNAME || item.CODE
                  })), '暂无直接授权的操作权限')
                )
              )
            )
          : null
      ),
      React.createElement(Snackbar, { open: notify.open, autoHideDuration: 3200, onClose: closeNotify },
        React.createElement(Alert, { onClose: closeNotify, severity: notify.severity, sx: { width: '100%' } }, notify.message)
      )
    );
  };

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['user-permission-admin'] = UserPermissionAdminPage;
})();
