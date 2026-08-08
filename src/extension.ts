import * as vscode from 'vscode';
import * as https from 'https';
import { exec } from 'child_process';
import { parseWindowsProcessList, parseWindowsPort, parseUnixProcessList, parseUnixPort } from './parser';
import { formatTimeRemaining, isDailyModel, isWeeklyModel, isExternalModel, selectBestModel } from './quotaUtils';

let dailyStatusBarItem: vscode.StatusBarItem;
let weeklyStatusBarItem: vscode.StatusBarItem;
let extStatusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

const activeQuotas: {
    daily?: any;
    weekly?: any;
    ext?: any;
} = {};

export interface QuotaDataPoint {
    timestamp: number;
    daily?: number | null;
    weekly?: number | null;
    ext?: number | null;
    pro?: number | null;
    flash?: number | null;
}

const lastKnownPercentages: { [key: string]: number | null } = { daily: null, weekly: null, ext: null };
let countdownInterval: NodeJS.Timeout | undefined;
let lastSeenModels: string[] = [];
let allModelsWithQuotas: any[] = [];
let activeModelId: string | undefined = undefined;
let lastFetchTime = 0;
const FETCH_COOLDOWN = 10 * 60 * 1000; // 10 minutes

let lastDebugText = '';

export { formatTimeRemaining, isDailyModel, isWeeklyModel, isExternalModel, selectBestModel };


