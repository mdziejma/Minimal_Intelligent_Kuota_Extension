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

        it('should parse Antigravity agy --hub process with equals-sign flags', () => {
            const mockStdout = [
                "user      7845  1.7  1.5 437370672 384096 ?? S 11:20AM 1:00.06 /Applications/Antigravity.app/Contents/Resources/bin/language_server --standalone --csrf_token standalone-token-123",
                "user     13566  0.1  1.2 437188688 301504 ?? S  1:56PM 0:01.64 /Users/user/.gemini/bin/agy --hub --hub-port=56444 --app_data_dir=antigravity --csrf_token=hub-token-789"
            ].join('\n');
            const result = parseUnixProcessList(mockStdout);
            expect(result.pid).to.equal(13566);
            expect(result.csrfToken).to.equal('hub-token-789');
            expect(result.hubPort).to.equal(56444);
        });

        it('should parse standalone language_server process without _macos suffix', () => {
            const mockStdout = "user      7845  1.7  1.5 437370672 384096 ?? S 11:20AM 1:00.06 /Applications/Antigravity.app/Contents/Resources/bin/language_server --standalone --csrf_token standalone-token-123";
            const result = parseUnixProcessList(mockStdout);
            expect(result.pid).to.equal(7845);
            expect(result.csrfToken).to.equal('standalone-token-123');
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
