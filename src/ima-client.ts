import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BASE_URL = "https://ima.qq.com";
const SERVER_VERSION = "0.1.0";

export interface ImaResponse<T = unknown> {
  code?: number;
  msg?: string;
  data?: T;
  [key: string]: unknown;
}

export class ImaClientError extends Error {
  public readonly code: number;
  public readonly details?: unknown;

  constructor(message: string, code = -100, details?: unknown) {
    super(message);
    this.name = "ImaClientError";
    this.code = code;
    this.details = details;
  }
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function loadCredentials(): { clientId: string; apiKey: string } {
  const clientId =
    process.env.IMA_CLIENT_ID ||
    process.env.IMA_OPENAPI_CLIENTID ||
    readFileSafe(path.join(os.homedir(), ".config/ima/client_id"));
  const apiKey =
    process.env.IMA_API_KEY ||
    process.env.IMA_OPENAPI_APIKEY ||
    readFileSafe(path.join(os.homedir(), ".config/ima/api_key"));

  if (!clientId || !apiKey) {
    throw new ImaClientError(
      "未找到 IMA 凭证。请设置 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY，或写入 ~/.config/ima/client_id 和 ~/.config/ima/api_key。",
    );
  }

  return { clientId, apiKey };
}

export async function callImaApi<T = unknown>(
  apiPath: string,
  body: Record<string, unknown>,
): Promise<ImaResponse<T>> {
  if (!apiPath || apiPath.startsWith("/") || apiPath.includes("://")) {
    throw new ImaClientError("apiPath 必须是相对路径，例如 openapi/note/v1/search_note。");
  }

  const { clientId, apiKey } = loadCredentials();
  const baseUrl = process.env.IMA_BASE_URL || DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl}/${apiPath}`, {
    method: "POST",
    headers: {
      "ima-openapi-clientid": clientId,
      "ima-openapi-apikey": apiKey,
      "ima-openapi-ctx": `mcp_version=${SERVER_VERSION}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: ImaResponse<T>;
  try {
    parsed = JSON.parse(text) as ImaResponse<T>;
  } catch {
    throw new ImaClientError(`IMA 返回了非 JSON 响应：HTTP ${response.status}`, -100, {
      status: response.status,
      body: text,
    });
  }

  if (!response.ok) {
    throw new ImaClientError(`IMA 请求失败：HTTP ${response.status}`, -100, parsed);
  }

  return parsed;
}

export function assertImaOk<T>(response: ImaResponse<T>): ImaResponse<T> {
  if (typeof response.code === "number" && response.code !== 0) {
    throw new ImaClientError(response.msg || `IMA API 返回错误码 ${response.code}`, response.code, response);
  }

  return response;
}
