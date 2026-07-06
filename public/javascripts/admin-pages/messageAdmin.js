/**
 * messageAdmin.js —— 由 views/admin-pages/messageAdmin.jade 提取。
 * 懒加载：用户切换到「message-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const MessageAdminPage = () => {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [selectedRow, setSelectedRow] = useState(null);
    const [detail, setDetail] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });
    const [sendDialog, setSendDialog] = useState(false);
    const [sendForm, setSendForm] = useState({ title: '', content: '', receiverId: '', receiverName: '' });

    const closeNotify = () => setNotify((prev) => ({ ...prev, open: false }));

    const loadMessages = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (keyword) params.append('keyword', keyword);
        const resp = await fetch(`/message-admin/messages?${params.toString()}`);
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const contentType = resp.headers.get('content-type') || '';
        const result = contentType.includes('application/json') ? await resp.json() : { message: await resp.text() };
        if (!resp.ok) throw new Error(result.message || '获取消息失败');
        setMessages(result.data || []);
        setTotal(result.total || 0);
        if (selectedRow && !(result.data || []).find((m) => m.id === selectedRow.id)) {
          setSelectedRow(null);
        }
      } catch (err) {
        setError(err.message || '获取消息失败');
      } finally {
        setLoading(false);
      }
    }, [page, pageSize, keyword, selectedRow]);

    useEffect(() => {
      loadMessages();
    }, [loadMessages]);

    useEffect(() => {
      if (selectedRow) {
        (async () => {
          try {
            const resp = await fetch(`/message-admin/messages/${selectedRow.id}`);
            const result = await resp.json();
            if (resp.ok) setDetail(result.data || null);
          } catch (error) {
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

    const handleMarkRead = async () => {
      if (!selectedRow) return;
      try {
        const resp = await fetch('/message-admin/messages/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [selectedRow.id] })
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '标记已读失败');
        setNotify({ open: true, severity: 'success', message: result.message || '已标记为已读' });
        await loadMessages();
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '标记失败' });
      }
    };

    const handleDelete = async () => {
      if (!selectedRow) return;
      try {
        const resp = await fetch('/message-admin/messages/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [selectedRow.id] })
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '删除失败');
        setNotify({ open: true, severity: 'success', message: result.message || '已删除' });
        setSelectedRow(null);
        await loadMessages();
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '删除失败' });
      } finally {
        setConfirmDelete(false);
      }
    };

    const handleSend = async () => {
      if (!sendForm.title || !sendForm.receiverId) {
        setNotify({ open: true, severity: 'error', message: '请填写标题和接收人' });
        return;
      }
      try {
        const resp = await fetch('/message-admin/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: sendForm.title.trim(),
            content: sendForm.content.trim(),
            receiverId: sendForm.receiverId.trim(),
            receiverName: sendForm.receiverName.trim()
          })
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '发送失败');
        setNotify({ open: true, severity: 'success', message: result.message || '消息已发送' });
        setSendDialog(false);
        setSendForm({ title: '', content: '', receiverId: '', receiverName: '' });
        await loadMessages();
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '发送失败' });
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
              React.createElement(Typography, { variant: 'h6' }, '系统消息'),
              React.createElement(Typography, { variant: 'caption', color: 'text.secondary' }, `共 ${total} 条记录`)
            ),
            React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 1 },
              React.createElement(TextField, {
                size: 'small',
                label: '搜索（标题/内容/收件人）',
                value: searchInput,
                onChange: (event) => setSearchInput(event.target.value)
              }),
              React.createElement(Button, { variant: 'contained', onClick: handleSearch }, '搜索'),
              React.createElement(Button, { variant: 'outlined', onClick: handleMarkRead, disabled: !selectedRow }, '标记已读'),
              React.createElement(Button, { variant: 'outlined', color: 'error', onClick: () => setConfirmDelete(true), disabled: !selectedRow }, '删除'),
              React.createElement(Button, { variant: 'outlined', onClick: () => setSendDialog(true) }, '发送'),
              React.createElement(Button, { variant: 'text', onClick: loadMessages }, '刷新')
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
                  React.createElement(TableCell, null, '标题'),
                  React.createElement(TableCell, null, '收件人'),
                  React.createElement(TableCell, null, '状态'),
                  React.createElement(TableCell, null, '时间')
                )
              ),
              React.createElement(TableBody, null,
                messages.length
                  ? messages.map((msg) =>
                      React.createElement(TableRow, {
                        key: msg.id,
                        hover: true,
                        selected: selectedRow?.id === msg.id,
                        onClick: () => setSelectedRow(msg),
                        sx: { cursor: 'pointer' }
                      },
                        React.createElement(TableCell, null, msg.title || '-'),
                        React.createElement(TableCell, null, msg.receiverName || msg.receiverId || '-'),
                        React.createElement(TableCell, null, msg.isNew ? '未读' : '已读'),
                        React.createElement(TableCell, null, msg.createdOn ? new Date(msg.createdOn).toLocaleString() : '-')
                      )
                    )
                  : React.createElement(TableRow, null,
                      React.createElement(TableCell, {
                        colSpan: 4,
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
        React.createElement(Paper, { sx: { p: 2, borderRadius: 3, minHeight: 280 } },
          React.createElement(Typography, { variant: 'subtitle1', mb: 1 }, '详情'),
          detail
            ? React.createElement(Stack, { spacing: 1 },
                React.createElement(Typography, { variant: 'body2' }, `标题：${detail.title || '-'}`),
                React.createElement(Typography, { variant: 'body2' }, `收件人：${detail.receiverName || detail.receiverId || '-'}`),
                React.createElement(Typography, { variant: 'body2' }, `状态：${detail.isNew ? '未读' : '已读'}`),
                React.createElement(Typography, { variant: 'body2' }, `时间：${detail.createdOn ? new Date(detail.createdOn).toLocaleString() : '-'}`),
                React.createElement(Typography, { variant: 'body2', sx: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, `内容：${detail.content || '-'}`)
              )
            : React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '请选择左侧消息查看')
        )
      ),
      React.createElement(Dialog, { open: confirmDelete, onClose: () => setConfirmDelete(false) },
        React.createElement(DialogTitle, null, '删除消息'),
        React.createElement(DialogContent, null,
          React.createElement(Typography, null, '确定删除所选消息吗？')
        ),
        React.createElement(DialogActions, null,
          React.createElement(Button, { onClick: () => setConfirmDelete(false) }, '取消'),
          React.createElement(Button, { color: 'error', onClick: handleDelete }, '删除')
        )
      ),
      React.createElement(Dialog, { open: sendDialog, onClose: () => setSendDialog(false), maxWidth: 'sm', fullWidth: true },
        React.createElement(DialogTitle, null, '发送消息'),
        React.createElement(DialogContent, null,
          React.createElement(Stack, { spacing: 2, mt: 1 },
            React.createElement(TextField, {
              label: '接收人 ID',
              required: true,
              value: sendForm.receiverId,
              onChange: (e) => setSendForm((prev) => ({ ...prev, receiverId: e.target.value }))
            }),
            React.createElement(TextField, {
              label: '接收人姓名',
              value: sendForm.receiverName,
              onChange: (e) => setSendForm((prev) => ({ ...prev, receiverName: e.target.value }))
            }),
            React.createElement(TextField, {
              label: '标题',
              required: true,
              value: sendForm.title,
              onChange: (e) => setSendForm((prev) => ({ ...prev, title: e.target.value }))
            }),
            React.createElement(TextField, {
              label: '内容',
              multiline: true,
              minRows: 3,
              value: sendForm.content,
              onChange: (e) => setSendForm((prev) => ({ ...prev, content: e.target.value }))
            })
          )
        ),
        React.createElement(DialogActions, null,
          React.createElement(Button, { onClick: () => setSendDialog(false) }, '取消'),
          React.createElement(Button, { variant: 'contained', onClick: handleSend }, '发送')
        )
      ),
      React.createElement(Snackbar, { open: notify.open, autoHideDuration: 3200, onClose: closeNotify },
        React.createElement(Alert, { severity: notify.severity, onClose: closeNotify, sx: { width: '100%' } }, notify.message)
      )
    );
  };

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['message-admin'] = MessageAdminPage;
})();
