const DEFAULT_TIMEOUT_MS = 20_000;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Retries on 429 and 5xx with exponential backoff. */
  retries?: number;
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2 } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          ...headers,
        },
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const body = await res.text().catch(() => "");
        const error = new UpstreamError(
          `${res.status} ${res.statusText} from ${url}${body ? ` — ${body.slice(0, 200)}` : ""}`,
          res.status,
          url
        );
        if (!retryable || attempt === retries) throw error;
        lastError = error;
      } else {
        return (await res.json()) as T;
      }
    } catch (err) {
      if (err instanceof UpstreamError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
      if (attempt === retries) break;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 350 * 2 ** attempt));
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}
