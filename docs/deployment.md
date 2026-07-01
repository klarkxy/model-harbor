# 部署指南

ManageYourLLM 是单进程 Node 应用，同一端口服务管理 UI、Admin API、Gateway API 和健康检查。生产推荐 Docker。

## Docker

```bash
docker build -t manageyourllm:latest .
```

```bash
docker run -d \
  --name manageyourllm \
  -p 5420:5420 \
  -e NODE_ENV=production \
  -e MYLLM_SECRET_KEY='替换为强随机字符串' \
  -e MYLLM_PUBLIC_BASE_URL='https://llm.example.com' \
  -v manageyourllm-data:/app/data \
  -v manageyourllm-logs:/app/logs \
  -v manageyourllm-backups:/app/backups \
  manageyourllm:latest
```

首个管理员通过 Setup Wizard 创建。生产环境必须显式设置 `MYLLM_SECRET_KEY`。

## 环境变量

所有变量支持 `MYLLM_` 和 `MANAGE_YOUR_LLM_` 前缀。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MYLLM_SECRET_KEY` | 生产必填 | 加密 provider secret。首次设置后不要更换。 |
| `MYLLM_DATABASE_URL` | 否 | SQLite 路径，默认 `data/manageyourllm.sqlite`。 |
| `MYLLM_PUBLIC_BASE_URL` | 否 | 对外访问地址，用于配置片段。 |
| `MYLLM_HOST` | 否 | 默认 `0.0.0.0`。 |
| `MYLLM_PORT` | 否 | 默认 `5420`。 |
| `MYLLM_TRUST_PROXY` | 否 | Fastify trustProxy 配置。 |
| `MYLLM_LOG_LEVEL` | 否 | 默认 `info`。 |
| `MYLLM_LOG_FILE` | 否 | 默认 `logs/app.log`。 |

v1 网关路径固定为 `/v1`，不提供 gateway base path 配置。

## 卷

| 路径 | 用途 |
| --- | --- |
| `/app/data` | SQLite 数据库 |
| `/app/logs` | 日志 |
| `/app/backups` | 备份 |

## 反向代理

反向代理把根路径全部转发到后端即可。Gateway API 位于 `/v1`，Admin API 位于 `/api/admin`。

Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name llm.example.com;

    location / {
        proxy_pass http://127.0.0.1:5420;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

设置反向代理后，将 `MYLLM_PUBLIC_BASE_URL` 设置为公网 HTTPS 地址，并按部署环境设置 `MYLLM_TRUST_PROXY`。

## 开发运行

```bash
pnpm install
pnpm dev
```

默认：

- API: `http://127.0.0.1:5420`
- Web: `http://127.0.0.1:5421`

Vite 会代理 `/api` 和 `/v1`。

## 升级

1. 在 Backups 创建完整数据库备份。
2. 保留原 `MYLLM_SECRET_KEY`。
3. 拉取新镜像或重新构建。
4. 使用原数据卷启动。
5. 启动后检查 Overview、Providers、Traces 和 Backups。
