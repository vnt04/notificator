export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
export const BACKOFF_JITTER_RATIO = 0.2;

export interface BackoffOptions {
    readonly baseMs: number;
    readonly maxMs: number;
    readonly jitterRatio: number;
    readonly random: () => number;
}

/**
 * Độ trễ trước lần thử lại thứ `attempt` (1-based): base · 2^(attempt-1), chặn ở maxMs.
 *
 * Jitter chỉ **trừ** chứ không cộng, nên maxMs là trần thật. `random` inject được
 * để test xác định — mặc định `Math.random`.
 */
export function backoffDelay(
    attempt: number,
    options: Partial<BackoffOptions> = {},
): number {
    const {
        baseMs = BACKOFF_BASE_MS,
        maxMs = BACKOFF_MAX_MS,
        jitterRatio = BACKOFF_JITTER_RATIO,
        random = Math.random,
    } = options;

    const step = Math.max(1, Math.trunc(attempt)) - 1;
    const capped = Math.min(baseMs * 2 ** step, maxMs);

    return Math.round(capped * (1 - jitterRatio * random()));
}
