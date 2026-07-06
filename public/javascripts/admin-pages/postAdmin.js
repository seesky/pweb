/**
 * postAdmin.js —— 由 views/admin-pages/postAdmin.jade 提取。
 * 懒加载：用户切换到「post-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const defaultPostForm = () => ({
        id: '',
        realName: '',
        code: '',
        organizeId: '',
        sortCode: '',
        description: '',
        enabled: true,
        allowEdit: true,
        allowDelete: true
  });
  const serializePostForm = (values) => ({
        realName: values.realName?.trim(),
        code: values.code?.trim() || null,
        organizeId: values.organizeId?.trim() || null,
        sortCode: values.sortCode === '' ? null : Number(values.sortCode),
        description: values.description?.trim() || null,
        enabled: !!values.enabled,
        allowEdit: !!values.allowEdit,
        allowDelete: !!values.allowDelete
  });
  const PostAdminPage = () => {
    const [posts, setPosts] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [selectedRow, setSelectedRow] = useState(null);
    const [dialogState, setDialogState] = useState({ open: false, mode: 'create' });
    const [formValues, setFormValues] = useState(defaultPostForm());
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });

    const loadPosts = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize)
        });
        if (keyword) {
          params.append('keyword', keyword);
        }
        const resp = await fetch(`/post-admin/posts?${params.toString()}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '加载岗位失败');
        }
        setPosts(result.data || []);
        setTotal(result.total || 0);
      } catch (err) {
        setError(err.message || '加载岗位失败');
      } finally {
        setLoading(false);
      }
    }, [page, pageSize, keyword]);

    useEffect(() => {
      loadPosts();
    }, [loadPosts]);

    useEffect(() => {
      if (selectedRow && !posts.some((post) => post.id === selectedRow.id)) {
        setSelectedRow(null);
      }
    }, [posts, selectedRow]);

    const handleSearch = () => {
      setPage(1);
      setKeyword(searchInput.trim());
    };

    const handleOpenCreate = () => {
      setFormValues(defaultPostForm());
      setDialogState({ open: true, mode: 'create' });
    };

    const handleOpenEdit = () => {
      if (!selectedRow) return;
      setFormValues({
        id: selectedRow.id,
        realName: selectedRow.realName || '',
        code: selectedRow.code || '',
        organizeId: selectedRow.organizeId || '',
        sortCode: selectedRow.sortCode ?? '',
        description: selectedRow.description || '',
        enabled: !!selectedRow.enabled,
        allowEdit: !!selectedRow.allowEdit,
        allowDelete: !!selectedRow.allowDelete
      });
      setDialogState({ open: true, mode: 'edit' });
    };

    const handleCloseDialog = () => {
      setDialogState({ open: false, mode: 'create' });
      setFormValues(defaultPostForm());
    };

    const handleSave = async () => {
      setSaving(true);
      try {
        const payload = serializePostForm(formValues);
        if (!payload.realName) {
          throw new Error('请输入岗位名称');
        }
        const isEdit = dialogState.mode === 'edit';
        const url = isEdit ? `/post-admin/posts/${formValues.id}` : '/post-admin/posts';
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
        await loadPosts();
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
        const resp = await fetch(`/post-admin/posts/${selectedRow.id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '删除失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '岗位已删除' });
        setSelectedRow(null);
        await loadPosts();
      } catch (err) {
        setNotify({ open: true, severity: 'error', message: err.message || '删除失败' });
      } finally {
        setSaving(false);
        setConfirmDelete(false);
      }
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return React.createElement(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 3 } },
      React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
        React.createElement(Stack, {
          direction: { xs: 'column', md: 'row' },
          spacing: 1.5,
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', md: 'center' }
        },
        React.createElement(Stack, {
          direction: { xs: 'column', sm: 'row' },
          spacing: 1,
          alignItems: 'center'
        },
          React.createElement(TextField, {
            label: '搜索岗位名称/编码',
            size: 'small',
            value: searchInput,
            onChange: (event) => setSearchInput(event.target.value)
          }),
          React.createElement(Button, { variant: 'text', size: 'small', onClick: handleSearch }, '搜索')
        ),
        React.createElement(Stack, { direction: 'row', spacing: 1, flexWrap: 'wrap' },
          React.createElement(Button, { variant: 'contained', size: 'small', onClick: handleOpenCreate }, '新增岗位'),
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
          React.createElement(TextField, {
            label: '每页条数',
            select: true,
            size: 'small',
            sx: { width: 120 },
            value: pageSize,
            onChange: (event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            },
            children: [10, 20, 50].map((size) =>
              React.createElement(MenuItem, { key: size, value: size }, `${size}条/页`)
            )
          })
        )
        )
      ),
      error ? React.createElement(Alert, { severity: 'error' }, error) : null,
      React.createElement(Paper, { sx: { borderRadius: 3, position: 'relative' } },
        loading
          ? React.createElement(Box, {
              sx: {
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'rgba(255,255,255,0.7)',
                zIndex: 1,
                borderRadius: 3
              }
            }, React.createElement(CircularProgress, { size: 32 }))
          : null,
        React.createElement(TableContainer, null,
          React.createElement(Table, { size: 'small' },
            React.createElement(TableHead, null,
              React.createElement(TableRow, null,
                React.createElement(TableCell, null, '岗位名称'),
                React.createElement(TableCell, null, '编码'),
                React.createElement(TableCell, null, '所属组织'),
                React.createElement(TableCell, null, '排序'),
                React.createElement(TableCell, null, '权限'),
                React.createElement(TableCell, null, '状态')
              )
            ),
            React.createElement(TableBody, null,
              posts.map((row) =>
                React.createElement(TableRow, {
                  key: row.id,
                  hover: true,
                  selected: selectedRow?.id === row.id,
                  onClick: () => setSelectedRow(row),
                  sx: { cursor: 'pointer' }
                },
                React.createElement(TableCell, null,
                  React.createElement(Typography, { variant: 'body2', fontWeight: 600 }, row.realName || '-'),
                  row.description
                    ? React.createElement(Typography, { variant: 'caption', color: 'text.secondary' }, row.description)
                    : null
                ),
                React.createElement(TableCell, null, row.code || '-'),
                React.createElement(TableCell, null, row.organizeId || '-'),
                React.createElement(TableCell, null, row.sortCode || 0),
                React.createElement(TableCell, null,
                  React.createElement(Stack, { direction: 'row', spacing: 0.5 },
                    row.allowEdit
                      ? React.createElement(Chip, { label: '可编辑', size: 'small', color: 'info', variant: 'outlined' })
                      : React.createElement(Chip, { label: '不可编辑', size: 'small', color: 'default', variant: 'outlined' }),
                    row.allowDelete
                      ? React.createElement(Chip, { label: '可删除', size: 'small', color: 'success', variant: 'outlined' })
                      : React.createElement(Chip, { label: '不可删除', size: 'small', color: 'default', variant: 'outlined' })
                  )
                ),
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
        React.createElement(Box, {
          sx: {
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            p: 2
          }
        },
          React.createElement(Pagination, {
            count: totalPages,
            page,
            onChange: (event, value) => setPage(value),
            color: 'primary'
          })
        )
      ),
      React.createElement(Dialog, {
        open: dialogState.open,
        onClose: handleCloseDialog,
        maxWidth: 'sm',
        fullWidth: true
      },
        React.createElement(DialogTitle, null, dialogState.mode === 'edit' ? '编辑岗位' : '新增岗位'),
        React.createElement(DialogContent, null,
          React.createElement(Stack, { spacing: 2, sx: { mt: 1 } },
            React.createElement(TextField, {
              label: '岗位名称',
              required: true,
              value: formValues.realName,
              onChange: (event) => setFormValues((prev) => ({ ...prev, realName: event.target.value }))
            }),
            React.createElement(TextField, {
              label: '编码',
              value: formValues.code,
              onChange: (event) => setFormValues((prev) => ({ ...prev, code: event.target.value }))
            }),
            React.createElement(TextField, {
              label: '所属组织ID',
              value: formValues.organizeId,
              onChange: (event) => setFormValues((prev) => ({ ...prev, organizeId: event.target.value }))
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
            React.createElement(Stack, { direction: 'row', spacing: 1 },
              React.createElement(FormControlLabel, {
                control: React.createElement(Switch, {
                  checked: formValues.enabled,
                  onChange: (event) => setFormValues((prev) => ({ ...prev, enabled: event.target.checked }))
                }),
                label: '启用'
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
        React.createElement(DialogTitle, null, '删除岗位'),
        React.createElement(DialogContent, null,
          React.createElement(Typography, null, '确定删除所选岗位吗？')
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

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['post-admin'] = PostAdminPage;
})();
