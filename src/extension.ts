import * as vscode from 'vscode';
import * as https from 'https';
import { exec } from 'child_process';
import { parseWindowsProcessList, parseWindowsPort, parseUnixProcessList, parseUnixPort } from './parser';

let proStatusBarItem: vscode.StatusBarItem;
let flashStatusBarItem: vscode.StatusBarItem;
let extStatusBarItem: vscode.StatusBarItem;

const activeQuotas: {
    pro?: any;
    flash?: any;
    ext?: any;
} = {};
 
interface QuotaDataPoint {
    timestamp: number;
    pro: number | null;
    flash: number | null;
    ext: number | null;
}


const lastKnownPercentages: { [key: string]: number | null } = { pro: null, flash: null, ext: null };
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

        vscode.window.showInformationMessage(detailMsg, "Refresh Now", "Show Usage Plot").then(selection => {
            if (selection === "Refresh Now") {
                vscode.commands.executeCommand('mikeQuota.refresh');
            } else if (selection === "Show Usage Plot") {
                vscode.commands.executeCommand('mikeQuota.showPlot');
            }
        });
    }));


    // Initial refresh and seed mock data if empty
    seedMockData(context);
    await updateQuotaData(context);


    // Setup periodic data fetch (every 1 minute for better accuracy)
    const dataFetchInterval = setInterval(() => updateQuotaData(context), 60000);
    context.subscriptions.push({ dispose: () => clearInterval(dataFetchInterval) });

    // Setup visual countdown update (every 1 second)
    countdownInterval = setInterval(() => updateStatusBarDisplay(), 1000);
    context.subscriptions.push({ dispose: () => { if (countdownInterval) clearInterval(countdownInterval); } });
}

/**
 * Fetches the latest quota data from the Language Server
 */
async function updateQuotaData(context: vscode.ExtensionContext, manual: boolean = false) {

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
        } catch { /* ignore */ }

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
 
        // Log the data point (force save on manual refresh)
        logQuotaData(context, activeQuotas, manual);

 
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
 * Logs a new data point to the persistent history
 */
