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



    // Setup periodic data fetch (every 15 minutes, and only if window is focused)
    const dataFetchInterval = setInterval(() => {
        if (vscode.window.state.focused) {
            updateQuotaData();
        }
    }, 900000);

    context.subscriptions.push({ dispose: () => clearInterval(dataFetchInterval) });

    // Fetch data when the user returns to the editor
    context.subscriptions.push(vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) {
            updateQuotaData();
        }
    }));

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

        // Stop leaky quotas: Only fetch from GetCascadeModelConfigData.
        // GetUserStatus triggers remote API syncs from the language server.
        const cascadeData = await fetchEndpoint(port, csrfToken, '/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigData');
        const allModels = cascadeData.clientModelConfigs || [];

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

    // Generate 14 days of data points (every 2 hours to keep it readable but dense)
    for (let i = 14 * 24; i >= 0; i -= 2) {
        const ts = now - (i * oneHour);
        
        // Create distinct usage patterns for different models
        // Pro is heavy on weekdays, Flash is steady, Ext is occasional bursts
        const dayOfWeek = new Date(ts).getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        const hour = i % 24;
        const stage = hour % 12;
        
        let pro = 100;
        let flash = 100;
        let ext = 100;

        if (!isWeekend) {
            pro = Math.max(10, 100 - (stage * 9));
            flash = Math.max(30, 100 - (stage * 5));
        } else {
            pro = Math.max(70, 100 - (stage * 2));
            flash = Math.max(60, 100 - (stage * 3));
        }

        // Add some "burps" of high usage
        if (i % 48 === 0) pro = 5; 

        mockData.push({
            timestamp: ts,
            pro,
            flash,
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
        .dot-pro { background-color: var(--accent-pro); box-shadow: 0 0 10px var(--accent-pro); }
        .dot-flash { background-color: var(--accent-flash); box-shadow: 0 0 10px var(--accent-flash); }
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
                <div class="stat-item"><span class="dot dot-pro"></span> Gemini Pro</div>
                <div class="stat-item"><span class="dot dot-flash"></span> Gemini Flash</div>
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
                    label: 'Pro',
                    data: filtered.map(p => ({ x: p.timestamp, y: p.pro })),
                    borderColor: '#00ff88',
                    backgroundColor: 'rgba(0, 255, 136, 0.05)',
                    borderWidth: 2.5,
                    pointRadius: filtered.length > 100 ? 0 : 2,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: 'Flash',
                    data: filtered.map(p => ({ x: p.timestamp, y: p.flash })),
                    borderColor: '#ffff00',
                    backgroundColor: 'rgba(255, 255, 0, 0.05)',
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