export async function activate(context: vscode.ExtensionContext) {
    console.log('Minimal Intelligent Kuota Extension is now active!');

    outputChannel = vscode.window.createOutputChannel('M.I.K.E. Quota Debug');
    context.subscriptions.push(outputChannel);

    // Create status bar items with priorities to keep them in order
    // Daily (Leftmost), then Weekly, then Ext (Rightmost)
    dailyStatusBarItem = vscode.window.createStatusBarItem('mike.daily', vscode.StatusBarAlignment.Right, 1003);
    dailyStatusBarItem.name = 'M.I.K.E. Daily Quota';
    dailyStatusBarItem.command = 'mikeQuota.showDetails';
    context.subscriptions.push(dailyStatusBarItem);

    weeklyStatusBarItem = vscode.window.createStatusBarItem('mike.weekly', vscode.StatusBarAlignment.Right, 1002);
    weeklyStatusBarItem.name = 'M.I.K.E. Weekly Quota';
    weeklyStatusBarItem.command = 'mikeQuota.showDetails';
    context.subscriptions.push(weeklyStatusBarItem);

    extStatusBarItem = vscode.window.createStatusBarItem('mike.ext', vscode.StatusBarAlignment.Right, 1001);
    extStatusBarItem.name = 'M.I.K.E. External';
    extStatusBarItem.command = 'mikeQuota.showDetails';
    context.subscriptions.push(extStatusBarItem);

    // Register refresh command
    context.subscriptions.push(vscode.commands.registerCommand('mikeQuota.refresh', async () => {
        await updateQuotaData(context, true);
    }));

    // Register plot command
    context.subscriptions.push(vscode.commands.registerCommand('mikeQuota.showPlot', async () => {
        showQuotaPlotWebview(context);
    }));

    // Register debug history command
    context.subscriptions.push(vscode.commands.registerCommand('mikeQuota.debugHistory', () => {
        const history = context.globalState.get<QuotaDataPoint[]>('quotaHistory', []);
        const count = history.length;
        if (count === 0) {
            vscode.window.showWarningMessage("Quota history is empty.");
        } else {
            const first = new Date(history[0].timestamp).toLocaleTimeString();
            const last = new Date(history[count - 1].timestamp).toLocaleTimeString();
            vscode.window.showInformationMessage(`History: ${count} points. Range: ${first} to ${last}.`);
        }
    }));

    // Register clear history command
    context.subscriptions.push(vscode.commands.registerCommand('mikeQuota.clearHistory', async () => {
        await context.globalState.update('quotaHistory', []);
        seedMockData(context);
        vscode.window.showInformationMessage("Quota history cleared and re-seeded with mock data.");
        vscode.commands.executeCommand('mikeQuota.showPlot');
    }));

    // Register detailed info command
    context.subscriptions.push(vscode.commands.registerCommand('mikeQuota.showDetails', async () => {
        const info = activeQuotas;
        let detailMsg = "M.I.K.E. Quota Status:\n\n";
        let hasData = false;

        if (info.daily) {
            const p = Math.round(info.daily.quotaInfo.remainingFraction * 100);
            const activeMarker = info.daily.modelOrAlias?.model === activeModelId ? " ● [Active]" : "";
            const resetStr = formatTimeRemaining(info.daily.quotaInfo.resetTime);
            detailMsg += `DAILY/HOURLY (${info.daily.label})${activeMarker}: ${p}% (Resets in ${resetStr} at ${new Date(info.daily.quotaInfo.resetTime).toLocaleTimeString()})\n`;
            hasData = true;
        } else {
            detailMsg += `DAILY/HOURLY: Unknown / Not Configured\n`;
        }

        if (info.weekly) {
            const p = Math.round(info.weekly.quotaInfo.remainingFraction * 100);
            const activeMarker = info.weekly.modelOrAlias?.model === activeModelId ? " ● [Active]" : "";
            const resetStr = formatTimeRemaining(info.weekly.quotaInfo.resetTime);
            detailMsg += `WEEKLY (${info.weekly.label})${activeMarker}: ${p}% (Resets in ${resetStr} at ${new Date(info.weekly.quotaInfo.resetTime).toLocaleTimeString()})\n`;
            hasData = true;
        } else {
            detailMsg += `WEEKLY: Unknown / Not Configured\n`;
        }

        if (info.ext) {
            const p = Math.round(info.ext.quotaInfo.remainingFraction * 100);
            const activeMarker = info.ext.modelOrAlias?.model === activeModelId ? " ● [Active]" : "";
            detailMsg += `EXTERNAL (${info.ext.label})${activeMarker}: ${p}%\n`;
            hasData = true;
        } else {
            detailMsg += `EXTERNAL: Unknown / Not Configured\n`;
        }

        if (allModelsWithQuotas.length > 0) {
            detailMsg += `\n--- All Available Quotas ---\n`;
            allModelsWithQuotas.forEach((m: any) => {
                const percentage = Math.round(m.quotaInfo.remainingFraction * 100);
                const isActive = m.modelOrAlias?.model === activeModelId;
                const activeMarker = isActive ? " ● [Active]" : "";
                const resetTimeStr = new Date(m.quotaInfo.resetTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                detailMsg += `• ${m.label}${activeMarker}: ${percentage}% (Resets at ${resetTimeStr})\n`;
            });
        }

        if (!hasData) {
            detailMsg += "\nNote: No active quota information found. Is the Language Server running?\n";
        }

        detailMsg += `\n--- Debug Info ---\nModels Processed:\n${lastSeenModels.length > 0 ? lastSeenModels.join('\n') : 'None yet'}\n`;

        vscode.window.showInformationMessage(detailMsg, "Refresh Now", "Show Usage Plot", "Open Debug Log").then(async selection => {
            if (selection === "Refresh Now") {
                vscode.commands.executeCommand('mikeQuota.refresh');
            } else if (selection === "Show Usage Plot") {
                vscode.commands.executeCommand('mikeQuota.showPlot');
            } else if (selection === "Open Debug Log") {
                if (outputChannel) {
                    outputChannel.show(true);
                }
                const doc = await vscode.workspace.openTextDocument({
                    content: lastDebugText || "No debug log available yet. Click 'Refresh Now' first.",
                    language: 'json'
                });
                await vscode.window.showTextDocument(doc);
            }
        });
    }));

    // Initial refresh and seed mock data if empty
    seedMockData(context);
    // 1. Activation fetch
    await updateQuotaData(context);

    // 2. Window Focus Fetch: Refresh when the user returns to the editor (subject to cooldown)
    context.subscriptions.push(vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) {
            updateQuotaData(context);
        }
    }));

    // 3. Activity-Based Fetch: Refresh when a file is saved (strong signal of active coding)
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => {
        updateQuotaData(context);
    }));

    // Setup visual countdown update (every 60 seconds) - This is local UI only, no LS ping.
    countdownInterval = setInterval(() => updateStatusBarDisplay(), 60000);
    context.subscriptions.push({ dispose: () => { if (countdownInterval) clearInterval(countdownInterval); } });
}

