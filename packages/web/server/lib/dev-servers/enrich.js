import os from 'node:os';
/**
 * Best-effort context for discovered dev servers.
 *
 * Discovery reports the socket's owning process, which says little when the
 * owner is a forwarder: Docker publishes through colima's ssh mux, so every
 * container listener reads "ssh". Enrichment attaches the context that makes
 * a row identifiable — the container that published the port, or the -L
 * target an ssh process forwards to. Every lookup is optional; a missing
 * tool or a failed parse only means fewer fields, never a failed scan.
 */

const DOCKER_TIMEOUT_MS = 2_000;
const PS_TIMEOUT_MS = 1_000;

/**
 * Host-side port of one `docker ps` Ports entry, e.g.
 * `127.0.0.1:34130->80/tcp`, `[::]:8080->80/tcp`, `34130->80/tcp`.
 * @param {string} entry
 * @returns {number|null}
 */
export const parseDockerPortEntry = (entry) => {
  const hostPart = entry.split('->')[0]?.trim();
  if (!hostPart) return null;
  const match = hostPart.match(/(\d+)(?:-\d+)?$/);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
};

/**
 * One `docker ps --format` output line (tab-separated) into a container entry.
 * @param {string} line
 * @returns {{ id: string, name: string, image: string, labels: Record<string, string>, hostPorts: number[] }|null}
 */
export const parseDockerPsLine = (line) => {
  const fields = line.split('\t');
  if (fields.length < 4) return null;
  const [id, name, image, portsField, labelsField = ''] = fields;
  if (!name) return null;
  const labels = {};
  for (const pair of labelsField.split(',')) {
    const index = pair.indexOf('=');
    if (index > 0) labels[pair.slice(0, index)] = pair.slice(index + 1);
  }
  const hostPorts = portsField
    .split(',')
    .map((entry) => parseDockerPortEntry(entry))
    .filter((port) => port !== null);
  return { id, name, image, labels, hostPorts };
};

/**
 * `docker ps` output into a port → container map.
 * @param {string} text
 * @returns {Map<number, { id: string, name: string, image: string, labels: Record<string, string> }>}
 */
export const parseDockerPorts = (text) => {
  const ports = new Map();
  for (const line of text.split('\n')) {
    const container = parseDockerPsLine(line.trim());
    if (!container) continue;
    const { hostPorts, ...info } = container;
    for (const port of hostPorts) ports.set(port, info);
  }
  return ports;
};

/**
 * Local forward specs of an ssh command line, e.g.
 * `ssh -L 8080:app.internal:80 -L 127.0.0.1:2222:vm:22 ...`
 * maps the local listen port onto `{ host, port }`.
 * @param {string} args
 * @returns {Map<number, { host: string, port: number }>}
 */
export const parseSshForwards = (args) => {
  const forwards = new Map();
  const tokens = args.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    let spec = null;
    if (tokens[i] === '-L') spec = tokens[i + 1];
    else if (tokens[i].startsWith('-L') && tokens[i].length > 2) spec = tokens[i].slice(2);
    if (!spec) continue;
    // [bind:]localPort:host:remotePort — an IPv6 bind arrives bracketed
    let rest = spec;
    if (rest.startsWith('[')) {
      const close = rest.indexOf(']');
      if (close === -1) continue;
      rest = rest.slice(close + 1).replace(/^:/, '');
    }
    const parts = rest.split(':').filter((part) => part !== '');
    if (parts.length < 3 || parts.length > 4) continue;
    // Three parts: port:host:rport. Four: bind:port:host:rport.
    const offset = parts.length - 3;
    const localPort = Number(parts[offset]);
    const remoteHost = parts[offset + 1];
    const remotePort = Number(parts[offset + 2]);
    if (
      Number.isInteger(localPort) && localPort > 0 && localPort <= 65535
      && remoteHost
      && Number.isInteger(remotePort) && remotePort > 0 && remotePort <= 65535
    ) {
      forwards.set(localPort, { host: remoteHost, port: remotePort });
    }
  }
  return forwards;
};

/**
 * Published host port → container info, or an empty map when docker is absent
 * or the daemon does not answer.
 * @param {(command: string, args: string[], timeoutMs: number) => Promise<string|null>} runCommand
 */
