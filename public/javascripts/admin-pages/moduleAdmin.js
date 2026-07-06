/**
 * moduleAdmin.js —— 由 views/admin-pages/moduleAdmin.jade 提取。
 * 懒加载：用户切换到「module-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const ModuleAdminPage = () => {
    const [modules, setModules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [activeRow, setActiveRow] = useState(null);
    const [dialogState, setDialogState] = useState({ open: false, mode: 'create' });
    const [formValues, setFormValues] = useState(createDefaultForm());
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadModules = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await fetch('/module-admin/modules');
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '加载模块失败');
        }
        setModules(result.data || []);
      } catch (err) {
        setError(err.message || '加载模块失败');
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      loadModules();
    }, [loadModules]);

    useEffect(() => {
      if (activeRow && !modules.some((item) => item.id === activeRow.id)) {
        setActiveRow(null);
      }
      if (selectedNodeId && !modules.some((item) => item.id === selectedNodeId)) {
        setSelectedNodeId(null);
      }
    }, [modules, activeRow, selectedNodeId]);

    const orderedModules = useMemo(() => {
      return [...modules].sort((a, b) => (a.sortCode || 0) - (b.sortCode || 0));
    }, [modules]);

    const treeData = useMemo(() => buildModuleHierarchy(orderedModules), [orderedModules]);

    const tableRows = useMemo(() => {
      if (selectedNodeId === null) {
        return orderedModules.filter((item) => !item.parentId);
      }
      return orderedModules.filter((item) => item.parentId === selectedNodeId);
    }, [orderedModules, selectedNodeId]);

    const handleOpenCreate = () => {
      setFormValues(createDefaultForm(selectedNodeId));
      setDialogState({ open: true, mode: 'create' });
    };

    const handleOpenEdit = () => {
      if (!activeRow) return;
      setFormValues(mapRecordToFormValues(activeRow));
      setDialogState({ open: true, mode: 'edit' });
    };

    const handleCloseDialog = () => {
      setDialogState({ open: false, mode: 'create' });
      setFormValues(createDefaultForm(selectedNodeId));
    };

    const handleSave = async () => {
      setSaving(true);
      try {
        const payload = serializeFormValues(formValues);
        if (!payload.code || !payload.fullName) {
          throw new Error('请填写模块编码和名称');
        }
        const isEdit = dialogState.mode === 'edit';
        const url = isEdit ? `/module-admin/modules/${formValues.id}` : '/module-admin/modules';
        const resp = await fetch(url, {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '保存成功' });
        handleCloseDialog();
        await loadModules();
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '保存失败' });
      } finally {
        setSaving(false);
      }
    };

    const handleDelete = async () => {
      if (!activeRow) return;
      setSaving(true);
      try {
        const resp = await fetch(`/module-admin/modules/${activeRow.id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '删除失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '模块已删除' });
        setActiveRow(null);
        await loadModules();
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '删除失败' });
      } finally {
        setSaving(false);
        setConfirmDelete(false);
      }
    };

    if (loading && !modules.length) {
      return React.createElement(Box, {
        sx: {
          minHeight: 360,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }
      }, React.createElement(CircularProgress, { size: 32 }));
    }

    return React.createElement(Box, {
      sx: {
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', lg: '320px 1fr' }
      }
    },
    React.createElement(Paper, { sx: { p: 2.5, borderRadius: 3, height: 'fit-content' } },
      React.createElement(Typography, { variant: 'h6', mb: 1 }, '模块目录'),
      React.createElement(Typography, { variant: 'body2', color: 'text.secondary', mb: 2 },
        '通过树形结构快速定位并筛选模块。'
      ),
      React.createElement(Divider, { sx: { mb: 2 } }),
      React.createElement(ModuleTree, {
        data: treeData,
        selectedId: selectedNodeId,
        onSelect: setSelectedNodeId
      })
    ),
    React.createElement(Box, null,
      error ? React.createElement(Alert, { severity: 'error', sx: { mb: 2 } }, error) : null,
      React.createElement(Paper, { sx: { p: 2, borderRadius: 3, mb: 2 } },
        React.createElement(Stack, {
          direction: { xs: 'column', sm: 'row' },
          spacing: 1.5,
          alignItems: { xs: 'stretch', sm: 'center' },
          justifyContent: 'space-between'
        },
        React.createElement(Box, null,
          React.createElement(Typography, { variant: 'subtitle1' }, '模块管理'),
          React.createElement(Typography, { variant: 'caption', color: 'text.secondary' },
            '共 ' + modules.length + ' 个模块' + (selectedNodeId ? '，当前定位：' + selectedNodeId : '')
          )
        ),
        React.createElement(Stack, { direction: 'row', spacing: 1, flexWrap: 'wrap' },
          React.createElement(Button, { variant: 'contained', size: 'small', onClick: handleOpenCreate }, '新建模块'),
          React.createElement(Button, {
            variant: 'outlined',
            size: 'small',
            disabled: !activeRow,
            onClick: handleOpenEdit
          }, '编辑'),
          React.createElement(Button, {
            variant: 'outlined',
            size: 'small',
            color: 'error',
            disabled: !activeRow,
            onClick: () => setConfirmDelete(true)
          }, '删除'),
          React.createElement(Button, {
            variant: 'text',
            size: 'small',
            onClick: loadModules,
            disabled: loading
          }, '刷新')
        )
        )
      ),
      React.createElement(Paper, { sx: { borderRadius: 3 } },
        React.createElement(TableContainer, null,
          React.createElement(Table, { size: 'small' },
            React.createElement(TableHead, null,
              React.createElement(TableRow, null,
                React.createElement(TableCell, null, '模块名称'),
                React.createElement(TableCell, null, '编码'),
                React.createElement(TableCell, null, '分类'),
                React.createElement(TableCell, null, '类型'),
                React.createElement(TableCell, null, '状态'),
                React.createElement(TableCell, null, '路径')
              )
            ),
            React.createElement(TableBody, null,
              tableRows.map((row) =>
                React.createElement(TableRow, {
                  key: row.id,
                  hover: true,
                  selected: activeRow?.id === row.id,
                  onClick: () => setActiveRow(row),
                  sx: { cursor: 'pointer' }
                },
                React.createElement(TableCell, null,
                  React.createElement(Typography, { variant: 'body2', fontWeight: 600 }, row.fullName || row.code),
                  row.description ? React.createElement(Typography, { variant: 'caption', color: 'text.secondary' }, row.description) : null
                ),
                React.createElement(TableCell, null, row.code || '-'),
                React.createElement(TableCell, null, row.category || '-'),
                React.createElement(TableCell, null, moduleTypeMap[row.moduleType] || '模块'),
                React.createElement(TableCell, null,
                  React.createElement(Stack, { direction: 'row', spacing: 0.5, flexWrap: 'wrap' },
                    React.createElement(Chip, {
                      label: row.enabled ? '启用' : '停用',
                      size: 'small',
                      color: row.enabled ? 'success' : 'default',
                      variant: row.enabled ? 'filled' : 'outlined'
                    }),
                    row.isPublic
                      ? React.createElement(Chip, { label: '公开', size: 'small', color: 'info', variant: 'outlined' })
                      : null,
                    row.isMenu
                      ? React.createElement(Chip, { label: '菜单', size: 'small', variant: 'outlined' })
                      : null
                  )
                ),
                React.createElement(TableCell, null,
                  React.createElement(Typography, { variant: 'body2' }, row.navigateUrl || '#')
                )
                )
              )
            )
          )
        ),
        !tableRows.length
          ? React.createElement(Box, { sx: { p: 4, textAlign: 'center', color: 'text.secondary' } },
              selectedNodeId ? '此节点暂无子模块' : '暂无根级模块，请先创建。'
            )
          : null
      )
    ),
    React.createElement(Dialog, {
      open: dialogState.open,
      onClose: handleCloseDialog,
      maxWidth: 'sm',
      fullWidth: true
    },
      React.createElement(DialogTitle, null, dialogState.mode === 'edit' ? '编辑模块' : '新建模块'),
      React.createElement(DialogContent, null,
        React.createElement(Stack, { spacing: 2, sx: { mt: 1 } },
          React.createElement(TextField, {
            label: '模块名称',
            required: true,
            value: formValues.fullName,
            onChange: (event) => setFormValues((prev) => ({ ...prev, fullName: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '模块编码',
            required: true,
            value: formValues.code,
            onChange: (event) => setFormValues((prev) => ({ ...prev, code: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '上级模块ID',
            value: formValues.parentId,
            onChange: (event) => setFormValues((prev) => ({ ...prev, parentId: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '模块分类',
            value: formValues.category,
            onChange: (event) => setFormValues((prev) => ({ ...prev, category: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '模块类型',
            select: true,
            value: formValues.moduleType,
            onChange: (event) => setFormValues((prev) => ({ ...prev, moduleType: event.target.value })),
            children: Object.keys(moduleTypeMap).map((key) =>
              React.createElement(MenuItem, { key: key, value: Number(key) }, moduleTypeMap[key])
            )
          }),
          React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 2 },
            React.createElement(TextField, {
              label: 'Web 路径',
              value: formValues.navigateUrl,
              onChange: (event) => setFormValues((prev) => ({ ...prev, navigateUrl: event.target.value }))
            }),
            React.createElement(TextField, {
              label: 'MVC 路径',
              value: formValues.mvcNavigateUrl,
              onChange: (event) => setFormValues((prev) => ({ ...prev, mvcNavigateUrl: event.target.value }))
            })
          ),
          React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 2 },
            React.createElement(TextField, {
              label: '图标类名',
              value: formValues.iconCss,
              onChange: (event) => setFormValues((prev) => ({ ...prev, iconCss: event.target.value }))
            }),
            React.createElement(TextField, {
              label: '排序码',
              type: 'number',
              value: formValues.sortCode,
              onChange: (event) => setFormValues((prev) => ({ ...prev, sortCode: event.target.value }))
            })
          ),
          React.createElement(TextField, {
            label: '描述',
            multiline: true,
            minRows: 2,
            value: formValues.description,
            onChange: (event) => setFormValues((prev) => ({ ...prev, description: event.target.value }))
          }),
          React.createElement(Stack, { direction: 'row', spacing: 1, flexWrap: 'wrap' },
            React.createElement(FormControlLabel, {
              control: React.createElement(Switch, {
                checked: formValues.enabled,
                onChange: (event) => setFormValues((prev) => ({ ...prev, enabled: event.target.checked }))
              }),
              label: '启用'
            }),
            React.createElement(FormControlLabel, {
              control: React.createElement(Switch, {
                checked: formValues.isPublic,
                onChange: (event) => setFormValues((prev) => ({ ...prev, isPublic: event.target.checked }))
              }),
              label: '公开'
            }),
            React.createElement(FormControlLabel, {
              control: React.createElement(Switch, {
                checked: formValues.isMenu,
                onChange: (event) => setFormValues((prev) => ({ ...prev, isMenu: event.target.checked }))
              }),
              label: '菜单'
            }),
            React.createElement(FormControlLabel, {
              control: React.createElement(Switch, {
                checked: formValues.allowEdit,
                onChange: (event) => setFormValues((prev) => ({ ...prev, allowEdit: event.target.checked }))
              }),
              label: '允许编辑'
            }),
            React.createElement(FormControlLabel, {
              control: React.createElement(Switch, {
                checked: formValues.allowDelete,
                onChange: (event) => setFormValues((prev) => ({ ...prev, allowDelete: event.target.checked }))
              }),
              label: '允许删除'
            }),
            React.createElement(FormControlLabel, {
              control: React.createElement(Switch, {
                checked: formValues.expand,
                onChange: (event) => setFormValues((prev) => ({ ...prev, expand: event.target.checked }))
              }),
              label: '展开'
            })
          )
        )
      ),
      React.createElement(DialogActions, null,
        React.createElement(Button, { onClick: handleCloseDialog }, '取消'),
        React.createElement(Button, { variant: 'contained', onClick: handleSave, disabled: saving }, '保存')
      )
    ),
    React.createElement(Dialog, { open: confirmDelete, onClose: () => setConfirmDelete(false) },
      React.createElement(DialogTitle, null, '删除模块'),
      React.createElement(DialogContent, null,
        React.createElement(Typography, null, '确定删除所选模块吗？该操作会将其标记为删除。')
      ),
      React.createElement(DialogActions, null,
        React.createElement(Button, { onClick: () => setConfirmDelete(false) }, '取消'),
        React.createElement(Button, {
          color: 'error',
          onClick: handleDelete,
          disabled: saving
        }, '删除')
      )
    ),
    React.createElement(Snackbar, {
      open: notify.open,
      autoHideDuration: 3200,
      onClose: () => setNotify((prev) => ({ ...prev, open: false }))
    },
      React.createElement(Alert, {
        onClose: () => setNotify((prev) => ({ ...prev, open: false })),
        severity: notify.severity,
        sx: { width: '100%' }
      }, notify.message)
    )
    );
  };
  const buildOrganizeTree = (records = []) => {
    const nodes = new Map();
    records.forEach((item) => {
      nodes.set(item.id, { ...item, children: [] });
    });
    const sortFn = (a, b) => (a.sortCode || 0) - (b.sortCode || 0);
    const roots = [];
    nodes.forEach((node) => {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    });
    nodes.forEach((node) => node.children.sort(sortFn));
    return roots.sort(sortFn);
  };

  const OrganizeTreeNode = ({ node, selectedId, onSelect, depth = 0 }) => {
    const hasChildren = node.children && node.children.length > 0;
    const [open, setOpen] = useState(depth < 1);
    const handleClick = () => {
      onSelect(node.id);
      if (hasChildren) {
        setOpen((prev) => !prev);
      }
    };
    return React.createElement(React.Fragment, null,
      React.createElement(ListItemButton, {
        onClick: handleClick,
        selected: selectedId === node.id,
        sx: {
          pl: 2 + depth * 1.5,
          borderRadius: 1.5,
          mb: 0.25,
          '&.Mui-selected': { backgroundColor: 'rgba(99,102,241,0.15)' }
        }
      },
      React.createElement(ListItemText, {
        primary: node.fullName || node.code,
        secondary: node.code
      })
      ),
      hasChildren ? React.createElement(Collapse, { in: open, timeout: 'auto', unmountOnExit: true },
        React.createElement(List, { disablePadding: true },
          node.children.map((child) =>
            React.createElement(OrganizeTreeNode, {
              key: child.id,
              node: child,
              selectedId,
              onSelect,
              depth: depth + 1
            })
          )
        )
      ) : null
    );
  };

  const OrganizeTree = ({ data = [], selectedId, onSelect }) => {
    return React.createElement(List, { component: 'nav' },
      React.createElement(ListItemButton, {
        selected: selectedId === null,
        onClick: () => onSelect(null),
        sx: { borderRadius: 1.5, mb: 0.5 }
      },
      React.createElement(ListItemText, { primary: '全部组织' })
      ),
      data.map((node) =>
        React.createElement(OrganizeTreeNode, {
          key: node.id,
          node,
          selectedId,
          onSelect,
          depth: 0
        })
      )
    );
  };

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['module-admin'] = ModuleAdminPage;
})();
