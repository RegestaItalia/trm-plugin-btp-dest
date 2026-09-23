import { isAxiosError } from "axios";

export class CfRefreshTokenExpiredError extends Error {
    constructor() {
        super(`Cloud Foundry session expired, BTP login required.`);
        this.name = 'CfRefreshTokenExpiredError';
    }
}

// Short, human readable reason of a failure (HTTP status and server message, when available)
export function getErrorReason(e: unknown): string {
    if (isAxiosError(e)) {
        if (e.response) {
            const data = e.response.data;
            const detail = data?.error_description || data?.description || data?.message || data?.error;
            return typeof detail === 'string' && detail ? `HTTP ${e.response.status}, ${detail}` : `HTTP ${e.response.status}`;
        }
        return e.code ? `${e.code}, ${e.message}` : e.message;
    }
    if (e instanceof Error) {
        return e.message;
    }
    return String(e);
}

export function getHttpStatus(e: unknown): number | undefined {
    return isAxiosError(e) ? e.response?.status : undefined;
}
