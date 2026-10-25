import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertImaOk, callImaApi } from "./ima-client.js";

// 官方约束:原始图片必须严格小于 3MiB(3,145,728 bytes),不得通过压缩、转码规避。
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 30_000;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

interface ImageData {
  contentType: string;
  data: Buffer;
}

interface Batch {
  type: "text" | "image";
  content: string;
}

function detectImageType(data: Buffer): string {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

function assertImageSize(data: Buffer, source: string): void {
  if (data.length >= MAX_IMAGE_BYTES) {
    throw new Error(`图片必须严格小于 3MiB：${source}`);
  }
}

function assertImageType(data: Buffer, contentType: string, source: string): string {
  const detectedType = detectImageType(data);
  if (!detectedType || (contentType && detectedType !== contentType)) {
    throw new Error(`不支持或无效的图片（仅 PNG/JPEG/WebP）：${source}`);
  }
  return detectedType;
}

function readLocalImage(filePath: string): ImageData & { absolutePath: string } {
  const absolutePath = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    throw new Error(`图片文件不存在：${absolutePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`图片路径不是文件：${absolutePath}`);
  }
  if (stat.size >= MAX_IMAGE_BYTES) {
    throw new Error(`图片必须严格小于 3MiB：${absolutePath}`);
  }
  const data = fs.readFileSync(absolutePath);
  assertImageSize(data, absolutePath);
  const contentType = assertImageType(data, "", absolutePath);
  return { absolutePath, contentType, data };
}

function parseDataUrl(source: string): ImageData {
  const match = DATA_URL_RE.exec(source);
  if (!match) {
    throw new Error("不支持或无效的 data URL，仅支持 base64 的 PNG/JPEG/WebP。");
  }
  const declaredType = match[1].toLowerCase();
  const data = Buffer.from(match[2], "base64");
  assertImageSize(data, "data URL");
  const contentType = assertImageType(data, declaredType, "data URL");
  return { contentType, data };
}

async function readResponseBody(response: Response, source: string): Promise<Buffer> {
  if (!response.body) {
    throw new Error(`远程图片没有响应体：${source}`);
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalSize = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize >= MAX_IMAGE_BYTES) {
        throw new Error(`远程图片必须严格小于 3MiB：${source}`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalSize);
}

async function fetchRemoteImage(source: string): Promise<ImageData> {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error(`无效的图片 URL：${source}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`不支持的图片来源：${source}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "image/png,image/jpeg,image/webp,image/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`远程图片下载超时：${source}`);
    }
    throw new Error(`远程图片下载失败：${source}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`远程图片请求失败：HTTP ${response.status}：${source}`);
  }
  const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType && !IMAGE_TYPES.has(contentType) && contentType !== "application/octet-stream") {
    throw new Error(`远程响应不是图片（${contentType}）：${source}`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength >= MAX_IMAGE_BYTES) {
    throw new Error(`远程图片必须严格小于 3MiB：${source}`);
  }

  const data = await readResponseBody(response, source);
  const detectedType = assertImageType(data, IMAGE_TYPES.has(contentType) ? contentType : "", source);
  assertImageSize(data, source);
  return { contentType: detectedType, data };
}

function toDataUrl(image: ImageData): string {
  return `data:${image.contentType};base64,${image.data.toString("base64")}`;
}

function localPath(source: string): string {
  if (source.startsWith("file://")) {
    let decoded = decodeURIComponent(source.slice("file://".length));
    if (/^\/[A-Za-z]:[\\/]/.test(decoded)) decoded = decoded.slice(1);
    return decoded;
  }
  if (source.startsWith("/") || /^[A-Za-z]:[\\/]/.test(source)) {
    return source;
  }
  return "";
}