/**
 * Fetches the latest quota data from the Language Server
 */
async function updateQuotaData(context: vscode.ExtensionContext, manual: boolean = false) {
    const now = Date.now();

    // Throttling: Return if not manual and within cooldown
    if (!manual && (now - lastFetchTime < FETCH_COOLDOWN)) {
        return;
    }

    if (manual) {
        // Keep status bar items visible during manual refresh
        [dailyStatusBarItem, weeklyStatusBarItem, extStatusBarItem].forEach(item => {
            if (item && item.text && item.text.includes('%')) {
                // Keep current state visible
            }
        });
    }

    lastFetchTime = now;

    try {
        const { port, csrfToken } = await findLanguageServerInfo();

        // Fetch new quota summary
        let summaryRes: any = null;
        try {
            summaryRes = await fetchEndpoint(port, csrfToken, '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary');
        } catch (e: any) {
            // Ignore error, will fallback
        }

        const cascadeData = await fetchEndpoint(port, csrfToken, '/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigData');
        const allModels = cascadeData.clientModelConfigs || [];

        let userStatusData: any = null;
        try {
            userStatusData = await fetchEndpoint(port, csrfToken, '/exa.language_server_pb.LanguageServerService/GetUserStatus');
        } catch (e: any) {
            userStatusData = { error: e.message };
        }

        const candidates = [
            '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
            '/exa.language_server_pb.LanguageServerService/GetUserQuota',
            '/exa.language_server_pb.LanguageServerService/GetUserQuotaList',
            '/exa.language_server_pb.LanguageServerService/GetUserQuotas',
            '/exa.language_server_pb.LanguageServerService/GetModelQuotas',
            '/exa.language_server_pb.LanguageServerService/GetTierQuota',
            '/exa.language_server_pb.LanguageServerService/GetQuotaInfo',
            '/exa.language_server_pb.LanguageServerService/GetQuota',
            '/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs'
        ];
        const candidateResults: any = {};
        for (const ep of candidates) {
            try {
                const res = await fetchEndpoint(port, csrfToken, ep);
                candidateResults[ep] = res;
            } catch (e: any) {
                // Ignore failed endpoints
            }
        }

        const extList = vscode.extensions.all.map(e => `${e.id} (active: ${e.isActive})`);
        const geminiExt = vscode.extensions.getExtension('google.geminicodeassist') || vscode.extensions.getExtension('antigravity');

        const debugLogContent = [
            `=== Quota Refresh [${new Date().toLocaleTimeString()}] ===`,
            `Active Model ID: ${activeModelId}`,
            `Total Models: ${allModels.length}`,
            `Target Extension: ${geminiExt?.id} (active: ${geminiExt?.isActive})`,
            `Target Exports: ${JSON.stringify(geminiExt?.exports)}`,
            `Quota Summary Response:\n${JSON.stringify(summaryRes, null, 2)}`,
            `Candidate Probes Succeeded:\n${JSON.stringify(candidateResults, null, 2)}`,
            `GetUserStatus Response:\n${JSON.stringify(userStatusData, null, 2)}`,
            `Raw Cascade Data:\n${JSON.stringify(cascadeData, null, 2)}`
        ].join('\n\n');

        lastDebugText = debugLogContent;

        if (outputChannel) {
            outputChannel.appendLine(`\n${debugLogContent}`);
        }

        lastSeenModels = allModels.map((m: any) => `- ${m.label} (Has Quota: ${!!m.quotaInfo})`);

        // Extract all models with active quotaInfo
        allModelsWithQuotas = allModels.filter((m: any) => m.quotaInfo);
        activeModelId = cascadeData.defaultOverrideModelConfig?.modelOrAlias?.model;

        let dailyBucket = null;
        let weeklyBucket = null;
        let extBucket = null;

        if (summaryRes && summaryRes.response && summaryRes.response.groups) {
            for (const group of summaryRes.response.groups) {
                if (group.buckets) {
                    for (const bucket of group.buckets) {
                        const bucketQuota = {
                            label: bucket.displayName || bucket.bucketId,
                            quotaInfo: {
                                remainingFraction: bucket.remainingFraction,
                                resetTime: bucket.resetTime
                            }
                        };
                        if (bucket.bucketId === 'gemini-5h') {
                            dailyBucket = bucketQuota;
                        } else if (bucket.bucketId === 'gemini-weekly') {
                            weeklyBucket = bucketQuota;
                        } else if (bucket.bucketId === '3p-5h') {
                            extBucket = bucketQuota;
                        } else if (bucket.bucketId === '3p-weekly' && !extBucket) {
                            extBucket = bucketQuota;
                        }
                    }
                }
            }
        }

        // Fallback for older LS versions
        if (!dailyBucket && !weeklyBucket && !extBucket) {
            // Categorize models into Daily, Weekly, and External
            const dailyModels = allModels.filter((m: any) => isDailyModel(m, now));
            const weeklyModels = allModels.filter((m: any) => isWeeklyModel(m, now));
            const extModels = allModels.filter((m: any) => isExternalModel(m));

            if (outputChannel) {
                outputChannel.appendLine(`Categorization Fallback -> Daily: ${dailyModels.length}, Weekly: ${weeklyModels.length}, Ext: ${extModels.length}`);
            }

            // Helper to select the best model for a status bar category
            const selectBestModelForCategory = (models: any[]) => {
                if (models.length === 0) return undefined;
                const active = models.find((m: any) => m.modelOrAlias?.model === activeModelId);
                if (active) return active;
                return models.reduce((lowest: any, current: any) => {
                    if (!lowest) return current;
                    return (current.quotaInfo.remainingFraction < lowest.quotaInfo.remainingFraction) ? current : lowest;
                }, undefined);
            };

            dailyBucket = selectBestModelForCategory(dailyModels);
            weeklyBucket = selectBestModelForCategory(weeklyModels);
            extBucket = selectBestModelForCategory(extModels);
        }

        activeQuotas.daily = dailyBucket;
        activeQuotas.weekly = weeklyBucket;
        activeQuotas.ext = extBucket;

        if (outputChannel) {
            outputChannel.appendLine(`Selected Daily: ${activeQuotas.daily?.label} (${activeQuotas.daily ? Math.round(activeQuotas.daily.quotaInfo.remainingFraction * 100) : 'N/A'}%)`);
            outputChannel.appendLine(`Selected Weekly: ${activeQuotas.weekly?.label} (${activeQuotas.weekly ? Math.round(activeQuotas.weekly.quotaInfo.remainingFraction * 100) : 'N/A'}%)`);
            outputChannel.appendLine(`Selected Ext: ${activeQuotas.ext?.label} (${activeQuotas.ext ? Math.round(activeQuotas.ext.quotaInfo.remainingFraction * 100) : 'N/A'}%)`);
        }

        // Log the data point (force save on manual refresh)
        logQuotaData(context, activeQuotas, manual);

        updateStatusBarDisplay();

        if (manual) {
            vscode.window.setStatusBarMessage(`Quota data refreshed.`, 3000);
        }

        // Check for alerts (Transitions from high to low)
        checkAlerts('daily', activeQuotas.daily);
        checkAlerts('weekly', activeQuotas.weekly);
        checkAlerts('ext', activeQuotas.ext);

    } catch (err) {
        console.error("Quota Fetch Error:", err);
        if (manual) {
            vscode.window.showErrorMessage("Failed to refresh quota. Ensure the Language Server running.");
        }
    }
}

