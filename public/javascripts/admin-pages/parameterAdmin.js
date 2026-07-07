/**
 * parameterAdmin.js —— 由 views/admin-pages/parameterAdmin.jade 提取。
 * 懒加载：用户切换到「parameter-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const createDefaultParameter = () => ({
    id: '',
    categoryKey: '',
    parameterId: '',
    parameterCode: '',
    parameterContent: '',
    description: '',
    allowEdit: true,
    allowDelete: true,
    enabled: true,
    worked: false
  });

  const ParameterAdminPage = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [selectedRow, setSelectedRow] = useState(null);
    const [dialogState, setDialogState] = useState({ open: false, mode: 'create' });
    const [formValues, setFormValues] = useState(createDefaultParameter());
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });

    const closeNotify = () => setNotify((prev) => ({ ...prev, open: false }));

    const loadItems = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (keyword) {
          params.append('keyword', keyword);
        }
        const resp = await fetch(`/parameter-admin/parameters?${params.toString()}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '获取系统参数失败');
        }
        setItems(result.data || []);
        setTotal(result.total || 0);
        if (selectedRow && !(result.data || []).find((item) => item.id === selectedRow.id)) {
          setSelectedRow(null);
        }
      } catch (err) {
        setError(err.message || '获取系统参数失败');
      } finally {
        setLoading(false);
      }
    }, [page, pageSize, keyword, selectedRow]);

    useEffect(() => {
      loadItems();
    }, [loadItems]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const handleSearch = () => {
      setKeyword(searchInput.trim());
      setPage(1);
    };

    const handleOpenCreate = () => {
      setFormValues(createDefaultParameter());
      setDialogState({ open: true, mode: 'create' });
    };

    const handleOpenEdit = async () => {
      if (!selectedRow) return;
      try {
        const resp = await fetch(`/parameter-admin/parameters/${selectedRow.id}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '获取参数详情失败');
        }
        setFormValues({
          id: result.data.id,
          categoryKey: result.data.categoryKey,
          parameterId: result.data.parameterId,
          parameterCode: result.data.parameterCode,
          parameterContent: result.data.parameterContent,
          description: result.data.description || '',
          allowEdit: !!result.data.allowEdit,
          allowDelete: !!result.data.allowDelete,
          enabled: !!result.data.enabled,
          worked: !!result.data.worked
        });
        setDialogState({ open: true, mode: 'edit' });
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '获取参数详情失败' });
      }
    };

    const handleCloseDialog = () => {
      setDialogState({ open: false, mode: 'create' });
      setFormValues(createDefaultParameter());
    };

    const normalizePayload = () => ({
      categoryKey: formValues.categoryKey.trim(),
      parameterId: formValues.parameterId.trim(),
      parameterCode: formValues.parameterCode.trim(),
      parameterContent: formValues.parameterContent.trim(),
      description: formValues.description.trim(),
      allowEdit: !!formValues.allowEdit,
      allowDelete: !!formValues.allowDelete,
      enabled: !!formValues.enabled,
      worked: !!formValues.worked
    });

    const handleSave = async () => {
      const payload = normalizePayload();
      if (!payload.categoryKey || !payload.parameterId || !payload.parameterCode) {
        setNotify({ open: true, severity: 'error', message: '分类、参数ID与编码均不能为空' });
        return;
      }
      setSaving(true);
      try {
        const isEdit = dialogState.mode === 'edit';
        const url = isEdit ? `/parameter-admin/parameters/${formValues.id}` : '/parameter-admin/parameters';
        const resp = await fetch(url, {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '已保存' });
        handleCloseDialog();
        await loadItems();
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '保存失败' });
      } finally {
        setSaving(false);
      }
    };

    const handleDelete = async () => {
      if (!selectedRow) return;
      setSaving(true);
      try {
        const resp = await fetch(`/parameter-admin/parameters/${selectedRow.id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '删除失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '已删除' });
        setSelectedRow(null);
        await loadItems();
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '删除失败' });
      } finally {
        setSaving(false);
        setConfirmDelete(false);
      }
    };

    const BooleanChip = ({ value }) =>
      React.createElement(Chip, {
        size: 'small',
        label: value ? '是' : '否',
        color: value ? 'success' : 'default',
        variant: value ? 'filled' : 'outlined'
      });

    return React.createElement(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 2 } },
      React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
        React.createElement(Stack, {
          direction: { xs: 'column', md: 'row' },
          spacing: 1.5,
          alignItems: { xs: 'stretch', md: 'center' },
          justifyContent: 'space-between'
        },
          React.createElement(Stack, { spacing: 0.5 },
            React.createElement(Typography, { variant: 'h6' }, '系统参数'),
            React.createElement(Typography, { variant: 'caption', color: 'text.secondary' }, `共 ${total} 条记录`)
          ),
          React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 1 },
            React.createElement(TextField, {
              size: 'small',
              label: '搜索（分类/ID/编码/描述）',
              value: searchInput,
              onChange: (event) => setSearchInput(event.target.value)
            }),
            React.createElement(Button, { variant: 'contained', onClick: handleSearch }, '搜索'),
            React.createElement(Button, { variant: 'outlined', onClick: handleOpenCreate }, '新增'),
            React.createElement(Button, {
              variant: 'outlined',
              disabled: !selectedRow,
              onClick: handleOpenEdit
            }, '编辑'),
            React.createElement(Button, {
              variant: 'outlined',
              color: 'error',
              disabled: !selectedRow,
              onClick: () => setConfirmDelete(true)
            }, '删除'),
            React.createElement(Button, { variant: 'text', onClick: loadItems }, '刷新')
          )
        )
      ),
      error ? React.createElement(Alert, { severity: 'error', sx: { mb: 2 } }, error) : null,
      React.createElement(Paper, { sx: { borderRadius: 3, overflow: 'hidden' } },
        loading ? React.createElement(LinearProgress, null) : null,
        React.createElement(TableContainer, null,
          React.createElement(Table, { size: 'small' },
            React.createElement(TableHead, null,
              React.createElement(TableRow, null,
                React.createElement(TableCell, null, '分类'),
                React.createElement(TableCell, null, '参数ID'),
                React.createElement(TableCell, null, '编码'),
                React.createElement(TableCell, null, '值'),
                React.createElement(TableCell, null, '可编辑'),
                React.createElement(TableCell, null, '可删除'),
                React.createElement(TableCell, null, '启用'),
                React.createElement(TableCell, null, '生效'),
                React.createElement(TableCell, null, '描述')
              )
            ),
            React.createElement(TableBody, null,
              items.length
                ? items.map((item) =>
                    React.createElement(TableRow, {
                      key: item.id,
                      hover: true,
                      selected: selectedRow?.id === item.id,
                      onClick: () => setSelectedRow(item),
                      sx: { cursor: 'pointer' }
                    },
                      React.createElement(TableCell, null, item.categoryKey || '-'),
                      React.createElement(TableCell, null, item.parameterId || '-'),
                      React.createElement(TableCell, null, item.parameterCode || '-'),
                      React.createElement(TableCell, null, item.parameterContent || '-'),
                      React.createElement(TableCell, null, React.createElement(BooleanChip, { value: item.allowEdit })),
                      React.createElement(TableCell, null, React.createElement(BooleanChip, { value: item.allowDelete })),
                      React.createElement(TableCell, null, React.createElement(BooleanChip, { value: item.enabled })),
                      React.createElement(TableCell, null, React.createElement(BooleanChip, { value: item.worked })),
                      React.createElement(TableCell, null, item.description || '-')
                    )
                  )
                : React.createElement(TableRow, null,
                    React.createElement(TableCell, {
                      colSpan: 9,
                      align: 'center',
                      sx: { py: 4, color: 'text.secondary' }
                    }, loading ? '正在加载...' : '暂无数据')
                  )
            )
          )
        ),
        React.createElement(Divider, null),
        React.createElement(Box, {
          sx: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            p: 2,
            gap: 1.5
          }
        },
          React.createElement(TextField, {
            select: true,
            size: 'small',
            label: '每页',
            value: pageSize,
            onChange: (event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            },
            sx: { minWidth: 90 }
          },
            [10, 20, 50, 100].map((size) =>
              React.createElement(MenuItem, { key: size, value: size }, `${size} 条`)
            )
          ),
          React.createElement(Pagination, {
            count: totalPages,
            page,
            onChange: (event, value) => setPage(value),
            color: 'primary'
          })
        )
      ),
      React.createElement(Dialog, { open: dialogState.open, onClose: handleCloseDialog, maxWidth: 'sm', fullWidth: true },
        React.createElement(DialogTitle, null, dialogState.mode === 'edit' ? '编辑参数' : '新增参数'),
        React.createElement(DialogContent, null,
          React.createElement(Stack, { spacing: 2, mt: 1 },
            React.createElement(TextField, {
              label: '分类',
              required: true,
              value: formValues.categoryKey,
              onChange: (event) => setFormValues((prev) => ({ ...prev, categoryKey: event.target.value }))
            }),
            React.createElement(TextField, {
              label: '参数ID',
              required: true,
              value: formValues.parameterId,
              onChange: (event) => setFormValues((prev) => ({ ...prev, parameterId: event.target.value }))
            }),
            React.createElement(TextField, {
              label: '编码',
              required: true,
              value: formValues.parameterCode,
              onChange: (event) => setFormValues((prev) => ({ ...prev, parameterCode: event.target.value }))
            }),
            React.createElement(TextField, {
              label: '值',
              value: formValues.parameterContent,
              onChange: (event) => setFormValues((prev) => ({ ...prev, parameterContent: event.target.value }))
            }),
            React.createElement(TextField, {
              label: '描述',
              multiline: true,
              minRows: 2,
              value: formValues.description,
              onChange: (event) => setFormValues((prev) => ({ ...prev, description: event.target.value }))
            }),
            React.createElement(Stack, { direction: 'row', spacing: 2, flexWrap: 'wrap' },
              [
                { label: '可编辑', field: 'allowEdit' },
                { label: '可删除', field: 'allowDelete' },
                { label: '启用', field: 'enabled' },
                { label: '生效', field: 'worked' }
              ].map((item) =>
                React.createElement(FormControlLabel, {
                  key: item.field,
                  control: React.createElement(Switch, {
                    checked: formValues[item.field],
                    onChange: (event) =>
                      setFormValues((prev) => ({ ...prev, [item.field]: event.target.checked }))
                  }),
                  label: item.label
                })
              )
            )
          )
        ),
        React.createElement(DialogActions, null,
          React.createElement(Button, { onClick: handleCloseDialog }, '取消'),
          React.createElement(Button, { variant: 'contained', onClick: handleSave, disabled: saving }, '保存')
        )
      ),
      React.createElement(Dialog, { open: confirmDelete, onClose: () => setConfirmDelete(false) },
        React.createElement(DialogTitle, null, '删除参数'),
        React.createElement(DialogContent, null,
          React.createElement(Typography, null, '确定删除所选参数吗？')
        ),
        React.createElement(DialogActions, null,
          React.createElement(Button, { onClick: () => setConfirmDelete(false) }, '取消'),
          React.createElement(Button, { color: 'error', onClick: handleDelete, disabled: saving }, '删除')
        )
      ),
      React.createElement(Snackbar, { open: notify.open, autoHideDuration: 3200, onClose: closeNotify },
        React.createElement(Alert, { severity: notify.severity, onClose: closeNotify, sx: { width: '100%' } }, notify.message)
      )
    );
  };

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['parameter-admin'] = ParameterAdminPage;
})();