async function imageContent(alt: string, source: string): Promise<string> {
  if (source.startsWith("data:")) {
    return `![${alt}](${toDataUrl(parseDataUrl(source))})`;
  }
  const filePath = localPath(source);
  if (filePath) {
    return `![${alt}](${toDataUrl(readLocalImage(filePath))})`;
  }
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return `![${alt}](${toDataUrl(await fetchRemoteImage(source))})`;
  }
  throw new Error(`不支持的图片来源：${source}`);
}

async function createBatches(markdown: string): Promise<Batch[]> {
  const batches: Batch[] = [];
  let text = "";
  let lastIndex = 0;
  const flushText = () => {
    if (text.trim()) batches.push({ type: "text", content: text });
    text = "";
  };

  for (const match of markdown.matchAll(IMAGE_RE)) {
    const index = match.index ?? 0;
    text += markdown.slice(lastIndex, index);
    flushText();
    batches.push({ type: "image", content: await imageContent(match[1], match[2].trim()) });
    lastIndex = index + match[0].length;
  }
  text += markdown.slice(lastIndex);
  flushText();
  return batches;
}

async function appendBatches(noteId: string, batches: Batch[]): Promise<unknown[]> {
  const results: unknown[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    try {
      assertImaOk(
        await callImaApi("openapi/note/v1/append_doc", {
          note_id: noteId,
          content_format: 1,
          content: batch.content,
        }),
      );
      results.push({ batch: index + 1, type: batch.type, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 失败即停：任一批次失败立即停止，已成功批次不回滚。
      throw new Error(
        `第 ${index + 1}/${batches.length} 批（${batch.type}）追加失败：${message}；前面 ${
          results.length
        } 批已写入，不会回滚。`,
      );
    }
  }
  return results;
}

export async function insertImagesToNote(args: {
  noteId: string;
  content?: string;
  filePath?: string;
  dryRun?: boolean;
}): Promise<unknown> {
  const hasContent = typeof args.content === "string" && args.content.length > 0;
  const hasFile = typeof args.filePath === "string" && args.filePath.trim().length > 0;
  if (hasContent === hasFile) {
    throw new Error("content 和 file_path 必须二选一。");
  }

  let markdown: string;
  if (hasContent) {
    markdown = args.content as string;
  } else {
    const resolved = path.resolve(args.filePath as string);
    try {
      markdown = fs.readFileSync(resolved, "utf8");
    } catch (error) {
      throw new Error(`无法读取输入文件：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const batches = await createBatches(markdown);
  if (!batches.length) {
    throw new Error("输入内容为空。");
  }

  if (args.dryRun) {
    return {
      note_id: args.noteId,
      batches: batches.map((batch, index) => ({
        index: index + 1,
        type: batch.type,
        bytes: Buffer.byteLength(batch.content),
      })),
    };
  }

  const results = await appendBatches(args.noteId, batches);
  return { note_id: args.noteId, batch_count: batches.length, results };
}

export async function getImageUrl(args: { imagePath: string }): Promise<unknown> {
  const image = readLocalImage(args.imagePath);
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ima-note-image-"));
  const normalizedPath = path.join(tempDirectory, `image${EXT_BY_TYPE[image.contentType]}`);
  try {
    fs.copyFileSync(image.absolutePath, normalizedPath);
    const upload = assertImaOk(
      await callImaApi<{ coskey?: string }>("openapi/mcp_cloud_agent/upload_temp_file", {
        file_path: normalizedPath,
      }),
    );
    const coskey = upload.data?.coskey;
    if (typeof coskey !== "string" || !coskey) {
      throw new Error("upload_temp_file 未返回 data.coskey。");
    }
    const access = assertImaOk(
      await callImaApi<{ download_url?: string }>("openapi/mcp_cloud_agent/get_access_url", {
        coskey,
      }),
    );
    const downloadUrl = access.data?.download_url;
    if (typeof downloadUrl !== "string" || !downloadUrl) {
      throw new Error("get_access_url 未返回 data.download_url。");
    }
    return { download_url: downloadUrl };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}