/**
 * Logs a new data point to the persistent history
 */
function logQuotaData(context: vscode.ExtensionContext, data: any, force: boolean = false) {
    const history: QuotaDataPoint[] = context.globalState.get('quotaHistory', []);

    const now = Date.now();
    const lastPoint = history.length > 0 ? history[history.length - 1] : null;

    const daily = data.daily ? Math.round(data.daily.quotaInfo.remainingFraction * 100) : null;
    const weekly = data.weekly ? Math.round(data.weekly.quotaInfo.remainingFraction * 100) : null;
    const ext = data.ext ? Math.round(data.ext.quotaInfo.remainingFraction * 100) : null;

    const lastDaily = lastPoint ? (lastPoint.daily ?? lastPoint.pro ?? null) : null;
    const lastWeekly = lastPoint ? (lastPoint.weekly ?? lastPoint.flash ?? null) : null;
    const lastExt = lastPoint ? (lastPoint.ext ?? null) : null;

    const hasChanged = !lastPoint ||
        lastDaily !== daily ||
        lastWeekly !== weekly ||
        lastExt !== ext;

    const isOld = !lastPoint || (now - lastPoint.timestamp) > 15 * 60 * 1000;

    if (hasChanged || isOld || force) {
        history.push({ timestamp: now, daily, weekly, ext });

        if (history.length > 5000) {
            history.shift();
        }

        context.globalState.update('quotaHistory', history);
    }
}

