# @mcp_link/ima-mcp

MCP server for Tencent IMA OpenAPI (notes & knowledge base).

**基于官方 [IMA Skill / Agent 接口](https://ima.qq.com/agent-interface) 移植为独立 MCP Server**（将 skill 能力封装为 MCP tools，便于在 MCP 客户端中调用）。

## Credentials

通过环境变量配置：

```bash
export IMA_OPENAPI_CLIENTID="your_client_id"
export IMA_OPENAPI_APIKEY="your_api_key"
```

或写入本地文件：

```bash
~/.config/ima/client_id
~/.config/ima/api_key
```

## 开发

```bash
pnpm install   # 或 npm install
pnpm run build
pnpm run typecheck
```

## MCP 配置示例

```json
{
  "name": "ima",
  "serverType": "local",
  "command": "node",
  "args": ["/path/to/ima-mcp/dist/index.js"],
  "env": {
    "IMA_OPENAPI_CLIENTID": "your_client_id",
    "IMA_OPENAPI_APIKEY": "your_api_key"
  }
}
```

## Tools

- `ima_search_notes`
- `ima_list_notes`
- `ima_list_notebooks`
- `ima_get_note_content`
- `ima_create_note`
- `ima_append_note`
- `ima_search_knowledge_bases`
- `ima_get_addable_knowledge_bases`
- `ima_get_knowledge_base`
- `ima_list_knowledge`
- `ima_search_knowledge`
- `ima_import_urls`
- `ima_get_media_info`
- `ima_add_note_to_knowledge`
- `ima_check_repeated_names`
- `ima_upload_file_to_knowledge`
- `ima_raw_call`