function logQuotaData(context: vscode.ExtensionContext, data: any, force: boolean = false) {

    const history: QuotaDataPoint[] = context.globalState.get('quotaHistory', []);
    
    const now = Date.now();
    const lastPoint = history.length > 0 ? history[history.length - 1] : null;
    
    // Only log if something changed or if it's been more than 15 minutes since last log
    const pro = data.pro ? Math.round(data.pro.quotaInfo.remainingFraction * 100) : null;
    const flash = data.flash ? Math.round(data.flash.quotaInfo.remainingFraction * 100) : null;
    const ext = data.ext ? Math.round(data.ext.quotaInfo.remainingFraction * 100) : null;
    
    const hasChanged = !lastPoint || 
        lastPoint.pro !== pro || 
        lastPoint.flash !== flash || 
        lastPoint.ext !== ext;
    
    const isOld = !lastPoint || (now - lastPoint.timestamp) > 15 * 60 * 1000;
    
    if (hasChanged || isOld || force) {

        history.push({ timestamp: now, pro, flash, ext });
        
        // Keep last 2016 points (about 1-2 weeks of data if logged every 5-15 mins)
        // Actually since we log on change, 2016 points could last a long time.
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
    item.tooltip = `${label} Quota (${data.label})\nResets in: ${timeRemaining}\nAt: ${new Date(data.quotaInfo.resetTime).toLocaleTimeString()}\nClick for details & History Plot.`;


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
        const isWindows = process.platform === 'win32';

        if (isWindows) {
            // Windows logic: Using powershell to find the process and its command line
            const psCommand = `powershell -Command "Get-WmiObject Win32_Process -Filter \\"Name LIKE 'language_server_windows%'\\" | Select-Object CommandLine, ProcessId | ConvertTo-Json"`;
            exec(psCommand, (psError, psStdout) => {
                if (psError || !psStdout) return reject(new Error("Language Server not running (or PowerShell failed)."));

                try {
                    const { pid, csrfToken } = parseWindowsProcessList(psStdout);

                    // Find the listening port for this PID
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
            // macOS / Linux logic
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
    if (proStatusBarItem) proStatusBarItem.dispose();
    if (flashStatusBarItem) flashStatusBarItem.dispose();
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

    // Generate 24 hours of data points
    for (let i = 24; i >= 0; i--) {
        const ts = now - (i * oneHour);
        // Simulate a "usage drop" followed by "reset/recovery" pattern
        // i=24 is oldest, i=0 is now
        const stage = i % 12; 
        const pro = Math.max(20, 100 - (stage * 8));
        const flash = Math.max(10, 100 - (stage * 6));
        const ext = Math.max(50, 100 - (stage * 4));

        mockData.push({
            timestamp: ts,
            pro: pro,
            flash: flash,
            ext: ext
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
        // One last attempt to seed if it's still empty for some reason
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
            --accent-pro: #00ff88;
            --accent-flash: #ffff00;
            --accent-ext: #00d2ff;
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
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            min-height: 450px;
        }
        header {
            margin-bottom: 24px;
            text-align: left;
            width: 100%;
            max-width: 1000px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        h1 {
            font-size: 24px;
            margin: 0;
            background: linear-gradient(90deg, #fff, #888);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .stats {
            display: flex;
            gap: 16px;
        }
        .stat-item {
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .dot-pro { background-color: var(--accent-pro); box-shadow: 0 0 8px var(--accent-pro); }
        .dot-flash { background-color: var(--accent-flash); box-shadow: 0 0 8px var(--accent-flash); }
        .dot-ext { background-color: var(--accent-ext); box-shadow: 0 0 8px var(--accent-ext); }
        
        canvas {
            width: 100% !important;
            height: 450px !important;
        }
        .no-data {
            padding: 100px;
            text-align: center;
            font-style: italic;
            color: #888;
        }
        #error-display {
            color: #ff4444;
            background: rgba(255, 0, 0, 0.1);
            padding: 10px;
            margin-bottom: 20px;
            border-radius: 4px;
            display: none;
            font-family: monospace;
            font-size: 12px;
            width: 100%;
            max-width: 1000px;
        }
    </style>
</head>
<body>
    <header>
        <h1>Quota Usage History</h1>
        <div class="stats">
            <div class="stat-item"><span class="dot dot-pro"></span> Gemini Pro</div>
            <div class="stat-item"><span class="dot dot-flash"></span> Gemini Flash</div>
            <div class="stat-item"><span class="dot dot-ext"></span> External</div>
        </div>
    </header>

    <div id="error-display"></div>

    <div class="container">
        ${history.length > 0 ? '<canvas id="quotaChart"></canvas>' : '<div class="no-data">No history data logged yet.<br><br>Try hitting "Refresh Now" in the quota details to create a data point.</div>'}
    </div>

    <script>
        function logError(err) {
            const display = document.getElementById('error-display');
            display.style.display = 'block';
            display.innerText += 'Error: ' + err + '\\n';
        }

        window.onerror = function(msg, url, line) {
            logError(msg + " at line " + line);
        };

        try {
            if (typeof Chart === 'undefined') {
                logError("Chart.js failed to load from CDN. Check internet or Webview CSP.");
            } else if (${history.length > 0}) {
                const historyData = ${historyJson};
                const ctx = document.getElementById('quotaChart').getContext('2d');
                
                const datasets = [
                    {
                        label: 'Pro',
                        data: historyData.map(p => p.pro),
                        borderColor: '#00ff88',
                        backgroundColor: 'rgba(0, 255, 136, 0.1)',
                        borderWidth: 3,
                        pointRadius: historyData.length > 50 ? 0 : 3,
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'Flash',
                        data: historyData.map(p => p.flash),
                        borderColor: '#ffff00',
                        backgroundColor: 'rgba(255, 255, 0, 0.1)',
                        borderWidth: 3,
                        pointRadius: historyData.length > 50 ? 0 : 3,
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'External',
                        data: historyData.map(p => p.ext),
                        borderColor: '#00d2ff',
                        backgroundColor: 'rgba(0, 210, 255, 0.1)',
                        borderWidth: 3,
                        pointRadius: historyData.length > 50 ? 0 : 3,
                        tension: 0.3,
                        fill: true
                    }
                ];

                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: historyData.map(p => {
                            const d = new Date(p.timestamp);
                            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        }),
                        datasets: datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { intersect: false, mode: 'index' },
                        plugins: { legend: { display: false } },
                        scales: {
                            x: {
                                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                ticks: { 
                                    color: '#888',
                                    maxRotation: 0,
                                    autoSkip: true,
                                    maxTicksLimit: 8
                                }
                            },
                            y: {
                                beginAtZero: true,
                                max: 100,
                                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                ticks: { 
                                    color: '#888',
                                    callback: (v) => v + '%'
                                }
                            }
                        }
                    }
                });
            }
        } catch (e) {
            logError(e.message);
        }
    </script>
</body>
</html>`;
}