/**
 * Updates the visual display of status bar items without fetching new data
 */
function updateStatusBarDisplay() {
    updateSingleItem(dailyStatusBarItem, activeQuotas.daily, "$(clock)", "DAILY/HOURLY", true);
    updateSingleItem(weeklyStatusBarItem, activeQuotas.weekly, "$(calendar)", "WEEKLY", true);
    updateSingleItem(extStatusBarItem, activeQuotas.ext, "$(globe)", "EXT", false);
}

function updateSingleItem(item: vscode.StatusBarItem, data: any, icon: string, label: string, showTime: boolean = true) {
    if (!item) return;

    if (!data || !data.quotaInfo) {
        item.text = `${icon} --%`;
        item.tooltip = `${label} Quota (Not Configured or Unknown)`;
        item.color = undefined; // Use default
        item.backgroundColor = undefined;
        item.show();
        return;
    }

    const percentage = Math.round(data.quotaInfo.remainingFraction * 100);

    if (showTime) {
        const timeRemaining = formatTimeRemaining(data.quotaInfo.resetTime);
        item.text = `${icon} ${percentage}% ${timeRemaining}`;
        item.tooltip = `${label} Quota (${data.label})\nResets in: ${timeRemaining}\nAt: ${new Date(data.quotaInfo.resetTime).toLocaleTimeString()}\nClick for details & History Plot.`;
    } else {
        item.text = `${icon} ${percentage}%`;
        item.tooltip = `${label} Quota (${data.label})\nRemaining: ${percentage}%\nClick for details & History Plot.`;
    }

    // Smooth gradient color: Green (100%) -> Yellow (50%) -> Red (0%)
    const hue = Math.round((percentage / 100) * 120);
    item.color = `hsl(${hue}, 100%, 60%)`;

    // Add background highlight for critically low quota (<=15%)
    if (percentage <= 15) {
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
        item.backgroundColor = undefined;
    }

    item.show();
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
        const isWindows = process.platform === 'win32';

        if (isWindows) {
            const psCommand = `powershell -Command "Get-WmiObject Win32_Process -Filter \\"Name LIKE 'language_server_windows%'\\" | Select-Object CommandLine, ProcessId | ConvertTo-Json"`;
            exec(psCommand, (psError, psStdout) => {
                if (psError || !psStdout) return reject(new Error("Language Server not running (or PowerShell failed)."));

                try {
                    const { pid, csrfToken } = parseWindowsProcessList(psStdout);

                    const netstatCommand = `netstat -ano | findstr LISTENING | findstr ${pid}`;
                    exec(netstatCommand, (nsError, nsStdout) => {
                        if (nsError || !nsStdout) return reject(new Error("No network ports found for LS PID."));

                        try {
                            const port = parseWindowsPort(nsStdout);
                            resolve({ port, csrfToken });
                        } catch (e: any) {
                            reject(e);
                        }
                    });
                } catch (e: any) {
                    reject(e);
                }
            });
        } else {
            const psCommand = "ps aux | grep -v grep | grep -E 'language_server_macos|language_server_macos_arm|language_server_linux'";
            exec(psCommand, (psError, psStdout) => {
                if (psError || !psStdout) return reject(new Error("Language Server not running."));

                try {
                    const { pid, csrfToken } = parseUnixProcessList(psStdout);

                    const lsofCommand = `lsof -i -P -n -a -p ${pid} | grep LISTEN`;
                    exec(lsofCommand, (lsofError, lsofStdout) => {
                        if (lsofError || !lsofStdout) return reject(new Error("No network ports found for LS."));

                        try {
                            const port = parseUnixPort(lsofStdout);
                            resolve({ port, csrfToken });
                        } catch (e: any) {
                            reject(e);
                        }
                    });
                } catch (e: any) {
                    reject(e);
                }
            });
        }
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
    if (dailyStatusBarItem) dailyStatusBarItem.dispose();
    if (weeklyStatusBarItem) weeklyStatusBarItem.dispose();
    if (extStatusBarItem) extStatusBarItem.dispose();
    if (countdownInterval) clearInterval(countdownInterval);
}