export const collectDockerPorts = async (runCommand) => {
  const output = await runCommand(
    'docker',
    ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Labels}}'],
    DOCKER_TIMEOUT_MS,
  );
  return output === null ? new Map() : parseDockerPorts(output);
};

/**
 * pid → full argv for a set of pids, one `ps` call.
 * @param {(command: string, args: string[], timeoutMs: number) => Promise<string|null>} runCommand
 * @param {number[]} pids
 * @returns {Promise<Map<number, string>>}
 */
export const collectProcessArgs = async (runCommand, pids) => {
  const args = new Map();
  if (pids.length === 0) return args;
  const output = await runCommand('ps', ['-p', pids.join(','), '-o', 'pid=,args='], PS_TIMEOUT_MS);
  if (output === null) return args;
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (match) args.set(Number(match[1]), match[2]);
  }
  return args;
};

/**
 * pid → working directory, one `lsof` call across all pids.
 * @param {(command: string, args: string[], timeoutMs: number) => Promise<string|null>} runCommand
 * @param {number[]} pids
 * @returns {Promise<Map<number, string>>}
 */
export const collectProcessCwds = async (runCommand, pids) => {
  const cwds = new Map();
  if (pids.length === 0) return cwds;
  const output = await runCommand(
    'lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-F', 'pn'], PS_TIMEOUT_MS,
  );
  if (output === null) return cwds;
  let pid = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) cwds.set(pid, line.slice(1));
  }
  return cwds;
};

/**
 * Local forward port → target for every ssh-like listener owner.
 * @param {Map<number, string>} processArgs
 */
export const collectSshForwards = (processArgs) => {
  const forwards = new Map();
  for (const args of processArgs.values()) {
    for (const [localPort, target] of parseSshForwards(args)) {
      forwards.set(localPort, target);
    }
  }
  return forwards;
};

// Binaries that live under the OS trees — listening here is macOS plumbing,
// not anything the user started.
const SYSTEM_PATH_PATTERN = /^\/(System\/(Library|CoreServices)|usr\/(lib|sbin|libexec))\//;

const sourceOf = ({ docker, forward, argv }) => {
  if (docker) return 'docker';
  if (forward) return 'forward';
  if (argv && SYSTEM_PATH_PATTERN.test(argv)) return 'system';
  return 'process';
};

// A project's name: the compose project for containers, the working directory
// basename for processes. A bare root or the home dir carries no signal.
const projectOf = ({ docker, cwd }) => {
  if (docker) return docker.labels['com.docker.compose.project'] ?? null;
  if (!cwd || cwd === '/' || cwd === os.homedir()) return null;
  const base = cwd.replace(/\/+$/, '').split('/').pop();
  return base || null;
};

/**
 * Attach `docker` / `forward` / `source` / `project` / `commandLine` / `cwd`
 * context to discovered servers.
 * @param {Array<{ port: number, pid: number|null, command: string }>} servers
 * @param {{ runCommand: (command: string, args: string[], timeoutMs: number) => Promise<string|null> }} tools
 */
export const enrichServers = async (servers, { runCommand }) => {
  const pids = [...new Set(servers.map((server) => server.pid).filter((pid) => pid !== null))];
  // Discovery already attaches `directory` from its own cwd lookup; only the
  // servers it could not resolve need a second lsof here.
  const cwdPids = [...new Set(
    servers.filter((server) => server.directory === undefined)
      .map((server) => server.pid).filter((pid) => pid !== null),
  )];
  const [dockerPorts, processArgs, processCwds] = await Promise.all([
    collectDockerPorts(runCommand),
    collectProcessArgs(runCommand, pids),
    collectProcessCwds(runCommand, cwdPids),
  ]);
  const forwards = collectSshForwards(processArgs);
  return servers.map((server) => {
    const docker = dockerPorts.get(server.port);
    const forward = docker ? null : forwards.get(server.port) ?? null;
    const argv = server.pid === null ? null : processArgs.get(server.pid) ?? null;
    const cwd = server.directory ?? (server.pid === null ? null : processCwds.get(server.pid) ?? null);
    const enriched = {
      ...server,
      source: sourceOf({ docker, forward, argv }),
      commandLine: argv ?? undefined,
      cwd: cwd ?? undefined,
    };
    if (docker) enriched.docker = docker;
    if (forward) enriched.forward = forward;
    const project = projectOf({ docker, cwd });
    if (project) enriched.project = project;
    return enriched;
  });
};
