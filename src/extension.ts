import * as vscode from 'vscode';
import * as https from 'https';
import { exec } from 'child_process';

let proStatusBarItem: vscode.StatusBarItem;
let flashStatusBarItem: vscode.StatusBarItem;
let extStatusBarItem: vscode.StatusBarItem;

let activeQuotas: {
    pro?: any;
    flash?: any;
    ext?: any;
} = {};

let lastKnownPercentages: { [key: string]: number | null } = { pro: null, flash: null, ext: null };
let countdownInterval: NodeJS.Timeout | undefined;
let lastSeenModels: string[] = [];

export async function activate(context: vscode.ExtensionContext) {
    console.log('Minimal Intelligent Kuota Extension is now active!');

    // Create status bar items with priorities to keep them in order
    // Pro (Leftmost), then Flash, then Ext (Rightmost)
    proStatusBarItem = vscode.window.createStatusBarItem('mike.pro', vscode.StatusBarAlignment.Right, 1003);
    proStatusBarItem.name = 'M.I.K.E. Pro';
    proStatusBarItem.command = 'mikeQuota.showDetails';
    context.subscriptions.push(proStatusBarItem);

    flashStatusBarItem = vscode.window.createStatusBarItem('mike.flash', vscode.StatusBarAlignment.Right, 1002);
    flashStatusBarItem.name = 'M.I.K.E. Flash';
    flashStatusBarItem.command = 'mikeQuota.showDetails';
    context.subscriptions.push(flashStatusBarItem);

    extStatusBarItem = vscode.window.createStatusBarItem('mike.ext', vscode.StatusBarAlignment.Right, 1001);
    extStatusBarItem.name = 'M.I.K.E. External';
    extStatusBarItem.command = 'mikeQuota.showDetails';
    context.subscriptions.push(extStatusBarItem);

    // Register refresh command
    context.subscriptions.push(vscode.commands.registerCommand('mikeQuota.refresh', async () => {
        await updateQuotaData(true);
    }));

    // Register detailed info command
    context.subscriptions.push(vscode.commands.registerCommand('mikeQuota.showDetails', async () => {
        const info = activeQuotas;
        let detailMsg = "M.I.K.E. Quota Status:\n\n";
        let hasData = false;

        if (info.pro) {
            const p = Math.round(info.pro.quotaInfo.remainingFraction * 100);
            detailMsg += `PRO: ${p}% (Resets at ${new Date(info.pro.quotaInfo.resetTime).toLocaleTimeString()})\n`;
            hasData = true;
        } else {
            detailMsg += `PRO: Unknown / Not Configured\n`;
        }

        if (info.flash) {
            const p = Math.round(info.flash.quotaInfo.remainingFraction * 100);
            detailMsg += `FLASH: ${p}% (Resets at ${new Date(info.flash.quotaInfo.resetTime).toLocaleTimeString()})\n`;
            hasData = true;
        } else {
            detailMsg += `FLASH: Unknown / Not Configured\n`;
        }

        if (info.ext) {
            const p = Math.round(info.ext.quotaInfo.remainingFraction * 100);
            detailMsg += `EXTERNAL: ${p}% (Resets at ${new Date(info.ext.quotaInfo.resetTime).toLocaleTimeString()})\n`;
            hasData = true;
        } else {
            detailMsg += `EXTERNAL: Unknown / Not Configured\n`;
        }

        if (!hasData) {
            detailMsg += "\nNote: No active quota information found. Is the Language Server running?\n";
        }

        detailMsg += `\n--- Debug Info ---\nModels Processed:\n${lastSeenModels.length > 0 ? lastSeenModels.join('\n') : 'None yet'}\n`;

        vscode.window.showInformationMessage(detailMsg, "Refresh Now").then(selection => {
            if (selection === "Refresh Now") {
                vscode.commands.executeCommand('mikeQuota.refresh');
            }
        });
    }));

    // Initial refresh
    await updateQuotaData();

    // Setup periodic data fetch (every 1 minute for better accuracy)
    const dataFetchInterval = setInterval(() => updateQuotaData(), 60000);
    context.subscriptions.push({ dispose: () => clearInterval(dataFetchInterval) });

    // Setup visual countdown update (every 1 second)
    countdownInterval = setInterval(() => updateStatusBarDisplay(), 1000);
    context.subscriptions.push({ dispose: () => { if (countdownInterval) clearInterval(countdownInterval); } });
}

/**
 * Fetches the latest quota data from the Language Server
 */
async function updateQuotaData(manual: boolean = false) {
    if (manual) {
        // Show loading state on all items
        [proStatusBarItem, flashStatusBarItem, extStatusBarItem].forEach(item => {
            if (item.text.includes('%')) { // Only if already showing something
                // Just keep it, or show a spin icon
            }
        });
    }

    try {
        const { port, csrfToken } = await findLanguageServerInfo();

        // Fetch from BOTH endpoints for maximum coverage
        const cascadeData = await fetchEndpoint(port, csrfToken, '/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigData');
        const cascadeModels = cascadeData.clientModelConfigs || [];

        // Also try GetUserStatus as a fallback source
        let userModels: any[] = [];
        try {
            const userData = await fetchEndpoint(port, csrfToken, '/exa.language_server_pb.LanguageServerService/GetUserStatus');
            userModels = userData.user?.cascadeModelConfigs?.clientModelConfigs || [];
        } catch (_) { /* ignore */ }

        // Merge: cascade models are the primary source, user models fill gaps
        const allModels = [...cascadeModels];
        for (const um of userModels) {
            if (!allModels.find((cm: any) => cm.label === um.label)) {
                allModels.push(um);
            }
        }

        lastSeenModels = allModels.map((m: any) => `- ${m.label} (Has Quota: ${!!m.quotaInfo})`);

        // Categorize models
        activeQuotas.pro = allModels.find((m: any) => m.label.includes('Gemini 3.1 Pro') && m.quotaInfo);
        activeQuotas.flash = allModels.find((m: any) => m.label.includes('Gemini 3 Flash') && m.quotaInfo);
        activeQuotas.ext = allModels.find((m: any) => (m.label.includes('Claude') || m.label.includes('GPT')) && m.quotaInfo);

        updateStatusBarDisplay();

        if (manual) {
            vscode.window.setStatusBarMessage(`Quota data refreshed.`, 3000);
        }

        // Check for alerts (Transitions from high to low)
        checkAlerts('pro', activeQuotas.pro);
        checkAlerts('flash', activeQuotas.flash);
        checkAlerts('ext', activeQuotas.ext);

    } catch (err) {
        console.error("Quota Fetch Error:", err);
        if (manual) {
            vscode.window.showErrorMessage("Failed to refresh quota. Ensure the Language Server running.");
        }
    }
}

