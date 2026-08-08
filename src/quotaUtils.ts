export function parseResetTime(resetTime: any): number {
    if (!resetTime) return NaN;
    if (typeof resetTime === 'number') {
        if (resetTime < 1e11) return resetTime * 1000;
        return resetTime;
    }
    if (typeof resetTime === 'string') {
        const num = Number(resetTime);
        if (!isNaN(num)) {
            if (num < 1e11) return num * 1000;
            return num;
        }
        return new Date(resetTime).getTime();
    }
    return NaN;
}

export function formatTimeRemaining(resetTime: any, now: number = Date.now()): string {
    const resetMs = parseResetTime(resetTime);
    if (isNaN(resetMs)) return "0:00";
    const diff = resetMs - now;

    if (diff <= 0) return "0:00";

    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        return `${days}d ${remHours}h`;
    }

    return `${hours}:${minutes.toString().padStart(2, '0')}`;
}

export function isDailyModel(model: any, now: number = Date.now()): boolean {
    if (!model || !model.quotaInfo) return false;
    const resetMs = parseResetTime(model.quotaInfo.resetTime);
    if (!isNaN(resetMs)) {
        const diffHours = (resetMs - now) / (1000 * 60 * 60);
        if (diffHours > 36) return false;
    }
    const label = (model.label || '').toLowerCase();
    if (label.includes('daily') || label.includes('hourly') || label.includes('24h') || label.includes('day') || label.includes('hour') || label.includes('5-hour') || label.includes('5hour') || label.includes('5h') || label.includes('high') || label.includes('med') || label.includes('low')) {
        return true;
    }
    return true;
}

export function isWeeklyModel(model: any, now: number = Date.now()): boolean {
    if (!model || !model.quotaInfo) return false;
    const resetMs = parseResetTime(model.quotaInfo.resetTime);
    if (!isNaN(resetMs)) {
        const diffHours = (resetMs - now) / (1000 * 60 * 60);
        if (diffHours <= 36) return false;
        return true;
    }
    const label = (model.label || '').toLowerCase();
    return label.includes('weekly') || label.includes('7d') || label.includes('week');
}

export function isExternalModel(model: any): boolean {
    if (!model || !model.quotaInfo) return false;
    const label = (model.label || '').toLowerCase();
    return label.includes('claude') || label.includes('gpt');
}

export function selectBestModel(models: any[], activeModelId?: string): any | undefined {
    if (!models || models.length === 0) return undefined;
    const active = models.find((m: any) => m.modelOrAlias?.model === activeModelId);
    if (active) return active;
    return models.reduce((lowest: any, current: any) => {
        if (!lowest) return current;
        return (current.quotaInfo.remainingFraction < lowest.quotaInfo.remainingFraction) ? current : lowest;
    }, undefined);
}
