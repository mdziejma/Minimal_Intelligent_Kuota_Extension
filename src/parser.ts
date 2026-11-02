export interface LSInfo {
    pid: number;
    csrfToken: string;
    hubPort?: number;
    extensionServerPort?: number;
    extensionServerCsrfToken?: string;
}

/**
 * Parses the PowerShell output from Get-WmiObject Win32_Process
 */
export function parseWindowsProcessList(stdout: string): LSInfo {
    try {
        let processes = JSON.parse(stdout);
        if (!Array.isArray(processes)) {
            processes = [processes];
        }

        const candidates = processes.filter((p: any) => p.CommandLine && p.CommandLine.includes('--csrf_token'));
        const target = candidates.find((p: any) => p.CommandLine.includes('--hub')) || candidates[0];
        if (!target) {
            throw new Error("Language Server process with --csrf_token not found.");
        }

        const csrfMatch = target.CommandLine.match(/--csrf_token(?:=|\s+)([\S]+)/);
        if (!csrfMatch) {
            throw new Error("CSRF token not found in command line.");
        }

        const hubPortMatch = target.CommandLine.match(/--hub[-_]port(?:=|\s+)(\d+)/);
        const extPortMatch = target.CommandLine.match(/--extension_server_port(?:=|\s+)(\d+)/);
        const extCsrfMatch = target.CommandLine.match(/--extension_server_csrf_token(?:=|\s+)([\S]+)/);

        return {
            pid: target.ProcessId,
            csrfToken: csrfMatch[1],
            hubPort: hubPortMatch ? parseInt(hubPortMatch[1]) : undefined,
            extensionServerPort: extPortMatch ? parseInt(extPortMatch[1]) : undefined,
            extensionServerCsrfToken: extCsrfMatch ? extCsrfMatch[1] : undefined
        };
    } catch (e) {
        if (e instanceof Error) {
            throw e;
        }
        throw new Error("Failed to parse Windows process list.", { cause: e });
    }
}

/**
 * Parses the netstat output to find all listening loopback ports for a PID
 */
export function parseWindowsPorts(stdout: string): number[] {
    const portMatches = Array.from(stdout.matchAll(/127\.0\.0\.1:(\d+)/g)).map(m => parseInt(m[1]));
    const uniquePorts = Array.from(new Set(portMatches));
    if (uniquePorts.length === 0) {
        throw new Error("No loopback ports found in netstat output.");
    }
    return uniquePorts;
}

/**
 * Parses the netstat output to find the listening port for a JSON PID
 */
export function parseWindowsPort(stdout: string): number {
    return parseWindowsPorts(stdout)[0];
}

/**
 * Parses the ps aux output for Mac/Linux
 */
export function parseUnixProcessList(stdout: string): LSInfo {
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
        throw new Error("No matching processes found.");
    }

    const csrfLines = lines.filter(l => l.includes('--csrf_token'));
    const targetLine = csrfLines.find(l => l.includes('--hub')) || csrfLines[0] || lines[0];
    const csrfMatch = targetLine.match(/--csrf_token(?:=|\s+)([\S]+)/);
    const pidMatch = targetLine.match(/^\S+\s+(\d+)/);
    const hubPortMatch = targetLine.match(/--hub[-_]port(?:=|\s+)(\d+)/);
    const extPortMatch = targetLine.match(/--extension_server_port(?:=|\s+)(\d+)/);
    const extCsrfMatch = targetLine.match(/--extension_server_csrf_token(?:=|\s+)([\S]+)/);

    if (!csrfMatch) {
        throw new Error("CSRF token not found in process list.");
    }
    if (!pidMatch) {
        throw new Error("PID not found in process list.");
    }

    return {
        pid: parseInt(pidMatch[1]),
        csrfToken: csrfMatch[1],
        hubPort: hubPortMatch ? parseInt(hubPortMatch[1]) : undefined,
        extensionServerPort: extPortMatch ? parseInt(extPortMatch[1]) : undefined,
        extensionServerCsrfToken: extCsrfMatch ? extCsrfMatch[1] : undefined
    };
}

/**
 * Parses lsof output to find all listening loopback ports
 */
export function parseUnixPorts(stdout: string): number[] {
    const portMatches = Array.from(stdout.matchAll(/127\.0\.0\.1:(\d+)/g)).map(m => parseInt(m[1]));
    const uniquePorts = Array.from(new Set(portMatches));
    if (uniquePorts.length === 0) {
        throw new Error("No loopback ports found in lsof output.");
    }
    return uniquePorts;
}

/**
 * Parses lsof output to find the listening port
 */
export function parseUnixPort(stdout: string): number {
    return parseUnixPorts(stdout)[0];
}
