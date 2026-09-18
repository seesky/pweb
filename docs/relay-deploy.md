# Poleis coturn 中继节点部署与上线检查

Poleis 的托管 Relay 池使用标准 coturn REST API 临时凭证。现有 coturn 的协议无需改变：Web 端仍用 `HMAC-SHA1(static-auth-secret, username)` 签发临时 TURN 密码，客户端当前通过 UDP 使用 TURN。

## coturn 必要配置

每个节点至少应包含以下配置（按实际网卡和域名调整）：

```ini
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=<至少 32 字节随机密钥>
realm=poleis
no-multicast-peers
no-loopback-peers
```

节点管理页面中的主机、UDP 端口、静态密钥和 Realm 必须与这里一致。主机需解析到公网 IPv4；防火墙需要放通 coturn 监听端口以及 coturn 配置的 UDP relay 端口范围。`TLS 端口`目前仅保存展示，Poleis 客户端不会使用它。页面中的带宽上限也只是元数据，实际限速必须在 coturn/宿主机侧配置。

推荐为每个节点使用不同的随机静态密钥。若希望所有节点共享平台默认值，可在 Web 服务配置 `RELAY_DEFAULT_STATIC_SECRET`，但数据库中未单独配置密钥的节点会随该环境变量一起变更，轮换时必须同步 coturn。

## Web 服务配置

参照 `.env.example` 配置：

- `RELAY_ALLOW_PRIVATE_HOSTS=false`：默认阻止 localhost、私网、链路本地、保留地址，避免用户借 Relay 探测器访问内网。只有完全受信任的私有部署才应开启。
- `RELAY_MAX_TENANT_NODES` / `RELAY_MAX_GLOBAL_NODES`：限制节点数量。
- `RELAY_PROBE_CONCURRENCY`：UDP STUN 健康探测并发度。
- `RELAY_ALLOW_LEGACY_HEARTBEAT_AUTH=false`：旧 sidecar 心跳迁移开关，与 coturn 的 TURN 鉴权无关。

`POLEIS_RELAY_ENABLED` 控制的是旧版 Web 进程内 PRLY Relay，不是 coturn 节点池开关。生产已部署 coturn 时可以继续保持 `false`。

## 健康状态与排空

Web 每 15 秒对已启用节点发送 UDP STUN Binding 请求。连续三次失败后节点变为 offline；TCP 端口可连接不会被视为可用，因为当前客户端只走 UDP。选择“排空”后不再给新会话分配该节点，已有 TURN 凭证和会话自然结束；选择“恢复”后重新进入探测，STUN 成功后自动 online。

删除节点只会停止新分配并删除平台记录，无法撤销已经发给客户端且仍在有效期内的 coturn 凭证。如需立即阻断，必须同时在 coturn/防火墙侧停用对应服务或密钥。

## 可选 sidecar 心跳

不部署 sidecar 也能依赖 UDP STUN 探测维护在线状态。若需要上报 `activeSessions` 和 `totalBytes`，新版心跳请求使用：

```text
X-Relay-Timestamp: <Unix 秒>
X-Relay-Nonce: <16-128 位随机字符串>
X-Relay-Signature: HMAC-SHA256(secret,
  "<nodeId>:<timestamp>:<nonce>:<activeSessions>:<totalBytes>") 的十六进制值
```

请求 JSON 中缺少某项时，该项在签名串中使用空字符串。时间偏差最多 300 秒，nonce 不可重复；配置 Redis 时会在多个 Web 实例之间原子去重，Redis 故障时退化为单实例内存去重。升级 sidecar 期间可临时设置 `RELAY_ALLOW_LEGACY_HEARTBEAT_AUTH=true`，兼容旧的 `HMAC-SHA1(secret, "nodeId:timestamp")`；迁移完成后应关闭。

## 上线前检查

1. 在公网环境确认域名解析到预期 IPv4，UDP 3478 和 coturn relay 端口范围可达。
2. 新增节点，确认页面显示“已配置密钥”，并在约 15 秒内变为“在线”。
3. 用两个不同网络的客户端建立连接并强制触发 Relay，确认双方收到相同节点、Realm、用户名和凭证。
4. 分别验证个人空间、企业空间只会使用自己的 tenant 节点或平台 global 节点，不能选中其他租户节点。
5. 验证排空、恢复、删除行为，并观察 coturn 日志中的 Allocate/CreatePermission/ChannelBind。