/**
 * Seeds mock data for visualization if history is empty
 */
function seedMockData(context: vscode.ExtensionContext) {
    const history = context.globalState.get<QuotaDataPoint[]>('quotaHistory', []);
    if (history.length > 0) return;

    const mockData: QuotaDataPoint[] = [];
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    for (let i = 14 * 24; i >= 0; i -= 2) {
        const ts = now - (i * oneHour);
        const dayOfWeek = new Date(ts).getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        const hour = i % 24;
        const stage = hour % 12;

        let daily: number;
        let weekly: number;
        const ext = 100;

        if (!isWeekend) {
            daily = Math.max(10, 100 - (stage * 9));
            weekly = Math.max(30, 100 - Math.floor(i / 10));
        } else {
            daily = Math.max(70, 100 - (stage * 2));
            weekly = Math.max(50, 100 - Math.floor(i / 10));
        }

        if (i % 48 === 0) daily = 5;

        mockData.push({
            timestamp: ts,
            daily,
            weekly,
            ext
        });
    }

    context.globalState.update('quotaHistory', mockData);
}

/**
 * Creates and shows the webview with quota history plot
 */
function showQuotaPlotWebview(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'mikeQuotaPlot',
        'M.I.K.E. Quota Usage History',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    const history = context.globalState.get<QuotaDataPoint[]>('quotaHistory', []);
    if (history.length === 0) {
        seedMockData(context);
    }
    vscode.window.setStatusBarMessage(`Opening plot with ${history.length} data points...`, 3000);
    panel.webview.html = getWebviewContent(history);
}

