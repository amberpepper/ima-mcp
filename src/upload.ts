import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { assertImaOk, callImaApi } from "./ima-client";

const MB = 1024 * 1024;
const DEFAULT_SIZE_LIMIT = 200 * MB;
const SIZE_LIMITS: Record<number, number> = {
  5: 10 * MB,
  7: 10 * MB,
  9: 30 * MB,
  13: 10 * MB,
  14: 10 * MB,
};

const EXT_MAP: Record<string, { mediaType: number; contentType: string }> = {
  pdf: { mediaType: 1, contentType: "application/pdf" },
  doc: { mediaType: 3, contentType: "application/msword" },
  docx: {
    mediaType: 3,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ppt: { mediaType: 4, contentType: "application/vnd.ms-powerpoint" },
  pptx: {
    mediaType: 4,
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  xls: { mediaType: 5, contentType: "application/vnd.ms-excel" },
  xlsx: {
    mediaType: 5,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  csv: { mediaType: 5, contentType: "text/csv" },
  md: { mediaType: 7, contentType: "text/markdown" },
  markdown: { mediaType: 7, contentType: "text/markdown" },
  png: { mediaType: 9, contentType: "image/png" },
  jpg: { mediaType: 9, contentType: "image/jpeg" },
  jpeg: { mediaType: 9, contentType: "image/jpeg" },
  webp: { mediaType: 9, contentType: "image/webp" },
  txt: { mediaType: 13, contentType: "text/plain" },
  xmind: { mediaType: 14, contentType: "application/x-xmind" },
  mp3: { mediaType: 15, contentType: "audio/mpeg" },
  m4a: { mediaType: 15, contentType: "audio/x-m4a" },
  wav: { mediaType: 15, contentType: "audio/wav" },
  aac: { mediaType: 15, contentType: "audio/aac" },
};

const CONTENT_TYPE_MEDIA_TYPES: Record<string, number> = {
  "text/x-markdown": 7,
  "application/md": 7,
  "application/markdown": 7,
  "application/vnd.xmind.workbook": 14,
  "application/zip": 14,
};

for (const value of Object.values(EXT_MAP)) {
  CONTENT_TYPE_MEDIA_TYPES[value.contentType] ??= value.mediaType;
}

const UNSUPPORTED_VIDEO_EXT = new Set([
  "mp4",
  "avi",
  "mov",
  "mkv",
  "wmv",
  "flv",
  "webm",
  "m4v",
  "rmvb",
  "rm",
  "3gp",
]);

interface PreflightResult {
  filePath: string;
  fileName: string;
  fileExt: string;
  fileSize: number;
  lastModifyTime: number;
  mediaType: number;
  contentType: string;
}

interface CosCredential {
  token: string;
  secret_id: string;
  secret_key: string;
  start_time: number;
  expired_time: number;
  appid?: string;
  bucket_name: string;
  region: string;
  cos_key: string;
}

function preflight(filePath: string, contentType?: string): PreflightResult {
  const resolvedPath = path.resolve(filePath);
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`不是文件：${resolvedPath}`);
  }

  const fileName = path.basename(resolvedPath);
  const fileExt = path.extname(fileName).replace(/^\./, "").toLowerCase();
  if (UNSUPPORTED_VIDEO_EXT.has(fileExt)) {
    throw new Error(`不支持上传视频文件 .${fileExt}，请使用 IMA 桌面客户端添加。`);
  }

  const normalizedContentType = contentType?.split(";")[0]?.trim().toLowerCase();
  const mediaTypeFromContentType = normalizedContentType
    ? CONTENT_TYPE_MEDIA_TYPES[normalizedContentType]
    : undefined;
  const byExt = EXT_MAP[fileExt];
  const mediaType = mediaTypeFromContentType ?? byExt?.mediaType;
  const resolvedContentType = normalizedContentType && mediaTypeFromContentType
    ? normalizedContentType
    : byExt?.contentType;

  if (!mediaType || !resolvedContentType) {
    throw new Error(`不支持的文件类型：${fileName}`);
  }

  const sizeLimit = SIZE_LIMITS[mediaType] ?? DEFAULT_SIZE_LIMIT;
  if (stat.size > sizeLimit) {
    throw new Error(
      `文件过大：${fileName} 为 ${formatSize(stat.size)}，该类型限制为 ${formatSize(sizeLimit)}。`,
    );
  }

  return {
    filePath: resolvedPath,
    fileName,
    fileExt,
    fileSize: stat.size,
    lastModifyTime: Math.floor(stat.mtimeMs / 1000),
    mediaType,
    contentType: resolvedContentType,
  };
}

function formatSize(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}

function hmacSha1(key: string | Buffer, data: string): string {
  return crypto.createHmac("sha1", key).update(data).digest("hex");
}

function sha1(data: string): string {
  return crypto.createHash("sha1").update(data).digest("hex");
}

function buildAuthorization(options: {
  secretId: string;
  secretKey: string;
  method: string;
  pathname: string;
  headers: Record<string, string>;
  startTime: number;
  expiredTime: number;
}): string {
  const keyTime = `${options.startTime};${options.expiredTime}`;
  const signKey = hmacSha1(options.secretKey, keyTime);
  const headerKeys = Object.keys(options.headers).sort();
  const httpHeaders = headerKeys
    .map((key) => `${key.toLowerCase()}=${encodeURIComponent(options.headers[key] ?? "")}`)
    .join("&");
  const httpString = `${options.method.toLowerCase()}\n${options.pathname}\n\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signature = hmacSha1(signKey, stringToSign);
  const headerList = headerKeys.map((key) => key.toLowerCase()).join(";");

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${options.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    "q-url-param-list=",
    `q-signature=${signature}`,
  ].join("&");
}

async function uploadToCos(options: {
  filePath: string;
  contentType: string;
  credential: CosCredential;
  timeoutMs: number;
}): Promise<void> {
  const fileContent = fs.readFileSync(options.filePath);
  const credential = options.credential;
  const bucket =
    credential.appid && !credential.bucket_name.endsWith(`-${credential.appid}`)
      ? `${credential.bucket_name}-${credential.appid}`
      : credential.bucket_name;
  const hostname = `${bucket}.cos.${credential.region}.myqcloud.com`;
  const pathname = `/${credential.cos_key}`;
  const signHeaders = {
    "content-length": String(fileContent.length),
    host: hostname,
  };
  const authorization = buildAuthorization({
    secretId: credential.secret_id,
    secretKey: credential.secret_key,
    method: "PUT",
    pathname,
    headers: signHeaders,
    startTime: credential.start_time,
    expiredTime: credential.expired_time,
  });

  await new Promise<void>((resolve, reject) => {
    const request = https.request(
      {
        hostname,
        port: 443,
        path: pathname,
        method: "PUT",
        headers: {
          "Content-Type": options.contentType,
          "Content-Length": fileContent.length,
          Authorization: authorization,
          "x-cos-security-token": credential.token,
        },
        timeout: options.timeoutMs,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`COS 上传失败：HTTP ${response.statusCode} ${body}`));
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`COS 上传超时：${options.timeoutMs}ms`));
    });
    request.on("error", reject);
    request.write(fileContent);
    request.end();
  });
}

export async function uploadFileToKnowledge(args: {
  filePath: string;
  knowledgeBaseId: string;
  folderId?: string;
  contentType?: string;
  password?: string;
  failIfRepeated?: boolean;
  timeoutMs?: number;
}): Promise<unknown> {
  const file = preflight(args.filePath, args.contentType);
  const repeatedBody: Record<string, unknown> = {
    params: [{ name: file.fileName, media_type: file.mediaType }],
    knowledge_base_id: args.knowledgeBaseId,
  };
  if (args.folderId) repeatedBody.folder_id = args.folderId;

  const repeatedResponse = assertImaOk(
    await callImaApi<{ results?: Array<{ name: string; is_repeated: boolean }> }>(
      "openapi/wiki/v1/check_repeated_names",
      repeatedBody,
    ),
  );
  const repeated = repeatedResponse.data?.results?.some((item) => item.is_repeated);
  if (repeated && args.failIfRepeated !== false) {
    throw new Error(`知识库中已存在同名文件：${file.fileName}`);
  }

  const createResponse = assertImaOk(
    await callImaApi<{ media_id: string; cos_credential: CosCredential }>(
      "openapi/wiki/v1/create_media",
      {
        file_name: file.fileName,
        file_size: file.fileSize,
        content_type: file.contentType,
        knowledge_base_id: args.knowledgeBaseId,
        file_ext: file.fileExt,
      },
    ),
  );

  const mediaId = createResponse.data?.media_id;
  const credential = createResponse.data?.cos_credential;
  if (!mediaId || !credential) {
    throw new Error("create_media 未返回 media_id 或 cos_credential。");
  }

  await uploadToCos({
    filePath: file.filePath,
    contentType: file.contentType,
    credential,
    timeoutMs: args.timeoutMs ?? 300_000,
  });

  const addBody: Record<string, unknown> = {
    media_type: file.mediaType,
    media_id: mediaId,
    title: file.fileName,
    knowledge_base_id: args.knowledgeBaseId,
    file_info: {
      cos_key: credential.cos_key,
      file_size: file.fileSize,
      last_modify_time: file.lastModifyTime,
      password: args.password ?? "",
      file_name: file.fileName,
    },
  };
  if (args.folderId) addBody.folder_id = args.folderId;

  const addResponse = assertImaOk(
    await callImaApi("openapi/wiki/v1/add_knowledge", addBody),
  );

  return {
    file,
    media_id: mediaId,
    repeated,
    add_knowledge: addResponse,
  };
}