/**
 * Updates the visual display of status bar items without fetching new data
 */
function updateStatusBarDisplay() {
    updateSingleItem(proStatusBarItem, activeQuotas.pro, "$(star-full)", "PRO");
    updateSingleItem(flashStatusBarItem, activeQuotas.flash, "$(zap)", "FLASH");
    updateSingleItem(extStatusBarItem, activeQuotas.ext, "$(globe)", "EXT");
}

function updateSingleItem(item: vscode.StatusBarItem, data: any, icon: string, label: string) {
    if (!data || !data.quotaInfo) {
        item.text = `${icon} --%`;
        item.tooltip = `${label} Quota (Not Configured or Unknown)`;
        item.color = undefined; // Use default
        item.backgroundColor = undefined;
        item.show();
        return;
    }

    const percentage = Math.round(data.quotaInfo.remainingFraction * 100);
    const timeRemaining = formatTimeRemaining(data.quotaInfo.resetTime);

    // Icon + Percentage + Short Countdown (H:MM)
    item.text = `${icon} ${percentage}% ${timeRemaining}`;
    item.tooltip = `${label} Quota (${data.label})\nResets in: ${timeRemaining}\nAt: ${new Date(data.quotaInfo.resetTime).toLocaleTimeString()}\nClick for details.`;

    // Smooth gradient color: Green (100%) -> Yellow (50%) -> Red (0%)
    // Using HSL: H=120 is green, H=60 is yellow, H=0 is red
    // Map percentage (0-100) to hue (0-120)
    const hue = Math.round((percentage / 100) * 120);
    // Keep saturation high, lightness at ~60% for good visibility on dark backgrounds
    item.color = `hsl(${hue}, 100%, 60%)`;

    // Add background highlight for critically low quota (<=15%)
    if (percentage <= 15) {
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
        item.backgroundColor = undefined;
    }

    item.show();
}

function formatTimeRemaining(resetTime: string): string {
    const now = Date.now();
    const reset = new Date(resetTime).getTime();
    const diff = reset - now;

    if (diff <= 0) return "0:00";

    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    // Format as H:MM
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
}

function checkAlerts(key: string, data: any) {
    if (!data) return;
    const percentage = Math.round(data.quotaInfo.remainingFraction * 100);
    const last = lastKnownPercentages[key];

    if (percentage <= 15 && (last === null || last > 15)) {
        vscode.window.showWarningMessage(`Low Quota Alert (${key.toUpperCase()}): ${percentage}% remaining.`);
    }

    lastKnownPercentages[key] = percentage;
}

function findLanguageServerInfo(): Promise<{ port: number; csrfToken: string }> {
    return new Promise((resolve, reject) => {
        const psCommand = "ps aux | grep -v grep | grep -E 'language_server_macos|language_server_macos_arm'";
        exec(psCommand, (psError, psStdout) => {
            if (psError || !psStdout) return reject(new Error("Language Server not running."));

            const lines = psStdout.trim().split('\n');
            const targetLine = lines[0];

            const csrfMatch = targetLine.match(/--csrf_token\s+([a-f0-9-]+)/);
            const pidMatch = targetLine.match(/^\S+\s+(\d+)/);

            if (!csrfMatch || !pidMatch) return reject(new Error("Missing token or PID."));

            const csrfToken = csrfMatch[1];
            const pid = pidMatch[1];

            const lsofCommand = `lsof -i -P -n -a -p ${pid} | grep LISTEN`;
            exec(lsofCommand, (lsofError, lsofStdout) => {
                if (lsofError || !lsofStdout) return reject(new Error("No network ports found for LS."));

                const portMatches = Array.from(lsofStdout.matchAll(/127\.0\.0\.1:(\d+)/g)).map(m => parseInt(m[1]));
                if (portMatches.length === 0) return reject(new Error("No loopback ports."));

                resolve({ port: portMatches[0], csrfToken });
            });
        });
    });
}

function fetchEndpoint(port: number, csrfToken: string, endpoint: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({});
        const options = {
            hostname: '127.0.0.1',
            port: port,
            path: endpoint,
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json',
                'x-codeium-csrf-token': csrfToken,
                'Content-Length': postData.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                } else { reject(new Error(`Status ${res.statusCode}`)); }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
        req.setTimeout(5000, () => req.destroy());
    });
}

export function deactivate() {
    if (proStatusBarItem) proStatusBarItem.dispose();
    if (flashStatusBarItem) flashStatusBarItem.dispose();
    if (extStatusBarItem) extStatusBarItem.dispose();
    if (countdownInterval) clearInterval(countdownInterval);
}
