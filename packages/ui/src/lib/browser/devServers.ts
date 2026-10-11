/**
 * Client for dev-server discovery.
 *
 * The result is a tagged union rather than an array, because "no dev server is
 * running" and "we could not look" lead to different UI and must not collapse
 * into the same empty list.
 */
import { runtimeFetch } from '@/lib/runtime-fetch';

export type DevServerDockerInfo = {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly labels: Readonly<Record<string, string>>;
};

export type DevServerForwardInfo = {
  readonly host: string;
  readonly port: number;
};

export type DiscoveredDevServer = {
  readonly port: number;
  readonly url: string;
  readonly command: string;
  /** Container that published this port, when the owner is a Docker forward. */
  readonly docker?: DevServerDockerInfo;
  /** -L target this port forwards to, when the owner is an ssh process. */
  readonly forward?: DevServerForwardInfo;
};

export type DevServerDiscovery =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly servers: ReadonlyArray<DiscoveredDevServer> }
  | { readonly kind: 'unavailable' };

const isDiscoveredServer = (value: unknown): value is DiscoveredDevServer => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.port === 'number'
    && Number.isFinite(record.port)
    && typeof record.url === 'string'
    && record.url.length > 0
    && typeof record.command === 'string';
};

/**
 * The servers listening where this directory's code runs: on the host, or
 * inside the isolated space that owns the directory, which the request is
 * addressed to by its directory.
 */
export const fetchDevServers = async (signal: AbortSignal | undefined, directory: string): Promise<DevServerDiscovery> => {
  try {
    const response = await runtimeFetch('/api/dev-servers', { signal, directory });
    if (!response.ok) return { kind: 'unavailable' };

    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return { kind: 'unavailable' };

    const servers = (body as { servers?: unknown }).servers;
    if (!Array.isArray(servers)) return { kind: 'unavailable' };

    return { kind: 'ready', servers: servers.filter(isDiscoveredServer) };
  } catch {
    return { kind: 'unavailable' };
  }
};

/**
 * Asks the server for the HTTP status a loopback URL currently returns.
 *
 * A dev server fronted by a gateway answers requests before the app behind it
 * is up, returning a 5xx page. That is a successful load as far as the browser
 * is concerned, so it produces no navigation failure — the status is the only
 * honest signal, short of reading the page and guessing from its contents.
 *
 * Returns null when the status could not be established.
 */
export const probeLoopbackStatus = async (url: string): Promise<number | null> => {
  try {
    const response = await runtimeFetch('/api/system/probe-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;
    const status = (body as { status?: unknown }).status;
    return typeof status === 'number' && Number.isFinite(status) ? status : null;
  } catch {
    return null;
  }
};

export type DevServerCandidate = {
  readonly url: string;
  readonly port: number;
  /** The owning process's command name, or '' when discovery did not supply one. */
  readonly command: string;
  /** Present when a server announced this address itself. */
  readonly announced: boolean;
  readonly docker?: DevServerDockerInfo;
  readonly forward?: DevServerForwardInfo;
};

/**
 * What a row says under the address: the container that published the port,
 * the host a forward points at, the owning process, or the base path. A bare
 * `ssh` or `node` says less than any of these.
 */
export const devServerContextLabel = (candidate: DevServerCandidate): string => {
  if (candidate.docker) return candidate.docker.name;
  if (candidate.forward) return `${candidate.forward.host}:${candidate.forward.port}`;
  return candidate.command || pathLabel(candidate.url);
};

const pathLabel = (url: string): string => {
  try {
    const path = new URL(url).pathname;
    return path === '/' ? '' : path;
  } catch {
    return '';
  }
};

const portOf = (url: string): number | null => {
  try {
    const parsed = new URL(url);
    const port = Number.parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
};

/**
 * Combines what servers said with what is actually listening.
 *
 * Each source knows something the other cannot. An announcement carries the base
 * path an app is served under, which a socket cannot reveal. A listening port is
 * ground truth, which an announcement is not: terminals wrap long lines, and a
 * URL split mid-port reads as a perfectly plausible address on a port where
 * nothing is running.
 *
 * So discovery decides which servers exist and announcements supply their paths.
 * When discovery is unavailable the announcements stand on their own — offering
 * something unverified beats offering nothing.
 */
export const mergeDevServerCandidates = ({
  announced,
  discovered,
}: {
  announced: ReadonlyArray<string>;
  discovered: ReadonlyArray<DiscoveredDevServer> | null;
}): DevServerCandidate[] => {
  const announcedByPort = new Map<number, string>();
  for (const url of announced) {
    const port = portOf(url);
    if (port !== null && !announcedByPort.has(port)) announcedByPort.set(port, url);
  }

  if (!discovered) {
    return [...announcedByPort.entries()]
      .map(([port, url]) => ({ url, port, command: '', announced: true }))
      .sort((left, right) => left.port - right.port);
  }

  return discovered
    .map((server) => {
      const announcedUrl = announcedByPort.get(server.port);
      return {
        url: announcedUrl ?? server.url,
        port: server.port,
        command: server.command,
        announced: announcedUrl !== undefined,
        docker: server.docker,
        forward: server.forward,
      };
    })
    .sort((left, right) => {
      // Servers this run announced come first: they are the ones just started.
      if (left.announced !== right.announced) return left.announced ? -1 : 1;
      return left.port - right.port;
    });
};
