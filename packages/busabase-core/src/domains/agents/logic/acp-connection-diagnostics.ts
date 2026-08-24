import { createHash, randomUUID } from "node:crypto";

export const ACP_CONNECTION_ID_HEADER = "x-acp-connection-id";

const MAX_DIAGNOSTIC_TEXT_LENGTH = 500;

export interface AcpErrorDiagnostics {
  message: string;
  errorName: string;
  errorCode?: string | number;
  errorDetails?: string;
}

export interface AcpEndpointDiagnostics {
  endpoint?: string;
  agentRef?: string;
}

export const createAcpConnectionId = (): string => `acp_${randomUUID()}`;

export const redactAcpDiagnosticText = (value: string): string =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])/gi, "Bearer [REDACTED]")
    .replace(/\b(sk|bso)_[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])/g, "$1_[REDACTED]")
    .replace(
      /([?&](?:access_token|api_key|authorization|refresh_token|token)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b((?:access_token|api_key|cookie|refresh_token|session_token)\s*[:=]\s*)[^,;\s]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);

export const hashAcpIdentifier = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
};

export const describeAcpEndpoint = (value: string | undefined): AcpEndpointDiagnostics => {
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      endpoint: `${url.protocol}//${url.host}${url.pathname}`,
      agentRef: hashAcpIdentifier(url.searchParams.get("agentId")),
    };
  } catch {
    return { endpoint: "invalid-url" };
  }
};

export const describeAcpError = (error: unknown): AcpErrorDiagnostics => {
  const record = typeof error === "object" && error !== null ? error : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const rawName = error instanceof Error ? error.name : "Error";
  const rawCode = record && "code" in record ? record.code : undefined;
  const rawData = record && "data" in record ? record.data : undefined;
  const rawDetails =
    typeof rawData === "object" && rawData !== null && "details" in rawData
      ? rawData.details
      : undefined;
  const errorDetails =
    typeof rawDetails === "string" ? redactAcpDiagnosticText(rawDetails) : undefined;
  const message = redactAcpDiagnosticText(rawMessage);

  return {
    message: errorDetails || message,
    errorName: redactAcpDiagnosticText(rawName),
    errorCode: typeof rawCode === "string" || typeof rawCode === "number" ? rawCode : undefined,
    errorDetails,
  };
};
