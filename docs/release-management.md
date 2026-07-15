# Poleis 版本发布与自动升级

## 发布模型

安装包由 `platform + architecture + channel + versionCode` 唯一标识。平台支持 `windows`、`android`、`macos`、`ios`，渠道支持 `stable`、`beta`，通用安装包的架构使用 `universal`。

`versionName` 是用户可读版本号，`versionCode` 是严格递增的整数。客户端仅使用 `versionCode` 判断新旧。服务端在上传时计算 SHA-256，客户端校验通过后才启动安装。

强制升级条件为：发布记录设置了 `mandatory`，或客户端的当前 `versionCode` 小于 `minSupportedVersionCode`。其他新版本均为可选升级。

## 后台和存储

超级管理员从“运营平台 / 版本发布”上传、发布、下架和删除安装包，并设置更新说明、强制升级及最低支持版本。

安装包默认保存在 `pweb/storage/releases`。生产环境建议通过 `RELEASE_STORAGE_DIR` 指向持久卷。单文件默认上限为 2 GiB，可通过 `RELEASE_MAX_FILE_SIZE` 调整。数据库迁移位于 `prisma/migrations/20260714180000_add_app_releases`。

首页“客户端下载”优先展示四个平台最新的稳定版本；某平台没有稳定版时回退展示最新 Beta 版本并标识渠道。未发布安装包的平台显示“敬请期待”。

## API

检查最新版本：

```text
GET /api/releases/latest?platform=windows&architecture=x64&channel=stable&currentVersionCode=1
```

响应中的 `updateAvailable` 表示存在更高版本，`mandatory` 表示本次升级不可跳过，`data` 包含 `versionName`、`versionCode`、`downloadUrl`、`sha256` 和 `releaseNotes`。

- `GET /api/releases/downloads`：首页各平台最新稳定版
- `GET /downloads/releases/:id`：下载安装包
- `/release-admin/releases`：管理员版本列表、上传、修改与删除

## Windows 发布

```powershell
cmake -S . -B build -DPOLEIS_VERSION_NAME=1.1.0 -DPOLEIS_VERSION_CODE=2
cmake --build build --target poleis-qt --config Release
```

Windows 客户端启动后三秒检查稳定版，下载并校验 SHA-256 后启动 `.exe` 或 `.msi`。`AutoUpdater.config` 可关闭检查，或用 `apiBaseUrl` 覆盖运行时 API 地址；空值表示复用 Poleis 服务器地址。

## Android 发布

发布前同步提升 `app/build.gradle.kts` 中的 `versionName` 和 `versionCode`，并使用与已安装版本相同的正式证书签名 APK。当前 APK 包含多个 ABI，后台架构应选择 `universal`。

Android 客户端启动时检查稳定版，通过系统下载服务下载 APK，校验 SHA-256 后打开系统安装器。Android 8 及以上首次升级需要授予“安装未知应用”权限；强制升级弹窗不可关闭，授权返回后继续安装。

## 推荐发布流程

1. 提升客户端 `versionCode` 并设置 `versionName`。
2. 使用正式证书构建、签名安装包。
3. 后台选择正确平台、架构、渠道并上传。
4. 设置更新说明、强制策略和最低支持版本。
5. 先保持未发布完成下载验证，再切换为已发布。
6. 使用旧客户端分别验证可选升级和强制升级。
