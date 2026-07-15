(function () {
  'use strict';

  const emptyForm = () => ({
    platform: 'windows', architecture: 'x64', channel: 'stable', versionName: '',
    versionCode: '', minSupportedVersionCode: '0', mandatory: false, published: true,
    releaseNotes: '', installer: null
  });
  const platformLabels = { windows: 'Windows', android: 'Android', macos: 'macOS', ios: 'iOS' };
  const architectures = {
    windows: ['x64', 'arm64', 'universal'],
    android: ['universal', 'arm64-v8a', 'armeabi-v7a', 'x86_64'],
    macos: ['universal', 'x64', 'arm64'],
    ios: ['universal', 'arm64']
  };
  const formatSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    return (bytes / 1024).toFixed(1) + ' KB';
  };

  const ReleaseAdminPage = () => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [dialog, setDialog] = useState({ open: false, mode: 'create', id: '' });
    const [form, setForm] = useState(emptyForm());
    const [saving, setSaving] = useState(false);
    const [notify, setNotify] = useState({ open: false, severity: 'success', message: '' });

    const loadRows = useCallback(async () => {
      setLoading(true); setError('');
      try {
        const response = await fetch('/release-admin/releases');
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || '加载版本列表失败');
        setRows(result.data || []);
      } catch (requestError) {
        setError(requestError.message || '加载版本列表失败');
      } finally { setLoading(false); }
    }, []);

    useEffect(() => { loadRows(); }, [loadRows]);

    const openCreate = () => { setForm(emptyForm()); setDialog({ open: true, mode: 'create', id: '' }); };
    const openEdit = (row) => {
      setForm({
        platform: row.platform, architecture: row.architecture, channel: row.channel,
        versionName: row.versionName, versionCode: String(row.versionCode),
        minSupportedVersionCode: String(row.minSupportedVersionCode || 0),
        mandatory: !!row.mandatory, published: !!row.published,
        releaseNotes: row.releaseNotes || '', installer: null
      });
      setDialog({ open: true, mode: 'edit', id: row.id });
    };
    const closeDialog = () => { if (!saving) setDialog({ open: false, mode: 'create', id: '' }); };

    const save = async () => {
      if (!form.versionName.trim() || form.versionCode === '') {
        setNotify({ open: true, severity: 'warning', message: '请填写版本名称和版本代码' }); return;
      }
      if (dialog.mode === 'create' && !form.installer) {
        setNotify({ open: true, severity: 'warning', message: '请选择安装包文件' }); return;
      }
      setSaving(true);
      try {
        let response;
        if (dialog.mode === 'create') {
          const body = new FormData();
          Object.keys(form).forEach((key) => {
            if (key === 'installer') body.append('installer', form.installer);
            else body.append(key, String(form[key]));
          });
          response = await fetch('/release-admin/releases', { method: 'POST', body });
        } else {
          response = await fetch('/release-admin/releases/' + dialog.id, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              versionName: form.versionName, versionCode: Number(form.versionCode),
              minSupportedVersionCode: Number(form.minSupportedVersionCode || 0),
              mandatory: form.mandatory, published: form.published, releaseNotes: form.releaseNotes
            })
          });
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || '保存版本失败');
        setNotify({ open: true, severity: 'success', message: result.message || '版本已保存' });
        setDialog({ open: false, mode: 'create', id: '' });
        await loadRows();
      } catch (requestError) {
        setNotify({ open: true, severity: 'error', message: requestError.message || '保存版本失败' });
      } finally { setSaving(false); }
    };

    const remove = async (row) => {
      if (!window.confirm('确定删除 ' + row.versionName + ' 及其安装包吗？')) return;
      const response = await fetch('/release-admin/releases/' + row.id, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) setNotify({ open: true, severity: 'error', message: result.message || '删除失败' });
      else { setNotify({ open: true, severity: 'success', message: '版本已删除' }); await loadRows(); }
    };

    return React.createElement(Stack, { spacing: 2 },
      React.createElement(Paper, { sx: { p: 2.5, borderRadius: 3 } },
        React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', spacing: 2 },
          React.createElement(Box, null,
            React.createElement(Typography, { variant: 'h6' }, '应用版本发布'),
            React.createElement(Typography, { variant: 'body2', color: 'text.secondary' }, '管理 Windows、Android、macOS 和 iOS 安装包，并控制强制升级策略。')
          ),
          React.createElement(Button, { variant: 'contained', startIcon: React.createElement(Icon, null, 'upload_file'), onClick: openCreate }, '上传新版本')
        )
      ),
      error ? React.createElement(Alert, { severity: 'error' }, error) : null,
      React.createElement(Paper, { sx: { borderRadius: 3, overflow: 'hidden' } },
        loading ? React.createElement(LinearProgress, null) : null,
        React.createElement(TableContainer, null,
          React.createElement(Table, { size: 'small' },
            React.createElement(TableHead, null, React.createElement(TableRow, null,
              ['平台', '版本', '渠道/架构', '升级策略', '文件', '状态', '操作'].map((label) => React.createElement(TableCell, { key: label }, label))
            )),
            React.createElement(TableBody, null,
              rows.map((row) => React.createElement(TableRow, { key: row.id, hover: true },
                React.createElement(TableCell, null, platformLabels[row.platform] || row.platform),
                React.createElement(TableCell, null,
                  React.createElement(Typography, { sx: { fontWeight: 700 } }, row.versionName),
                  React.createElement(Typography, { variant: 'caption', color: 'text.secondary' }, 'Code ' + row.versionCode)
                ),
                React.createElement(TableCell, null, row.channel + ' / ' + row.architecture),
                React.createElement(TableCell, null,
                  React.createElement(Chip, { size: 'small', color: row.mandatory ? 'error' : 'default', label: row.mandatory ? '强制' : '可选' }),
                  row.minSupportedVersionCode ? React.createElement(Typography, { variant: 'caption', display: 'block' }, '最低 ' + row.minSupportedVersionCode) : null
                ),
                React.createElement(TableCell, null,
                  React.createElement(Typography, { variant: 'body2' }, row.originalName),
                  React.createElement(Typography, { variant: 'caption', color: 'text.secondary' }, formatSize(row.fileSize))
                ),
                React.createElement(TableCell, null, React.createElement(Chip, { size: 'small', color: row.published ? 'success' : 'default', label: row.published ? '已发布' : '已下架' })),
                React.createElement(TableCell, null,
                  React.createElement(Stack, { direction: 'row', spacing: 0.5 },
                    React.createElement(IconButton, { size: 'small', title: '编辑', onClick: () => openEdit(row) }, React.createElement(Icon, { fontSize: 'small' }, 'edit')),
                    React.createElement(IconButton, { size: 'small', title: '下载', component: 'a', href: row.downloadUrl }, React.createElement(Icon, { fontSize: 'small' }, 'download')),
                    React.createElement(IconButton, { size: 'small', title: '删除', color: 'error', onClick: () => remove(row) }, React.createElement(Icon, { fontSize: 'small' }, 'delete'))
                  )
                )
              )),
              !rows.length && !loading ? React.createElement(TableRow, null, React.createElement(TableCell, { colSpan: 7, align: 'center', sx: { py: 5, color: 'text.secondary' } }, '暂无版本')) : null
            )
          )
        )
      ),
      React.createElement(Dialog, { open: dialog.open, onClose: closeDialog, maxWidth: 'sm', fullWidth: true },
        React.createElement(DialogTitle, null, dialog.mode === 'create' ? '上传新版本' : '编辑版本策略'),
        React.createElement(DialogContent, null,
          React.createElement(Stack, { spacing: 2, sx: { mt: 1 } },
            React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 2 },
              React.createElement(TextField, { select: true, label: '平台', disabled: dialog.mode === 'edit', value: form.platform, onChange: (e) => setForm((p) => ({ ...p, platform: e.target.value, architecture: architectures[e.target.value][0] })) },
                ['windows', 'android', 'macos', 'ios'].map((value) => React.createElement(MenuItem, { key: value, value }, platformLabels[value]))
              ),
              React.createElement(TextField, { select: true, label: '架构', disabled: dialog.mode === 'edit', value: form.architecture, onChange: (e) => setForm((p) => ({ ...p, architecture: e.target.value })) },
                architectures[form.platform].map((value) => React.createElement(MenuItem, { key: value, value }, value))
              )
            ),
            React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 2 },
              React.createElement(TextField, { select: true, label: '渠道', disabled: dialog.mode === 'edit', value: form.channel, onChange: (e) => setForm((p) => ({ ...p, channel: e.target.value })) },
                ['stable', 'beta'].map((value) => React.createElement(MenuItem, { key: value, value }, value))
              ),
              React.createElement(TextField, { label: '版本名称', value: form.versionName, onChange: (e) => setForm((p) => ({ ...p, versionName: e.target.value })) })
            ),
            React.createElement(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 2 },
              React.createElement(TextField, { label: '版本代码', type: 'number', value: form.versionCode, onChange: (e) => setForm((p) => ({ ...p, versionCode: e.target.value })) }),
              React.createElement(TextField, { label: '最低支持版本代码', type: 'number', value: form.minSupportedVersionCode, onChange: (e) => setForm((p) => ({ ...p, minSupportedVersionCode: e.target.value })) })
            ),
            dialog.mode === 'create' ? React.createElement(Button, { component: 'label', variant: 'outlined', startIcon: React.createElement(Icon, null, 'attach_file') },
              form.installer ? form.installer.name : '选择安装包',
              React.createElement('input', { hidden: true, type: 'file', onChange: (e) => setForm((p) => ({ ...p, installer: e.target.files && e.target.files[0] })) })
            ) : null,
            React.createElement(TextField, { label: '更新说明', multiline: true, minRows: 3, value: form.releaseNotes, onChange: (e) => setForm((p) => ({ ...p, releaseNotes: e.target.value })) }),
            React.createElement(Stack, { direction: 'row', spacing: 2 },
              React.createElement(FormControlLabel, { control: React.createElement(Switch, { checked: form.mandatory, onChange: (e) => setForm((p) => ({ ...p, mandatory: e.target.checked })) }), label: '强制升级' }),
              React.createElement(FormControlLabel, { control: React.createElement(Switch, { checked: form.published, onChange: (e) => setForm((p) => ({ ...p, published: e.target.checked })) }), label: '立即发布' })
            )
          )
        ),
        React.createElement(DialogActions, null,
          React.createElement(Button, { onClick: closeDialog, disabled: saving }, '取消'),
          React.createElement(Button, { variant: 'contained', onClick: save, disabled: saving }, saving ? '保存中...' : '保存')
        )
      ),
      React.createElement(Snackbar, { open: notify.open, autoHideDuration: 3500, onClose: () => setNotify((p) => ({ ...p, open: false })) },
        React.createElement(Alert, { severity: notify.severity, onClose: () => setNotify((p) => ({ ...p, open: false })) }, notify.message)
      )
    );
  };

  window.AdminPages = window.AdminPages || {};
  window.AdminPages['release-admin'] = ReleaseAdminPage;
})();
