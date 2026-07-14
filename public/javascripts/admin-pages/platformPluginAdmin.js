(function () {
  'use strict';

  const createDefaultPluginForm = () => ({
    id: '',
    guid: '',
    name: '',
    assemblyName: '',
    className: '',
    version: '',
    developer: '',
    addinSize: '',
    downloadCount: '0',
    description: '',
    enabled: true
  });

  const mapPluginToForm = (record = {}) => ({
    id: record.id || '',
    guid: record.guid || '',
    name: record.name || '',
    assemblyName: record.assemblyName || '',
    className: record.className || '',
    version: record.version || '',
    developer: record.developer || '',
    addinSize: record.addinSize ?? '',
    downloadCount: record.downloadCount ?? '0',
    description: record.description || '',
    enabled: !!record.enabled
  });

  const PlatformPluginAdminPage = () => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [selectedRow, setSelectedRow] = useState(null);
    const [dialogState, setDialogState] = useState({ open: false, mode: 'create' });
    const [formValues, setFormValues] = useState(createDefaultPluginForm());
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });

    const closeNotify = () => setNotify((prev) => ({ ...prev, open: false }));

    const loadRows = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (keyword) params.append('keyword', keyword);
        const resp = await fetch(`/platform-plugin-admin/plugins?${params.toString()}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '获取平台插件列表失败');
        const data = result.data || [];
        setRows(data);
        setTotal(result.total || 0);
        setSelectedRow((current) => current && !data.some((item) => item.id === current.id) ? null : current);
      } catch (err) {
        setError(err.message || '获取平台插件列表失败');
      } finally {
        setLoading(false);
      }
    }, [page, pageSize, keyword]);

    useEffect(() => {
      loadRows();
    }, [loadRows]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const openCreate = () => {
      setFormValues(createDefaultPluginForm());
      setDialogState({ open: true, mode: 'create' });
    };

    const openEdit = async () => {
      if (!selectedRow) return;
      try {
        const resp = await fetch(`/platform-plugin-admin/plugins/${selectedRow.id}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '获取平台插件详情失败');
        setFormValues(mapPluginToForm(result.data || {}));
        setDialogState({ open: true, mode: 'edit' });
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '获取平台插件详情失败' });
      }
    };

    const closeDialog = () => {
      setDialogState({ open: false, mode: 'create' });
      setFormValues(createDefaultPluginForm());
    };

    const normalizePayload = () => ({
      guid: formValues.guid.trim(),
      name: formValues.name.trim(),
      assemblyName: formValues.assemblyName.trim(),
      className: formValues.className.trim(),
      version: formValues.version.trim(),
      developer: formValues.developer.trim(),
      addinSize: formValues.addinSize === '' ? null : Number(formValues.addinSize),
      downloadCount: formValues.downloadCount === '' ? 0 : Number(formValues.downloadCount),
      description: formValues.description.trim(),
      enabled: !!formValues.enabled
    });

    const handleSave = async () => {
      const payload = normalizePayload();
      if (!payload.name) {
        setNotify({ open: true, severity: 'error', message: '请填写插件名称' });
        return;
      }
      setSaving(true);
      try {
        const isEdit = dialogState.mode === 'edit';
        const url = isEdit ? `/platform-plugin-admin/plugins/${formValues.id}` : '/platform-plugin-admin/plugins';
        const resp = await fetch(url, {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '保存平台插件失败');
        setNotify({ open: true, severity: 'success', message: result.message || '平台插件已保存' });
        closeDialog();
        await loadRows();
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '保存平台插件失败' });
      } finally {
        setSaving(false);
      }
    };

    const handleDelete = async () => {
      if (!selectedRow) return;
      setSaving(true);
      try {
        const resp = await fetch(`/platform-plugin-admin/plugins/${selectedRow.id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '删除平台插件失败');
        setNotify({ open: true, severity: 'success', message: result.message || '平台插件已删除' });
        setSelectedRow(null);
        await loadRows();
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '删除平台插件失败' });
      } finally {
        setSaving(false);
        setConfirmDelete(false);
      }
    };

    return React.createElement(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 2 } },
      React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
        React.createElement(Stack, { direction: { xs: 'column', md: 'row' }, spacing: 1.5, justifyContent: 'space-between' },
          React.createElement(Stack, { spacing: 0.5 },
            React.createElement(Typography, { variant: 'h6' }, '平台插件管理'),
            React.createElement(Typography, { variant: 'caption', color: 'text.secondary' }, `共 ${total} 个插件`)
          ),
          React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 1 },
            React.createElement(TextField, { size: 'small', label: '搜索插件', value: searchInput, onChange: (event) => setSearchInput(event.target.value) }),
            React.createElement(Button, { variant: 'contained', onClick: () => { setKeyword(searchInput.trim()); setPage(1); } }, '搜索'),
            React.createElement(Button, { variant: 'outlined', onClick: openCreate }, '新增'),
            React.createElement(Button, { variant: 'outlined', disabled: !selectedRow, onClick: openEdit }, '编辑'),
            React.createElement(Button, { variant: 'outlined', color: 'error', disabled: !selectedRow, onClick: () => setConfirmDelete(true) }, '删除'),
            React.createElement(Button, { variant: 'text', onClick: loadRows, disabled: loading }, '刷新')
          )
        )
      ),
      React.createElement(Paper, { sx: { borderRadius: 3, overflow: 'hidden' } },
        loading ? React.createElement(LinearProgress, null) : null,
        error ? React.createElement(Alert, { severity: 'error', sx: { borderRadius: 0 } }, error) : null,
        React.createElement(TableContainer, null,
          React.createElement(Table, { size: 'small' },
            React.createElement(TableHead, null,
              React.createElement(TableRow, null,
                React.createElement(TableCell, null, '名称'),
                React.createElement(TableCell, null, '程序集'),
                React.createElement(TableCell, null, '类名'),
                React.createElement(TableCell, null, '版本'),
                React.createElement(TableCell, null, '开发者'),
                React.createElement(TableCell, null, '下载次数'),
                React.createElement(TableCell, null, '状态')
              )
            ),
            React.createElement(TableBody, null,
              rows.length ? rows.map((item) =>
                React.createElement(TableRow, {
                  key: item.id,
                  hover: true,
                  selected: selectedRow?.id === item.id,
                  onClick: () => setSelectedRow(item),
                  sx: { cursor: 'pointer' }
                },
                  React.createElement(TableCell, null, item.name || '-'),
                  React.createElement(TableCell, null, item.assemblyName || '-'),
                  React.createElement(TableCell, null, item.className || '-'),
                  React.createElement(TableCell, null, item.version || '-'),
                  React.createElement(TableCell, null, item.developer || '-'),
                  React.createElement(TableCell, null, item.downloadCount ?? 0),
                  React.createElement(TableCell, null,
                    React.createElement(Chip, {
                      label: item.enabled ? '启用' : '停用',
                      size: 'small',
                      color: item.enabled ? 'success' : 'default',
                      variant: item.enabled ? 'filled' : 'outlined'
                    })
                  )
                )
              ) : React.createElement(TableRow, null,
                React.createElement(TableCell, { colSpan: 7, align: 'center', sx: { py: 4, color: 'text.secondary' } }, loading ? '正在加载...' : '暂无插件')
              )
            )
          )
        ),
        React.createElement(Divider, null),
        React.createElement(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', p: 2, gap: 1.5 } },
          React.createElement(TextField, {
            select: true,
            size: 'small',
            label: '每页',
            value: pageSize,
            onChange: (event) => { setPageSize(Number(event.target.value)); setPage(1); },
            sx: { minWidth: 90 }
          }, [10, 20, 50, 100].map((size) => React.createElement(MenuItem, { key: size, value: size }, `${size} 条`))),
          React.createElement(Pagination, { count: totalPages, page, onChange: (event, value) => setPage(value), color: 'primary' })
        )
      ),
      React.createElement(Dialog, { open: dialogState.open, onClose: closeDialog, maxWidth: 'sm', fullWidth: true },
        React.createElement(DialogTitle, null, dialogState.mode === 'edit' ? '编辑平台插件' : '新增平台插件'),
        React.createElement(DialogContent, null,
          React.createElement(Stack, { spacing: 2, mt: 1 },
            React.createElement(TextField, { label: '插件名称', required: true, value: formValues.name, onChange: (event) => setFormValues((prev) => ({ ...prev, name: event.target.value })) }),
            React.createElement(TextField, { label: 'GUID', value: formValues.guid, onChange: (event) => setFormValues((prev) => ({ ...prev, guid: event.target.value })) }),
            React.createElement(TextField, { label: '程序集名称', value: formValues.assemblyName, onChange: (event) => setFormValues((prev) => ({ ...prev, assemblyName: event.target.value })) }),
            React.createElement(TextField, { label: '类名', value: formValues.className, onChange: (event) => setFormValues((prev) => ({ ...prev, className: event.target.value })) }),
            React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 2 },
              React.createElement(TextField, { label: '版本', value: formValues.version, onChange: (event) => setFormValues((prev) => ({ ...prev, version: event.target.value })) }),
              React.createElement(TextField, { label: '开发者', value: formValues.developer, onChange: (event) => setFormValues((prev) => ({ ...prev, developer: event.target.value })) })
            ),
            React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 2 },
              React.createElement(TextField, { label: '插件大小', type: 'number', value: formValues.addinSize, onChange: (event) => setFormValues((prev) => ({ ...prev, addinSize: event.target.value })) }),
              React.createElement(TextField, { label: '下载次数', type: 'number', value: formValues.downloadCount, onChange: (event) => setFormValues((prev) => ({ ...prev, downloadCount: event.target.value })) })
            ),
            React.createElement(TextField, { label: '描述', multiline: true, minRows: 2, value: formValues.description, onChange: (event) => setFormValues((prev) => ({ ...prev, description: event.target.value })) }),
            React.createElement(FormControlLabel, {
              control: React.createElement(Switch, { checked: formValues.enabled, onChange: (event) => setFormValues((prev) => ({ ...prev, enabled: event.target.checked })) }),
              label: '启用'
            })
          )
        ),
        React.createElement(DialogActions, null,
          React.createElement(Button, { onClick: closeDialog }, '取消'),
          React.createElement(Button, { onClick: handleSave, variant: 'contained', disabled: saving }, '保存')
        )
      ),
      React.createElement(Dialog, { open: confirmDelete, onClose: () => setConfirmDelete(false) },
        React.createElement(DialogTitle, null, '删除平台插件'),
        React.createElement(DialogContent, null, React.createElement(Typography, null, '确定删除所选平台插件吗？')),
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

  window.AdminPages = window.AdminPages || {};
  window.AdminPages['platform-plugin-admin'] = PlatformPluginAdminPage;
})();
