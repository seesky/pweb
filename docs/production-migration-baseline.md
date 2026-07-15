# 生产数据库首次接入 Prisma Migrate

Poleis 的生产数据库早于 `prisma/migrations` 存在，因此第一次执行 `prisma migrate deploy` 会触发 `P3005`。禁止对生产库执行 `prisma migrate reset`。

## 1. 备份

```bash
mysqldump --single-transaction --routines --triggers -u root -p poleis-web \
  > /root/poleis-web-$(date +%Y%m%d-%H%M%S).sql
```

## 2. 建立迁移基线

```bash
npx prisma migrate resolve --applied 0_existing_database_baseline
```

该操作只创建 Prisma 迁移历史并记录基线，不执行建表、删表或修改业务数据。

## 3. 核对旧迁移

检查 `20260706120000_add_relay_nodes` 对应结构是否已经存在：

```bash
mysql -u root -p poleis-web -e "
SELECT TABLE_NAME FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='poleis-web' AND TABLE_NAME='poleis_relay_node';
SELECT COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='poleis-web' AND TABLE_NAME='poleis_session'
   AND COLUMN_NAME IN ('RELAYNODEID','RELAYBYTES');"
```

如果表和两个字段都存在，将该旧迁移标记为已应用：

```bash
npx prisma migrate resolve --applied 20260706120000_add_relay_nodes
```

如果三项都不存在，不要标记，后续 `migrate deploy` 会创建它们。如果只存在一部分，先停止部署并人工核对，避免旧迁移执行到一半失败。

## 4. 部署待执行迁移

```bash
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

正常情况下，`20260714180000_add_app_releases` 会创建版本发布表，现有业务表和数据不会被清空。

## 5. 重启和验证

使用服务器现有的 PM2 或 systemd 方式重启 pweb，然后验证：

```bash
curl -fsS http://127.0.0.1:3000/api/releases/downloads
```
