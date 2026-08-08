import { expect } from 'chai';
import { formatTimeRemaining, isDailyModel, isWeeklyModel, isExternalModel, selectBestModel } from '../src/quotaUtils';

describe('Quota Logic & Formatting', () => {
    describe('formatTimeRemaining', () => {
        it('should return 0:00 if resetTime is in the past', () => {
            const now = Date.now();
            const past = new Date(now - 10000).toISOString();
            expect(formatTimeRemaining(past, now)).to.equal('0:00');
        });

        it('should format short durations (<24 hours) as H:MM', () => {
            const now = Date.now();
            // 3 hours, 45 minutes ahead
            const future = new Date(now + (3 * 3600 + 45 * 60) * 1000).toISOString();
            expect(formatTimeRemaining(future, now)).to.equal('3:45');
        });

        it('should format short durations with padded minutes', () => {
            const now = Date.now();
            // 0 hours, 5 minutes ahead
            const future = new Date(now + 5 * 60 * 1000).toISOString();
            expect(formatTimeRemaining(future, now)).to.equal('0:05');
        });

        it('should format long durations (>=24 hours) as Xd Yh', () => {
            const now = Date.now();
            // 5 days and 14 hours ahead (134 hours)
            const future = new Date(now + (134 * 3600) * 1000).toISOString();
            expect(formatTimeRemaining(future, now)).to.equal('5d 14h');
        });

        it('should format exactly 1 day duration', () => {
            const now = Date.now();
            const future = new Date(now + (24 * 3600) * 1000).toISOString();
            expect(formatTimeRemaining(future, now)).to.equal('1d 0h');
        });
    });

    describe('Model Categorization', () => {
        const now = Date.now();

        it('should identify daily/hourly models by label (including High / 5-Hour)', () => {
            expect(isDailyModel({ label: 'Gemini 3.5 Flash (Daily)', quotaInfo: { remainingFraction: 1, resetTime: new Date(now + 3600000).toISOString() } }, now)).to.be.true;
            expect(isDailyModel({ label: 'Gemini 3.1 Pro (Hourly)', quotaInfo: { remainingFraction: 1, resetTime: new Date(now + 3600000).toISOString() } }, now)).to.be.true;
            expect(isDailyModel({ label: 'Gemini 3.6 Flash (High)', quotaInfo: { remainingFraction: 0.98, resetTime: new Date(now + 4 * 3600 * 1000 + 51 * 60 * 1000).toISOString() } }, now)).to.be.true;
        });

        it('should identify weekly models by label (including Low / Weekly)', () => {
            expect(isWeeklyModel({ label: 'Gemini 3.1 Pro (Weekly)', quotaInfo: { remainingFraction: 1, resetTime: new Date(now + 7 * 86400000).toISOString() } }, now)).to.be.true;
            expect(isWeeklyModel({ label: 'Gemini 3.6 Flash (Low)', quotaInfo: { remainingFraction: 0.99, resetTime: new Date(now + 5 * 86400000 + 4 * 3600 * 1000).toISOString() } }, now)).to.be.true;
        });

        it('should fallback to resetTime duration when label lacks keywords', () => {
            const shortReset = new Date(now + 12 * 3600 * 1000).toISOString(); // 12h
            const longReset = new Date(now + 120 * 3600 * 1000).toISOString(); // 5 days (120h)

            expect(isDailyModel({ label: 'Gemini Model A', quotaInfo: { remainingFraction: 1, resetTime: shortReset } }, now)).to.be.true;
            expect(isWeeklyModel({ label: 'Gemini Model A', quotaInfo: { remainingFraction: 1, resetTime: shortReset } }, now)).to.be.false;

            expect(isDailyModel({ label: 'Gemini Model B', quotaInfo: { remainingFraction: 1, resetTime: longReset } }, now)).to.be.false;
            expect(isWeeklyModel({ label: 'Gemini Model B', quotaInfo: { remainingFraction: 1, resetTime: longReset } }, now)).to.be.true;
        });

        it('should identify external models', () => {
            expect(isExternalModel({ label: 'Claude 3.5 Sonnet', quotaInfo: { remainingFraction: 1 } })).to.be.true;
            expect(isExternalModel({ label: 'GPT-4o', quotaInfo: { remainingFraction: 1 } })).to.be.true;
            expect(isExternalModel({ label: 'Gemini 3.5 Flash', quotaInfo: { remainingFraction: 1 } })).to.be.false;
        });
    });
});
