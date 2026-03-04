import { expect } from 'chai';
import { parseWindowsProcessList, parseWindowsPort, parseUnixProcessList, parseUnixPort } from '../src/parser';

describe('Parser logic', () => {

    describe('Windows Parser', () => {
        it('should parse Windows process list JSON correctly', () => {
            const mockStdout = JSON.stringify({
                CommandLine: "C:\\path\\to\\language_server_windows.exe --csrf_token abc-123-def",
                ProcessId: 1234
            });
            const result = parseWindowsProcessList(mockStdout);
            expect(result.pid).to.equal(1234);
            expect(result.csrfToken).to.equal('abc-123-def');
        });

        it('should handle array output from PowerShell', () => {
            const mockStdout = JSON.stringify([
                { CommandLine: "other_process.exe", ProcessId: 1 },
                { CommandLine: "language_server_windows.exe --csrf_token token-xyz", ProcessId: 5678 }
            ]);
            const result = parseWindowsProcessList(mockStdout);
            expect(result.pid).to.equal(5678);
            expect(result.csrfToken).to.equal('token-xyz');
        });

        it('should parse Windows port from netstat correctly', () => {
            const mockStdout = "TCP    127.0.0.1:49967        0.0.0.0:0              LISTENING       1234";
            const port = parseWindowsPort(mockStdout);
            expect(port).to.equal(49967);
        });

        it('should throw error if CSRF token is missing in Windows', () => {
            const mockStdout = JSON.stringify({
                CommandLine: "language_server_windows.exe --no-token",
                ProcessId: 1234
            });
            expect(() => parseWindowsProcessList(mockStdout)).to.throw("Language Server process with --csrf_token not found.");
        });
    });

    describe('Unix Parser (Mac/Linux)', () => {
        it('should parse Unix ps aux output correctly', () => {
            const mockStdout = "user     12345  0.0  0.1  123456  7890 ? S 10:00 0:01 /path/to/language_server_macos --csrf_token unix-token-456";
            const result = parseUnixProcessList(mockStdout);
            expect(result.pid).to.equal(12345);
            expect(result.csrfToken).to.equal('unix-token-456');
        });

        it('should parse Unix port from lsof correctly', () => {
            const mockStdout = "language_ 12345 user 3u IPv4 0x1234 0t0 TCP 127.0.0.1:54321 (LISTEN)";
            const port = parseUnixPort(mockStdout);
            expect(port).to.equal(54321);
        });

        it('should throw error if process line is empty on Unix', () => {
            expect(() => parseUnixProcessList("")).to.throw("No matching processes found.");
        });
    });
});
