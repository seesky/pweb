/**
 * logAdmin.js —— 由 views/admin-pages/logAdmin.jade 提取。
 * 懒加载：用户切换到「log-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const LogAdminPage = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [selectedRow, setSelectedRow] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });
    const [detail, setDetail] = useState(null);

    const closeNotify = () => setNotify((prev) => ({ ...prev, open: false }));

    const loadLogs = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (keyword) params.append('keyword', keyword);
        const resp = await fetch(`/log-admin/logs?${params.toString()}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const contentType = resp.headers.get('content-type') || '';
        const result = contentType.includes('application/json') ? await resp.json() : { message: await resp.text() };
        if (!resp.ok) {
          throw new Error(result.message || '获取日志失败');
        }
        setLogs(result.data || []);
        setTotal(result.total || 0);
        if (selectedRow && !(result.data || []).find((item) => item.id === selectedRow.id)) {
          setSelectedRow(null);
        }
      } catch (err) {
        setError(err.message || '获取日志失败');
      } finally {
        setLoading(false);
      }
    }, [page, pageSize, keyword, selectedRow]);

    useEffect(() => {
      loadLogs();
    }, [loadLogs]);

    useEffect(() => {
      if (selectedRow) {
        (async () => {
          try {
            const resp = await fetch(`/log-admin/logs/${selectedRow.id}`);
            const result = await resp.json();
            if (resp.ok) {
              setDetail(result.data || null);
            }
          } catch (err) {
            setDetail(null);
          }
        })();
      } else {
        setDetail(null);
      }
    }, [selectedRow]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const handleSearch = () => {
      setKeyword(searchInput.trim());
      setPage(1);
    };

    const handleDelete = async () => {
      if (!selectedRow) return;
      try {
        const resp = await fetch('/log-admin/logs/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [selectedRow.id] })
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '删除失败');
        setNotify({ open: true, severity: 'success', message: result.message || '已删除' });
        setSelectedRow(null);
        await loadLogs();
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '删除失败' });
      } finally {
        setConfirmDelete(false);
      }
    };

    return React.createElement(Box, { sx: { display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 360px' } } },
      React.createElement(Box, null,
        React.createElement(Paper, { sx: { p: 2, borderRadius: 3, mb: 2 } },
          React.createElement(Stack, {
            direction: { xs: 'column', md: 'row' },
            spacing: 1.5,
            alignItems: { xs: 'stretch', md: 'center' },
            justifyContent: 'space-between'
          },
            React.createElement(Stack, { spacing: 0.5 },
              React.createElement(Typography, { variant: 'h6' }, '系统日志'),
              React.createElement(Typography, { variant: 'caption', color: 'text.secondary' }, `共 ${total} 条记录`)
            ),
            React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 1 },
              React.createElement(TextField, {
                size: 'small',
                label: '搜索（模块/方法/用户）',
                value: searchInput,
                onChange: (event) => setSearchInput(event.target.value)
              }),
              React.createElement(Button, { variant: 'contained', onClick: handleSearch }, '搜索'),
              React.createElement(Button, {
                variant: 'outlined',
                color: 'error',
                disabled: !selectedRow,
                onClick: () => setConfirmDelete(true)
              }, '删除'),
              React.createElement(Button, { variant: 'text', onClick: loadLogs }, '刷新')
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
                  React.createElement(TableCell, null, '模块'),
                  React.createElement(TableCell, null, '方法'),
                  React.createElement(TableCell, null, '用户'),
                  React.createElement(TableCell, null, 'IP'),
                  React.createElement(TableCell, null, '时间')
                )
              ),
              React.createElement(TableBody, null,
                logs.length
                  ? logs.map((item) =>
                      React.createElement(TableRow, {
                        key: item.id,
                        hover: true,
                        selected: selectedRow?.id === item.id,
                        onClick: () => setSelectedRow(item),
                        sx: { cursor: 'pointer' }
                      },
                        React.createElement(TableCell, null, item.processName || '-'),
                        React.createElement(TableCell, null, item.methodName || '-'),
                        React.createElement(TableCell, null, item.userRealName || '-'),
                        React.createElement(TableCell, null, item.ipAddress || '-'),
                        React.createElement(TableCell, null, item.createOn ? new Date(item.createOn).toLocaleString() : '-')
                      )
                    )
                  : React.createElement(TableRow, null,
                      React.createElement(TableCell, {
                        colSpan: 5,
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
        )
      ),
      React.createElement(Box, null,
        React.createElement(Paper, { sx: { p: 2, borderRadius: 3 } },
          React.createElement(Typography, { variant: 'subtitle1', mb: 1 }, '详情'),
          detail
            ? React.createElement(Stack, { spacing: 1 },
                React.createElement(Typography, { variant: 'body2' }, `模块：${detail.processName || '-'}`),
                React.createElement(Typography, { variant: 'body2' }, `方法：${detail.methodName || '-'}`),
                React.createElement(Typography, { variant: 'body2' }, `用户：${detail.userRealName || '-'}`),
                React.createElement(Typography, { variant: 'body2' }, `IP：${detail.ipAddress || '-'}`),
                React.createElement(Typography, { variant: 'body2' }, `时间：${detail.createOn ? new Date(detail.createOn).toLocaleString() : '-'}`),
                React.createElement(Typography, { variant: 'body2', sx: { wordBreak: 'break-all' } }, `参数：${detail.parameters || '-'}`)
              )
            : React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '请选择左侧日志查看详情')
        )
      ),
      React.createElement(Dialog, { open: confirmDelete, onClose: () => setConfirmDelete(false) },
        React.createElement(DialogTitle, null, '删除日志'),
        React.createElement(DialogContent, null,
          React.createElement(Typography, null, '确定删除所选日志吗？')
        ),
        React.createElement(DialogActions, null,
          React.createElement(Button, { onClick: () => setConfirmDelete(false) }, '取消'),
          React.createElement(Button, { color: 'error', onClick: handleDelete }, '删除')
        )
      ),
      React.createElement(Snackbar, { open: notify.open, autoHideDuration: 3200, onClose: closeNotify },
        React.createElement(Alert, { severity: notify.severity, onClose: closeNotify, sx: { width: '100%' } }, notify.message)
      )
    );
  };

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['log-admin'] = LogAdminPage;
})();
