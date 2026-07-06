/**
 * onlineManage.js —— 由 views/admin-pages/onlineManage.jade 提取。
 * 懒加载：用户切换到「online-manage」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const OnlineManagePage = () => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const loadData = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await fetch('/realtime-admin/online-users');
        if (resp.status === 401) {
          window.location.href = '/login';
          return;
        }
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.message || '加载在线用户失败');
        setRows(result.data || []);
      } catch (err) {
        setError(err.message || '加载在线用户失败');
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      loadData();
    }, [loadData]);

    return React.createElement(Box, { sx: { display: 'grid', gap: 2 } },
      React.createElement(Stack, { direction: 'row', alignItems: 'center', justifyContent: 'space-between' },
        React.createElement(Typography, { variant: 'h6' }, '在线用户'),
        React.createElement(Button, { variant: 'outlined', size: 'small', onClick: loadData, disabled: loading }, '刷新')
      ),
      error ? React.createElement(Alert, { severity: 'error' }, error) : null,
      React.createElement(Paper, { sx: { borderRadius: 3, overflow: 'hidden', position: 'relative' } },
        loading ? React.createElement(Box, {
          sx: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.6)', zIndex: 1 }
        }, React.createElement(CircularProgress, { size: 32 })) : null,
        React.createElement(TableContainer, null,
          React.createElement(Table, { size: 'small' },
            React.createElement(TableHead, null,
              React.createElement(TableRow, null,
                React.createElement(TableCell, null, '用户ID'),
                React.createElement(TableCell, null, '在线终端数'),
                React.createElement(TableCell, null, '终端列表')
              )
            ),
            React.createElement(TableBody, null,
              (rows || []).map((row) =>
                React.createElement(TableRow, { key: row.userId },
                  React.createElement(TableCell, null, row.userId),
                  React.createElement(TableCell, null, row.count || 0),
                  React.createElement(TableCell, null,
                    React.createElement(Stack, { spacing: 0.5 },
                      (row.endpoints || []).map((ep) =>
                        React.createElement(Typography, { key: ep.terminalId, variant: 'body2', color: 'text.secondary' },
                          `${ep.terminalId} / ${ep.ip || ''} / ${ep.os || ''}`
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    );
  };

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['online-manage'] = OnlineManagePage;
})();
