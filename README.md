腾讯 IMA 开放平台（笔记 & 知识库）的 MCP Server。

**基于官方 [IMA Skill / Agent 接口](https://ima.qq.com/agent-interface) 移植为独立 MCP Server**

## 凭据

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

## 工具

| 工具 | 说明 |
|---|---|
| `ima_search_notes` | 搜索 IMA 笔记，可按标题或正文搜索 |
| `ima_list_notes` | 列出 IMA 笔记。folder_id 为空时列出全部笔记 |
| `ima_list_notebooks` | 列出 IMA 笔记本 |
| `ima_get_note_content` | 获取 IMA 笔记内容。默认返回纯文本 |
| `ima_create_note` | 用 Markdown 内容创建 IMA 笔记 |
| `ima_append_note` | 向已有 IMA 笔记末尾追加 Markdown 内容 |
| `ima_search_knowledge_bases` | 搜索或列出 IMA 知识库。query 为空时按接口返回默认列表 |
| `ima_get_addable_knowledge_bases` | 获取当前用户可添加内容的 IMA 知识库列表 |
| `ima_get_knowledge_base` | 按知识库 ID 获取 IMA 知识库信息 |
| `ima_list_knowledge` | 浏览 IMA 知识库内容，可传 folder_id 进入文件夹 |
| `ima_search_knowledge` | 在指定 IMA 知识库中搜索内容 |
| `ima_import_urls` | 将网页或微信公众号文章 URL 导入 IMA 知识库 |
| `ima_get_media_info` | 获取知识库媒体的原文访问地址或笔记扩展信息 |
| `ima_add_note_to_knowledge` | 把已有 IMA 笔记关联添加到 IMA 知识库 |
| `ima_check_repeated_names` | 上传文件前检查 IMA 知识库内是否有同名条目 |
| `ima_upload_file_to_knowledge` | 上传本地文件到 IMA 知识库：预检、查重、创建媒体、COS 上传、添加知识 |
| `ima_raw_call` | 直接调用 IMA OpenAPI 相对路径，用于未封装的新接口 |
