export interface LSInfo {
    pid: number;
    csrfToken: string;
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

        const target = processes.find((p: any) => p.CommandLine && p.CommandLine.includes('--csrf_token'));
        if (!target) {
            throw new Error("Language Server process with --csrf_token not found.");
        }

        const csrfMatch = target.CommandLine.match(/--csrf_token\s+([\S]+)/);
        if (!csrfMatch) {
            throw new Error("CSRF token not found in command line.");
        }

        return {
            pid: target.ProcessId,
            csrfToken: csrfMatch[1]
        };
    } catch (e) {
        if (e instanceof Error) {
            throw e;
        }
        throw new Error("Failed to parse Windows process list.", { cause: e });
    }
}

/**
 * Parses the netstat output to find the listening port for a JSON PID
 */
export function parseWindowsPort(stdout: string): number {
    // Extract port from: TCP 127.0.0.1:12345 0.0.0.0:0 LISTENING PID
    const portMatches = Array.from(stdout.matchAll(/127\.0\.0\.1:(\d+)/g)).map(m => parseInt(m[1]));
    if (portMatches.length === 0) {
        throw new Error("No loopback ports found in netstat output.");
    }
    return portMatches[0];
}

/**
 * Parses the ps aux output for Mac/Linux
 */
export function parseUnixProcessList(stdout: string): LSInfo {
    const lines = stdout.trim().split('\n');
    if (lines.length === 0 || !lines[0]) {
        throw new Error("No matching processes found.");
    }

    const targetLine = lines[0];
    const csrfMatch = targetLine.match(/--csrf_token\s+([\S]+)/);
    const pidMatch = targetLine.match(/^\S+\s+(\d+)/);

    if (!csrfMatch) {
        throw new Error("CSRF token not found in process list.");
    }
    if (!pidMatch) {
        throw new Error("PID not found in process list.");
    }

    return {
        pid: parseInt(pidMatch[1]),
        csrfToken: csrfMatch[1]
    };
}

/**
 * Parses lsof output to find the listening port
 */
export function parseUnixPort(stdout: string): number {
    const portMatches = Array.from(stdout.matchAll(/127\.0\.0\.1:(\d+)/g)).map(m => parseInt(m[1]));
    if (portMatches.length === 0) {
        throw new Error("No loopback ports found in lsof output.");
    }
    return portMatches[0];
}
