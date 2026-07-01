# 客户端配置指南

ManageYourLLM 对外固定提供 `/v1` 网关入口。客户端只需要三项：

- **Base URL**：`publicBaseUrl + /v1`，例如 `https://llm.example.com/v1`。
- **API Key**：Clients 页面创建的 Client key。
- **Model**：Models 或 Channels 中的可请求名称。

Setup Wizard 完成页和 Clients 页面会生成配置片段，优先复制页面中的片段。

## OpenAI-compatible

```bash
curl -X POST https://llm.example.com/v1/chat/completions \
  -H "Authorization: Bearer <client-key>" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-5", "messages": [{"role": "user", "content": "Hello"}]}'
```

Python:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://llm.example.com/v1",
    api_key="<client-key>",
)

response = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "Hello"}],
)
```

## Anthropic-compatible

```bash
export ANTHROPIC_BASE_URL="https://llm.example.com/v1"
export ANTHROPIC_API_KEY="<client-key>"
```

客户端请求的 model 可以是 Model 名，也可以是 Channel 名，例如 `coder`。

## Codex / OpenAI Responses

```bash
export OPENAI_BASE_URL="https://llm.example.com/v1"
export OPENAI_API_KEY="<client-key>"
codex --model "coder"
```

## 注意事项

- Client key 创建或轮换后只显示一次。
- 首版一个 Client 只有一个 active key。
- 首版不做模型权限；有效 Client key 可以访问所有已启用的 Model / Channel。
- 如果请求失败，优先到 Traces 查看候选过滤和 failover 过程。
