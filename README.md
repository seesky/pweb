# pweb

首次部署使用独立的[图形化安装器](setup/README.md)：执行 `npm ci`、`npm run setup`，
打开终端显示的安装链接。完成配置、数据库和管理员初始化后退出安装器，执行 `npm start`。

The web service installs its dependencies with npm. Poleis desktop, Poleis Android,
and temporary third-party development checkouts are maintained as separate repositories;
they are not recursive submodules of this web service.
