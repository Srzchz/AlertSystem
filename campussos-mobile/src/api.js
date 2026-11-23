import { API_URL } from './config';

// Calls the CampusSOS server. No login token is sent.
// Errors carry a `kind`:
//   'network' - fetch failed (also `offline: true`)
//   'timeout' - no response within `timeoutMs`
//   'http'    - non-2xx response, with `status` and the server's `error` message
export async function api(path, { method = 'GET', body, headers, timeoutMs } = {}) {
  const controller = timeoutMs ? new AbortController() : null;
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
    : null;

  try {
    let res;
    try {
      res = await fetch(`${API_URL}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });
    } catch {
      throw timedOut ? timeoutError() : networkError();
    }

    let data;
    try {
      data = await res.json();
    } catch {
      if (timedOut) throw timeoutError();
      data = {};
    }

    if (!res.ok) {
      throw Object.assign(new Error(data.error || 'Request failed'), { kind: 'http', status: res.status });
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function networkError() {
  return Object.assign(new Error('Cannot reach the server'), { kind: 'network', offline: true });
}

function timeoutError() {
  return Object.assign(new Error('The server took too long to respond'), { kind: 'timeout' });
}

// True when an SOS did not reach the server: network error, timeout, or HTTP 5xx.
export function isDeliveryFailure(err) {
  if (!err) return false;
  if (err.kind === 'network' || err.kind === 'timeout') return true;
  return err.kind === 'http' && typeof err.status === 'number' && err.status >= 500;
}
