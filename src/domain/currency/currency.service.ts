import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

export interface CurrencyVolatility {
  changePct: number;
  trend: 'up' | 'down' | 'flat';
  prev24h: number;
  risk: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface ExchangeRateResponse {
  base: string;
  lastUpdated: string;
  timestamp: number;
  rates: Record<string, number>;
  volatility: Record<string, CurrencyVolatility>;
}

const DEFAULT_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.8657,
  GBP: 0.741,
  INR: 95.6745,
  AED: 3.6725,
  CAD: 1.39,
  JPY: 154.389,
  AUD: 1.4016,
};

// 24-hour benchmark baseline rates for initial delta calculation
const BASELINE_24H_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.8625,
  GBP: 0.743,
  INR: 95.42,
  AED: 3.6725,
  CAD: 1.388,
  JPY: 154.12,
  AUD: 1.405,
};

interface RateSnapshot {
  timestamp: number;
  rates: Record<string, number>;
}

@Injectable()
export class CurrencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CurrencyService.name);
  private syncTimer?: NodeJS.Timeout;
  private rateHistory: RateSnapshot[] = [];

  private cachedData: ExchangeRateResponse = {
    base: 'USD',
    lastUpdated: new Date().toISOString(),
    timestamp: Date.now(),
    rates: { ...DEFAULT_RATES },
    volatility: this.computeVolatility(DEFAULT_RATES, BASELINE_24H_RATES),
  };

  async onModuleInit() {
    this.logger.log('Initializing Currency Service with 24h Forex Volatility tracking...');
    await this.syncRates();

    // 1 Hour Cron Interval (60 minutes * 60 seconds * 1000 ms)
    this.syncTimer = setInterval(() => {
      this.syncRates();
    }, 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
  }

  getRates(): ExchangeRateResponse {
    return this.cachedData;
  }

  computeVolatility(
    currentRates: Record<string, number>,
    referenceRates: Record<string, number>,
  ): Record<string, CurrencyVolatility> {
    const volatility: Record<string, CurrencyVolatility> = {};
    const keys = Object.keys(currentRates);

    for (const code of keys) {
      if (code === 'USD') {
        volatility[code] = {
          changePct: 0,
          trend: 'flat',
          prev24h: 1.0,
          risk: 'LOW',
        };
        continue;
      }

      const curr = currentRates[code] || 1.0;
      const prev = referenceRates[code] || BASELINE_24H_RATES[code] || curr;
      const diff = curr - prev;
      const changePct = prev !== 0 ? Number(((diff / prev) * 100).toFixed(2)) : 0;
      const trend: 'up' | 'down' | 'flat' =
        changePct > 0.04 ? 'up' : changePct < -0.04 ? 'down' : 'flat';
      const absChange = Math.abs(changePct);
      const risk: 'LOW' | 'MODERATE' | 'HIGH' =
        absChange > 0.75 ? 'HIGH' : absChange > 0.25 ? 'MODERATE' : 'LOW';

      volatility[code] = {
        changePct,
        trend,
        prev24h: prev,
        risk,
      };
    }

    return volatility;
  }

  async syncRates(): Promise<void> {
    try {
      this.logger.log('Fetching live market forex rates from central exchange feed...');
      const response = await fetch('https://open.er-api.com/v6/latest/USD', {
        headers: { 'User-Agent': 'Nexus-B2B-Platform' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch exchange rates: HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        result: string;
        time_last_update_unix?: number;
        rates?: Record<string, number>;
      };

      if (data && data.rates) {
        const supportedKeys = Object.keys(DEFAULT_RATES);
        const updatedRates: Record<string, number> = { ...DEFAULT_RATES };

        for (const code of supportedKeys) {
          if (data.rates[code] && typeof data.rates[code] === 'number') {
            updatedRates[code] = Number(data.rates[code].toFixed(4));
          }
        }

        const now = Date.now();
        // Record hourly snapshot in history (keep last 48 hours)
        this.rateHistory.push({
          timestamp: now,
          rates: { ...updatedRates },
        });
        if (this.rateHistory.length > 48) {
          this.rateHistory.shift();
        }

        // Find snapshot closest to 24h ago, or use baseline 24h reference rates
        const targetTime = now - 24 * 60 * 60 * 1000;
        const baselineSnapshot = this.rateHistory.find((s) => s.timestamp <= targetTime);
        const referenceRates = baselineSnapshot ? baselineSnapshot.rates : BASELINE_24H_RATES;
        const volatility = this.computeVolatility(updatedRates, referenceRates);

        this.cachedData = {
          base: 'USD',
          lastUpdated: new Date().toISOString(),
          timestamp: data.time_last_update_unix ? data.time_last_update_unix * 1000 : now,
          rates: updatedRates,
          volatility,
        };

        this.logger.log(
          `Exchange rates & volatility updated: EUR: ${updatedRates.EUR} (${volatility.EUR?.changePct}%), GBP: ${updatedRates.GBP} (${volatility.GBP?.changePct}%), INR: ${updatedRates.INR} (${volatility.INR?.changePct}%)`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to sync live exchange rates, retaining previous cached rates: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
