/**
 * sysConfigAdmin.js —— 由 views/admin-pages/sysConfigAdmin.jade 提取。
 * 懒加载：用户切换到「sys-config-admin」页时由 loader.js 动态拉取。
 * 依赖：react / react-dom / material-ui（外壳已同步加载）
 */
(function () {
  'use strict';

const themeOptions = [
    { name: 'default', title: '默认' },
    { name: 'gray', title: '灰色' },
    { name: 'black', title: '黑色' },
    { name: 'bootstrap', title: 'Bootstrap' },
    { name: 'metro', title: 'Metro' },
    { name: 'metro-blue', title: 'Metro Blue' },
    { name: 'metro-gray', title: 'Metro Gray' },
    { name: 'metro-green', title: 'Metro Green' },
    { name: 'metro-orange', title: 'Metro Orange' },
    { name: 'metro-red', title: 'Metro Red' },
    { name: 'ui-cupertino', title: 'UI Cupertino' },
    { name: 'ui-dark-hive', title: 'UI Dark Hive' },
    { name: 'ui-pepper-grinder', title: 'UI Pepper Grinder' },
    { name: 'ui-sunny', title: 'UI Sunny' },
    { name: 'uimaker', title: 'UI Maker' }
  ];

  const navTypeOptions = [
    { id: 'AccordionTree', label: '树+折叠面板' },
    { id: 'Tree', label: '树结构' },
    { id: 'Accordion', label: '折叠面板' }
  ];

  const SysConfigAdminPage = () => {
    const [config, setConfig] = useState({ theme: 'default', gridRows: 20, navType: 'AccordionTree' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });

    const closeNotify = () => setNotify((prev) => ({ ...prev, open: false }));

    useEffect(() => {
      const loadConfig = async () => {
        setLoading(true);
        try {
          const resp = await fetch('/sys-config-admin/default-config');
          if (resp.status === 401) {
            window.location.href = '/login';
            return;
          }
          const result = await resp.json();
          if (resp.ok && result.data) {
            setConfig(result.data);
          }
        } catch (error) {
          console.error(error);
        } finally {
          setLoading(false);
        }
      };
      loadConfig();
    }, []);

    const handleChange = (field, value) => {
      setConfig((prev) => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
      setSaving(true);
      try {
        const resp = await fetch('/sys-config-admin/user-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            theme: config.theme,
            gridRows: Number(config.gridRows) || 20,
            navType: config.navType
          })
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.message || '保存失败');
        }
        setNotify({ open: true, severity: 'success', message: result.message || '配置已保存' });
      } catch (error) {
        setNotify({ open: true, severity: 'error', message: error.message || '保存失败' });
      } finally {
        setSaving(false);
      }
    };

    if (loading) {
      return React.createElement(Box, {
        sx: { minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }
      }, React.createElement(CircularProgress, { size: 32 }));
    }

    return React.createElement(Box, { sx: { maxWidth: 720, mx: 'auto' } },
      React.createElement(Paper, { sx: { p: 3, borderRadius: 3, mb: 3 } },
        React.createElement(Stack, { spacing: 3 },
          React.createElement(Typography, { variant: 'h6' }, '主题设置'),
          React.createElement(TextField, {
            select: true,
            label: '默认皮肤',
            value: config.theme,
            onChange: (event) => handleChange('theme', event.target.value)
          },
            themeOptions.map((option) =>
              React.createElement(MenuItem, { key: option.name, value: option.name }, option.title)
            )
          )
        )
      ),
      React.createElement(Paper, { sx: { p: 3, borderRadius: 3, mb: 3 } },
        React.createElement(Stack, { spacing: 3 },
          React.createElement(Typography, { variant: 'h6' }, '导航显示'),
          React.createElement(TextField, {
            select: true,
            label: '展开方式',
            value: config.navType,
            onChange: (event) => handleChange('navType', event.target.value)
          },
            navTypeOptions.map((option) =>
              React.createElement(MenuItem, { key: option.id, value: option.id }, option.label)
            )
          )
        )
      ),
      React.createElement(Paper, { sx: { p: 3, borderRadius: 3, mb: 3 } },
        React.createElement(Stack, { spacing: 3 },
          React.createElement(Typography, { variant: 'h6' }, '数据表配置'),
          React.createElement(TextField, {
            type: 'number',
            label: '每页行数',
            value: config.gridRows,
            onChange: (event) => handleChange('gridRows', event.target.value),
            inputProps: { min: 10, max: 500 }
          })
        )
      ),
      React.createElement(Stack, { direction: 'row', justifyContent: 'center' },
        React.createElement(Button, {
          variant: 'contained',
          size: 'large',
          onClick: handleSave,
          disabled: saving
        }, saving ? '保存中...' : '保存配置')
      ),
      React.createElement(Snackbar, { open: notify.open, autoHideDuration: 3200, onClose: closeNotify },
        React.createElement(Alert, { severity: notify.severity, onClose: closeNotify, sx: { width: '100%' } }, notify.message)
      )
    );
  };

  // 注册组件供 loader.js 读取
  window.AdminPages = window.AdminPages || {};
  window.AdminPages['sys-config-admin'] = SysConfigAdminPage;
})();