function getWebviewContent(history: QuotaDataPoint[]) {
    const historyJson = JSON.stringify(history);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M.I.K.E. Quota Usage</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {
            --bg-color: #0d1117;
            --card-bg: rgba(22, 27, 34, 0.7);
            --text-color: #c9d1d9;
            --accent-daily: #00ff88;
            --accent-weekly: #a855f7;
            --accent-ext: #00d2ff;
            --btn-bg: rgba(255, 255, 255, 0.05);
            --btn-active: rgba(255, 255, 255, 0.15);
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 24px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .container {
            width: 100%;
            max-width: 1000px;
            background: var(--card-bg);
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
            min-height: 500px;
        }
        header {
            margin-bottom: 24px;
            text-align: left;
            width: 100%;
            max-width: 1000px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }
        .title-group h1 {
            font-size: 28px;
            margin: 0;
            background: linear-gradient(90deg, #fff, #aaa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .filters {
            display: flex;
            gap: 8px;
            background: var(--btn-bg);
            padding: 4px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .filter-btn {
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            color: #888;
            background: transparent;
        }
        .filter-btn:hover { color: #fff; background: var(--btn-active); }
        .filter-btn.active { color: #fff; background: var(--btn-active); box-shadow: 0 2px 4px rgba(0,0,0,0.2); }

        .stats-legend {
            display: flex;
            gap: 20px;
            margin-top: 8px;
        }
        .stat-item {
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #aaa;
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .dot-daily { background-color: var(--accent-daily); box-shadow: 0 0 10px var(--accent-daily); }
        .dot-weekly { background-color: var(--accent-weekly); box-shadow: 0 0 10px var(--accent-weekly); }
        .dot-ext { background-color: var(--accent-ext); box-shadow: 0 0 10px var(--accent-ext); }
        
        canvas {
            width: 100% !important;
            height: 450px !important;
        }
        .no-data {
            padding: 150px;
            text-align: center;
            font-style: italic;
            color: #666;
            font-size: 16px;
        }
    </style>
</head>
<body>
    <header>
        <div class="title-group">
            <h1>Quota History</h1>
            <div class="stats-legend">
                <div class="stat-item"><span class="dot dot-daily"></span> Daily Quota</div>
                <div class="stat-item"><span class="dot dot-weekly"></span> Weekly Quota</div>
                <div class="stat-item"><span class="dot dot-ext"></span> External</div>
            </div>
        </div>
        <div class="filters" id="rangeFilters">
            <button class="filter-btn" data-days="1">Today</button>
            <button class="filter-btn" data-days="3">3 Days</button>
            <button class="filter-btn active" data-days="7">Week</button>
            <button class="filter-btn" data-days="14">14 Days</button>
        </div>
    </header>

    <div class="container">
        ${history.length > 0 ? '<canvas id="quotaChart"></canvas>' : '<div class="no-data">No history data logged yet.<br><br>Keep coding and M.I.K.E. will track your progress.</div>'}
    </div>

    <script>
        const rawHistory = ${historyJson};
        let chart = null;

        function updateChart(days) {
            const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
            const filtered = rawHistory.filter(p => p.timestamp >= cutoff);
            
            if (filtered.length === 0) return;

            const ctx = document.getElementById('quotaChart').getContext('2d');
            
            const datasets = [
                {
                    label: 'Daily Quota',
                    data: filtered.map(p => ({ x: p.timestamp, y: (p.daily !== undefined && p.daily !== null) ? p.daily : p.pro })),
                    borderColor: '#00ff88',
                    backgroundColor: 'rgba(0, 255, 136, 0.05)',
                    borderWidth: 2.5,
                    pointRadius: filtered.length > 100 ? 0 : 2,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: 'Weekly Quota',
                    data: filtered.map(p => ({ x: p.timestamp, y: (p.weekly !== undefined && p.weekly !== null) ? p.weekly : p.flash })),
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.05)',
                    borderWidth: 2.5,
                    pointRadius: filtered.length > 100 ? 0 : 2,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: 'External',
                    data: filtered.map(p => ({ x: p.timestamp, y: p.ext })),
                    borderColor: '#00d2ff',
                    backgroundColor: 'rgba(0, 210, 255, 0.05)',
                    borderWidth: 2.5,
                    pointRadius: filtered.length > 100 ? 0 : 2,
                    tension: 0.3,
                    fill: true
                }
            ];

            if (chart) {
                chart.data.datasets = datasets;
                chart.update();
            } else {
                chart = new Chart(ctx, {
                    type: 'line',
                    data: { datasets },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { intersect: false, mode: 'index' },
                        plugins: { legend: { display: false } },
                        scales: {
                            x: {
                                type: 'linear',
                                grid: { color: 'rgba(255, 255, 255, 0.03)' },
                                ticks: { 
                                    color: '#666',
                                    callback: function(value) {
                                        const date = new Date(value);
                                        if (days <= 1) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                    },
                                    autoSkip: true,
                                    maxTicksLimit: 8
                                }
                            },
                            y: {
                                beginAtZero: true,
                                max: 100,
                                grid: { color: 'rgba(255, 255, 255, 0.03)' },
                                ticks: { color: '#666', callback: (v) => v + '%' }
                            }
                        }
                    }
                });
            }
        }

        if (rawHistory.length > 0) {
            updateChart(7);
            
            document.getElementById('rangeFilters').addEventListener('click', (e) => {
                if (e.target.classList.contains('filter-btn')) {
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    updateChart(parseInt(e.target.dataset.days));
                }
            });
        }
    </script>
</body>
</html>`;
}




