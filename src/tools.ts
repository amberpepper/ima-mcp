import { assertImaOk, callImaApi, ImaClientError } from "./ima-client";
import { uploadFileToKnowledge } from "./upload";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const stringSchema = { type: "string" };
const numberSchema = { type: "number" };
const booleanSchema = { type: "boolean" };

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ImaClientError(`缺少必需参数：${key}`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  defaultValue: number,
): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
}

function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = args[key];
  return typeof value === "boolean" ? value : defaultValue;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ImaClientError(`参数 ${key} 必须是非空字符串数组。`);
  }
  return value;
}

function bodyWithOptionalFolder(
  body: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const folderId = optionalString(args, "folder_id");
  if (folderId) body.folder_id = folderId;
  return body;
}

function cleanResponse(response: unknown): unknown {
  return assertImaOk(response as Parameters<typeof assertImaOk>[0]);
}

export const tools: ToolDefinition[] = [
  {
    name: "ima_search_notes",
    description: "搜索 IMA 笔记，可按标题或正文搜索。",
    inputSchema: objectSchema(
      {
        query: stringSchema,
        search_type: { type: "string", enum: ["title", "content"], default: "title" },
        start: { ...numberSchema, default: 0 },
        end: { ...numberSchema, default: 20 },
      },
      ["query"],
    ),
    async handler(args) {
      const query = requireString(args, "query");
      const searchType = args.search_type === "content" ? 1 : 0;
      const start = optionalNumber(args, "start", 0);
      const end = optionalNumber(args, "end", start + 20);
      return cleanResponse(
        await callImaApi("openapi/note/v1/search_note", {
          search_type: searchType,
          query_info: searchType === 1 ? { content: query } : { title: query },
          start,
          end,
        }),
      );
    },
  },
  {
    name: "ima_list_notes",
    description: "列出 IMA 笔记。folder_id 为空时列出全部笔记。",
    inputSchema: objectSchema({
      folder_id: stringSchema,
      cursor: { ...stringSchema, default: "" },
      limit: { ...numberSchema, default: 20 },
      sort_type: { ...numberSchema, default: 0 },
    }),
    async handler(args) {
      return cleanResponse(
        await callImaApi(
          "openapi/note/v1/list_note",
          bodyWithOptionalFolder(
            {
              cursor: optionalString(args, "cursor") ?? "",
              limit: optionalNumber(args, "limit", 20),
              sort_type: optionalNumber(args, "sort_type", 0),
            },
            args,
          ),
        ),
      );
    },
  },
  {
    name: "ima_list_notebooks",
    description: "列出 IMA 笔记本。",
    inputSchema: objectSchema({
      cursor: { ...stringSchema, default: "0" },
      limit: { ...numberSchema, default: 20 },
      version: stringSchema,
    }),
    async handler(args) {
      const body: Record<string, unknown> = {
        cursor: optionalString(args, "cursor") ?? "0",
        limit: optionalNumber(args, "limit", 20),
      };
      const version = optionalString(args, "version");
      if (version) body.version = version;
      return cleanResponse(await callImaApi("openapi/note/v1/list_notebook", body));
    },
  },
  {
    name: "ima_get_note_content",
    description: "获取 IMA 笔记内容。默认返回纯文本。",
    inputSchema: objectSchema(
      {
        note_id: stringSchema,
        target_content_format: { ...numberSchema, default: 0 },
      },
      ["note_id"],
    ),
    async handler(args) {
      return cleanResponse(
        await callImaApi("openapi/note/v1/get_doc_content", {
          note_id: requireString(args, "note_id"),
          target_content_format: optionalNumber(args, "target_content_format", 0),
        }),
      );
    },
  },
  {
    name: "ima_create_note",
    description: "用 Markdown 内容创建 IMA 笔记。",
    inputSchema: objectSchema(
      {
        content: stringSchema,
        folder_id: stringSchema,
        folder_name: stringSchema,
      },
      ["content"],
    ),
    async handler(args) {
      const body = bodyWithOptionalFolder(
        {
          content_format: 1,
          content: requireString(args, "content"),
        },
        args,
      );
      const folderName = optionalString(args, "folder_name");
      if (folderName) body.folder_name = folderName;
      return cleanResponse(await callImaApi("openapi/note/v1/import_doc", body));
    },
  },
  {
    name: "ima_append_note",
    description: "向已有 IMA 笔记末尾追加 Markdown 内容。",
    inputSchema: objectSchema(
      {
        note_id: stringSchema,
        content: stringSchema,
      },
      ["note_id", "content"],
    ),
    async handler(args) {
      return cleanResponse(
        await callImaApi("openapi/note/v1/append_doc", {
          note_id: requireString(args, "note_id"),
          content_format: 1,
          content: requireString(args, "content"),
        }),
      );
    },
  },
  {
    name: "ima_search_knowledge_bases",
    description: "搜索或列出 IMA 知识库。query 为空时按接口返回默认列表。",
    inputSchema: objectSchema({
      query: { ...stringSchema, default: "" },
      cursor: { ...stringSchema, default: "" },
      limit: { ...numberSchema, default: 20 },
    }),
    async handler(args) {
      return cleanResponse(
        await callImaApi("openapi/wiki/v1/search_knowledge_base", {
          query: optionalString(args, "query") ?? "",
          cursor: optionalString(args, "cursor") ?? "",
          limit: optionalNumber(args, "limit", 20),
        }),
      );
    },
  },
  {
    name: "ima_get_addable_knowledge_bases",
    description: "获取当前用户可添加内容的 IMA 知识库列表。",
    inputSchema: objectSchema({
      cursor: { ...stringSchema, default: "" },
      limit: { ...numberSchema, default: 50 },
    }),
    async handler(args) {
      return cleanResponse(
        await callImaApi("openapi/wiki/v1/get_addable_knowledge_base_list", {
          cursor: optionalString(args, "cursor") ?? "",
          limit: optionalNumber(args, "limit", 50),
        }),
      );
    },
  },
  {
    name: "ima_get_knowledge_base",
    description: "按知识库 ID 获取 IMA 知识库信息。",
    inputSchema: objectSchema(
      {
        ids: {
          type: "array",
          items: stringSchema,
          minItems: 1,
          maxItems: 20,
        },
      },
      ["ids"],
    ),
    async handler(args) {
      return cleanResponse(
        await callImaApi("openapi/wiki/v1/get_knowledge_base", {
          ids: optionalStringArray(args, "ids"),
        }),
      );
    },
  },
  {
    name: "ima_list_knowledge",
    description: "浏览 IMA 知识库内容，可传 folder_id 进入文件夹。",
    inputSchema: objectSchema(
      {
        knowledge_base_id: stringSchema,
        folder_id: stringSchema,
        cursor: { ...stringSchema, default: "" },
        limit: { ...numberSchema, default: 50 },
      },
      ["knowledge_base_id"],
    ),
    async handler(args) {
      return cleanResponse(
        await callImaApi(
          "openapi/wiki/v1/get_knowledge_list",
          bodyWithOptionalFolder(
            {
              knowledge_base_id: requireString(args, "knowledge_base_id"),
              cursor: optionalString(args, "cursor") ?? "",
              limit: optionalNumber(args, "limit", 50),
            },
            args,
          ),
        ),
      );
    },
  },
  {
    name: "ima_search_knowledge",
    description: "在指定 IMA 知识库中搜索内容。",
    inputSchema: objectSchema(
      {
        knowledge_base_id: stringSchema,
        query: stringSchema,
        cursor: { ...stringSchema, default: "" },
      },
      ["knowledge_base_id", "query"],
    ),
    async handler(args) {
      return cleanResponse(
        await callImaApi("openapi/wiki/v1/search_knowledge", {
          knowledge_base_id: requireString(args, "knowledge_base_id"),
          query: requireString(args, "query"),
          cursor: optionalString(args, "cursor") ?? "",
        }),
      );
    },
  },
  {
    name: "ima_import_urls",
    description: "将网页或微信公众号文章 URL 导入 IMA 知识库。",
    inputSchema: objectSchema(
      {
        knowledge_base_id: stringSchema,
        folder_id: stringSchema,
        urls: {
          type: "array",
          items: stringSchema,
          minItems: 1,
          maxItems: 10,
        },
      },
      ["knowledge_base_id", "urls"],
    ),
    async handler(args) {
      return cleanResponse(
        await callImaApi(
          "openapi/wiki/v1/import_urls",
          bodyWithOptionalFolder(
            {
              knowledge_base_id: requireString(args, "knowledge_base_id"),
              urls: optionalStringArray(args, "urls"),
            },
            args,
          ),
        ),
      );
    },
  },
  {
    name: "ima_get_media_info",
    description: "获取知识库媒体的原文访问地址或笔记扩展信息。",
    inputSchema: objectSchema(
      {
        media_id: stringSchema,
      },
      ["media_id"],
    ),
    async handler(args) {
      return cleanResponse(
        await callImaApi("openapi/wiki/v1/get_media_info", {
          media_id: requireString(args, "media_id"),
        }),
      );
    },
  },
  {
    name: "ima_add_note_to_knowledge",
    description: "把已有 IMA 笔记关联添加到 IMA 知识库。",
    inputSchema: objectSchema(
      {
        knowledge_base_id: stringSchema,
        note_id: stringSchema,
        title: stringSchema,
        folder_id: stringSchema,
      },
      ["knowledge_base_id", "note_id", "title"],
    ),
    async handler(args) {
      return cleanResponse(
        await callImaApi(
          "openapi/wiki/v1/add_knowledge",
          bodyWithOptionalFolder(
            {
              media_type: 11,
              note_info: { content_id: requireString(args, "note_id") },
              title: requireString(args, "title"),
              knowledge_base_id: requireString(args, "knowledge_base_id"),
            },
            args,
          ),
        ),
      );
    },
  },
  {
    name: "ima_check_repeated_names",
    description: "上传文件前检查 IMA 知识库内是否有同名条目。",
    inputSchema: objectSchema(
      {
        knowledge_base_id: stringSchema,
        folder_id: stringSchema,
        params: {
          type: "array",
          minItems: 1,
          maxItems: 2000,
          items: objectSchema(
            {
              name: stringSchema,
              media_type: numberSchema,
            },
            ["name", "media_type"],
          ),
        },
      },
      ["knowledge_base_id", "params"],
    ),
    async handler(args) {
      const params = args.params;
      if (!Array.isArray(params)) {
        throw new ImaClientError("参数 params 必须是数组。");
      }
      return cleanResponse(
        await callImaApi(
          "openapi/wiki/v1/check_repeated_names",
          bodyWithOptionalFolder(
            {
              knowledge_base_id: requireString(args, "knowledge_base_id"),
              params,
            },
            args,
          ),
        ),
      );
    },
  },
  {
    name: "ima_upload_file_to_knowledge",
    description: "上传本地文件到 IMA 知识库：预检、查重、创建媒体、COS 上传、添加知识。",
    inputSchema: objectSchema(
      {
        file_path: stringSchema,
        knowledge_base_id: stringSchema,
        folder_id: stringSchema,
        content_type: stringSchema,
        password: stringSchema,
        fail_if_repeated: { ...booleanSchema, default: true },
        timeout_ms: { ...numberSchema, default: 300000 },
      },
      ["file_path", "knowledge_base_id"],
    ),
    async handler(args) {
      return await uploadFileToKnowledge({
        filePath: requireString(args, "file_path"),
        knowledgeBaseId: requireString(args, "knowledge_base_id"),
        folderId: optionalString(args, "folder_id"),
        contentType: optionalString(args, "content_type"),
        password: optionalString(args, "password"),
        failIfRepeated: optionalBoolean(args, "fail_if_repeated", true),
        timeoutMs: optionalNumber(args, "timeout_ms", 300_000),
      });
    },
  },
  {
    name: "ima_raw_call",
    description: "直接调用 IMA OpenAPI 相对路径，用于未封装的新接口。",
    inputSchema: objectSchema(
      {
        api_path: stringSchema,
        body: {
          type: "object",
          additionalProperties: true,
          default: {},
        },
      },
      ["api_path"],
    ),
    async handler(args) {
      const body = args.body;
      if (body !== undefined && (typeof body !== "object" || Array.isArray(body))) {
        throw new ImaClientError("body 必须是 JSON 对象。");
      }
      return cleanResponse(
        await callImaApi(requireString(args, "api_path"), (body ?? {}) as Record<string, unknown>),
      );
    },
  },
];

export type { ToolDefinition };
