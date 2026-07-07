/**
 * organizeAdmin.js —— 由 views/admin-pages/organizeAdmin.jade 提取。
 * 懒加载：用户切换到「organize-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const OrganizeAdminPage = () => {
    const [organizes, setOrganizes] = useState([]);
    const [organizeTree, setOrganizeTree] = useState([]);
    const [selectedTreeId, setSelectedTreeId] = useState(null);
    const [selectedRow, setSelectedRow] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [dialogState, setDialogState] = useState({ open: false, mode: 'create' });
    const [formValues, setFormValues] = useState(defaultOrganizeForm());
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadOrganizes = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await fetch('/organize-admin/organizes');
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '加载组织机构失败');
        }
        const list = result.data || [];
        setOrganizes(list);
        setOrganizeTree(buildOrganizeTree(list));
      } catch (err) {
        setError(err.message || '加载组织机构失败');
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      loadOrganizes();
    }, [loadOrganizes]);

    useEffect(() => {
      if (selectedRow && !organizes.some((item) => item.id === selectedRow.id)) {
        setSelectedRow(null);
      }
    }, [organizes, selectedRow]);

    const tableRows = useMemo(() => {
      if (selectedTreeId === null) {
        return organizes.filter((item) => !item.parentId);
      }
      return organizes.filter((item) => item.parentId === selectedTreeId);
    }, [organizes, selectedTreeId]);

    const selectedNode = useMemo(() => {
      if (selectedRow) {
        return organizes.find((item) => item.id === selectedRow.id);
      }
      if (selectedTreeId) {
        return organizes.find((item) => item.id === selectedTreeId);
      }
      return null;
    }, [organizes, selectedRow, selectedTreeId]);

    const handleSelectTree = (id) => {
      setSelectedTreeId(id);
      setSelectedRow(null);
    };

    const handleOpenCreate = () => {
      setFormValues(defaultOrganizeForm(selectedTreeId || ''));
      setDialogState({ open: true, mode: 'create' });
    };

    const handleOpenEdit = () => {
      if (!selectedRow) return;
      setFormValues(mapOrganizeToFormValues(selectedRow));
      setDialogState({ open: true, mode: 'edit' });
    };

    const handleCloseDialog = () => {
      setDialogState({ open: false, mode: 'create' });
      setFormValues(defaultOrganizeForm(selectedTreeId || ''));
    };

    const handleSave = async () => {
      setSaving(true);
      try {
        const payload = serializeOrganizeForm(formValues);
        if (!payload.fullName) {
          throw new Error('请输入组织名称');
        }
        const isEdit = dialogState.mode === 'edit';
        const url = isEdit
          ? `/organize-admin/organizes/${formValues.id}`
          : '/organize-admin/organizes';
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
        await loadOrganizes();
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '保存失败' });
      } finally {
        setSaving(false);
      }
    };

    const handleDelete = async () => {
      if (!selectedRow) return;
      setSaving(true);
      try {
        const resp = await fetch(`/organize-admin/organizes/${selectedRow.id}`, {
          method: 'DELETE'
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '删除失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '组织已删除' });
        setSelectedRow(null);
        await loadOrganizes();
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '删除失败' });
      } finally {
        setSaving(false);
        setConfirmDelete(false);
      }
    };

    return React.createElement(Box, {
      sx: {
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', lg: '320px 1fr' }
      }
    },
    React.createElement(Paper, { sx: { p: 2.5, borderRadius: 3, height: 'fit-content' } },
      React.createElement(Typography, { variant: 'h6', mb: 1 }, '组织结构'),
      React.createElement(Typography, { variant: 'body2', color: 'text.secondary', mb: 2 }, '选择节点查看下级组织'),
      React.createElement(Divider, { sx: { mb: 2 } }),
      React.createElement(OrganizeTree, {
        data: organizeTree,
        selectedId: selectedTreeId,
        onSelect: handleSelectTree
      })
    ),
    React.createElement(Box, null,
      error ? React.createElement(Alert, { severity: 'error', sx: { mb: 2 } }, error) : null,
      React.createElement(Paper, { sx: { p: 2, borderRadius: 3, mb: 2 } },
        React.createElement(Stack, {
          direction: { xs: 'column', md: 'row' },
          spacing: 1.5,
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', md: 'center' }
        },
        React.createElement(Box, null,
          React.createElement(Typography, { variant: 'subtitle1' }, '组织机构管理'),
          React.createElement(Typography, {
            variant: 'caption',
            color: 'text.secondary'
          }, selectedTreeId ? '当前上级：' + (selectedNode?.fullName || '') : '当前显示根节点')
        ),
        React.createElement(Stack, { direction: 'row', spacing: 1, flexWrap: 'wrap' },
          React.createElement(Button, { variant: 'contained', size: 'small', onClick: handleOpenCreate }, '新增'),
          React.createElement(Button, {
            variant: 'outlined',
            size: 'small',
            disabled: !selectedRow,
            onClick: handleOpenEdit
          }, '编辑'),
          React.createElement(Button, {
            variant: 'outlined',
            size: 'small',
            color: 'error',
            disabled: !selectedRow,
            onClick: () => setConfirmDelete(true)
          }, '删除'),
          React.createElement(Button, {
            variant: 'text',
            size: 'small',
            onClick: loadOrganizes,
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
                React.createElement(TableCell, null, '名称'),
                React.createElement(TableCell, null, '编码'),
                React.createElement(TableCell, null, '类别'),
                React.createElement(TableCell, null, '排序'),
                React.createElement(TableCell, null, '状态')
              )
            ),
            React.createElement(TableBody, null,
              tableRows.map((row) =>
                React.createElement(TableRow, {
                  key: row.id,
                  hover: true,
                  selected: selectedRow?.id === row.id,
                  onClick: () => setSelectedRow(row),
                  sx: { cursor: 'pointer' }
                },
                React.createElement(TableCell, null, row.fullName || '-'),
                React.createElement(TableCell, null, row.code || '-'),
                React.createElement(TableCell, null, row.category || '-'),
                React.createElement(TableCell, null, row.sortCode || 0),
                React.createElement(TableCell, null,
                  React.createElement(Chip, {
                    label: row.enabled ? '启用' : '停用',
                    size: 'small',
                    color: row.enabled ? 'success' : 'default',
                    variant: row.enabled ? 'filled' : 'outlined'
                  })
                )
                )
              )
            )
          )
        ),
        !tableRows.length
          ? React.createElement(Box, { sx: { p: 4, textAlign: 'center', color: 'text.secondary' } }, '此层级暂无下级组织')
          : null
      ),
      selectedNode
        ? React.createElement(Paper, { sx: { p: 2, mt: 2, borderRadius: 3 } },
            React.createElement(Typography, { variant: 'subtitle1', mb: 1 }, '组织信息'),
            React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '名称：' + selectedNode.fullName),
            React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '编码：' + (selectedNode.code || '—')),
            React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '类别：' + (selectedNode.category || '—')),
            React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '描述：' + (selectedNode.description || '—'))
          )
        : null
    ),
    React.createElement(Dialog, {
      open: dialogState.open,
      onClose: handleCloseDialog,
      maxWidth: 'sm',
      fullWidth: true
    },
      React.createElement(DialogTitle, null, dialogState.mode === 'edit' ? '编辑组织' : '新增组织'),
      React.createElement(DialogContent, null,
        React.createElement(Stack, { spacing: 2, sx: { mt: 1 } },
          React.createElement(TextField, {
            label: '上级组织ID',
            value: formValues.parentId,
            disabled: true
          }),
          React.createElement(TextField, {
            label: '组织名称',
            required: true,
            value: formValues.fullName,
            onChange: (event) => setFormValues((prev) => ({ ...prev, fullName: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '简称',
            value: formValues.shortName,
            onChange: (event) => setFormValues((prev) => ({ ...prev, shortName: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '编码',
            value: formValues.code,
            onChange: (event) => setFormValues((prev) => ({ ...prev, code: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '类别',
            value: formValues.category,
            onChange: (event) => setFormValues((prev) => ({ ...prev, category: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '排序码',
            type: 'number',
            value: formValues.sortCode,
            onChange: (event) => setFormValues((prev) => ({ ...prev, sortCode: event.target.value }))
          }),
          React.createElement(TextField, {
            label: '描述',
            multiline: true,
            minRows: 2,
            value: formValues.description,
            onChange: (event) => setFormValues((prev) => ({ ...prev, description: event.target.value }))
          }),
          React.createElement(FormControlLabel, {
            control: React.createElement(Switch, {
              checked: formValues.enabled,
              onChange: (event) => setFormValues((prev) => ({ ...prev, enabled: event.target.checked }))
            }),
            label: '启用'
          })
        )
      ),
      React.createElement(DialogActions, null,
        React.createElement(Button, { onClick: handleCloseDialog }, '取消'),
        React.createElement(Button, { variant: 'contained', onClick: handleSave, disabled: saving }, '保存')
      )
    ),
    React.createElement(Dialog, { open: confirmDelete, onClose: () => setConfirmDelete(false) },
      React.createElement(DialogTitle, null, '删除组织'),
      React.createElement(DialogContent, null,
        React.createElement(Typography, null, '确定删除所选组织吗？')
      ),
      React.createElement(DialogActions, null,
        React.createElement(Button, { onClick: () => setConfirmDelete(false) }, '取消'),
        React.createElement(Button, { color: 'error', onClick: handleDelete, disabled: saving }, '删除')
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

  const defaultOrganizeForm = (parentId = '') => ({
    id: '',
    parentId: parentId || '',
    fullName: '',
    shortName: '',
    code: '',
    category: '',
    description: '',
    sortCode: '',
    enabled: true
  });

  const mapOrganizeToFormValues = (record) =>
    record
      ? {
          id: record.id,
          parentId: record.parentId || '',
          fullName: record.fullName || '',
          shortName: record.shortName || '',
          code: record.code || '',
          category: record.category || '',
          description: record.description || '',
          sortCode: record.sortCode ?? '',
          enabled: !!record.enabled
        }
      : defaultOrganizeForm();

  const serializeOrganizeForm = (values) => ({
    parentId: values.parentId || null,
    fullName: values.fullName?.trim(),
    shortName: values.shortName?.trim() || null,
    code: values.code?.trim() || null,
    category: values.category?.trim() || null,
    description: values.description?.trim() || null,
    sortCode: values.sortCode === '' ? null : Number(values.sortCode),
    enabled: !!values.enabled
  });

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['organize-admin'] = OrganizeAdminPage;
})();
