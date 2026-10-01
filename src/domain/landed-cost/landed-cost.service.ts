import { Injectable, Logger } from '@nestjs/common';
import { CurrencyService } from '../currency/currency.service';
import { CalculateLandedCostDto } from './dtos/calculate-landed-cost.dto';

export interface CountryTradeProfile {
  code: string;
  name: string;
  flag: string;
  currency: string;
  standardDutyPercent: number;
  taxRatePercent: number;
  taxType: 'VAT' | 'GST' | 'SALES_TAX';
  taxName: string;
  clearanceSpeedDays: string;
  customsAuthority: string;
}

export const SUPPORTED_TRADE_COUNTRIES: Record<string, CountryTradeProfile> = {
  US: {
    code: 'US',
    name: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    standardDutyPercent: 1.5,
    taxRatePercent: 6.5,
    taxType: 'SALES_TAX',
    taxName: 'US State Sales Tax (Estimated)',
    clearanceSpeedDays: '1-2 Days',
    customsAuthority: 'U.S. Customs and Border Protection (CBP)',
  },
  DE: {
    code: 'DE',
    name: 'Germany (European Union)',
    flag: '🇩🇪',
    currency: 'EUR',
    standardDutyPercent: 2.5,
    taxRatePercent: 19.0,
    taxType: 'VAT',
    taxName: 'EU Import VAT (MwSt)',
    clearanceSpeedDays: '2-3 Days',
    customsAuthority: 'Zollamt (German Central Customs)',
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    standardDutyPercent: 3.0,
    taxRatePercent: 20.0,
    taxType: 'VAT',
    taxName: 'UK Import VAT',
    clearanceSpeedDays: '2-3 Days',
    customsAuthority: 'HM Revenue & Customs (HMRC)',
  },
  IN: {
    code: 'IN',
    name: 'India',
    flag: '🇮🇳',
    currency: 'INR',
    standardDutyPercent: 7.5,
    taxRatePercent: 18.0,
    taxType: 'GST',
    taxName: 'Integrated Goods & Services Tax (IGST)',
    clearanceSpeedDays: '3-4 Days',
    customsAuthority: 'Central Board of Indirect Taxes and Customs (CBIC)',
  },
  AE: {
    code: 'AE',
    name: 'United Arab Emirates',
    flag: '🇦🇪',
    currency: 'AED',
    standardDutyPercent: 5.0,
    taxRatePercent: 5.0,
    taxType: 'VAT',
    taxName: 'GCC Import VAT',
    clearanceSpeedDays: '1-2 Days',
    customsAuthority: 'Federal Customs Authority (FCA UAE)',
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    flag: '🇨🇦',
    currency: 'CAD',
    standardDutyPercent: 2.0,
    taxRatePercent: 5.0,
    taxType: 'GST',
    taxName: 'Goods and Services Tax (GST/HST)',
    clearanceSpeedDays: '2-3 Days',
    customsAuthority: 'Canada Border Services Agency (CBSA)',
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    flag: '🇦🇺',
    currency: 'AUD',
    standardDutyPercent: 5.0,
    taxRatePercent: 10.0,
    taxType: 'GST',
    taxName: 'Australian GST',
    clearanceSpeedDays: '2-3 Days',
    customsAuthority: 'Australian Border Force (ABF)',
  },
  JP: {
    code: 'JP',
    name: 'Japan',
    flag: '🇯🇵',
    currency: 'JPY',
    standardDutyPercent: 3.0,
    taxRatePercent: 10.0,
    taxType: 'VAT',
    taxName: 'Japan Consumption Tax (JCT)',
    clearanceSpeedDays: '2-3 Days',
    customsAuthority: 'Japan Customs (Ministry of Finance)',
  },
};

export interface CategoryHsTariff {
  hsCode: string;
  categoryName: string;
  dutyOverrides: Record<string, number>;
}

export const CATEGORY_HS_TARIFFS: Record<string, CategoryHsTariff> = {
  electronics: {
    hsCode: '8471.30',
    categoryName: 'Computers & Microelectronics',
    dutyOverrides: { US: 0.0, DE: 0.0, GB: 0.0, IN: 7.5, AE: 5.0, CA: 0.0, AU: 0.0, JP: 0.0 },
  },
  audio: {
    hsCode: '8518.30',
    categoryName: 'Acoustics & Headwear Audio',
    dutyOverrides: { US: 0.0, DE: 2.0, GB: 2.0, IN: 10.0, AE: 5.0, CA: 2.5, AU: 5.0, JP: 0.0 },
  },
  apparel: {
    hsCode: '6109.10',
    categoryName: 'Apparel & Commercial Textiles',
    dutyOverrides: { US: 12.0, DE: 12.0, GB: 12.0, IN: 20.0, AE: 5.0, CA: 14.0, AU: 5.0, JP: 10.0 },
  },
  industrial: {
    hsCode: '8467.21',
    categoryName: 'Industrial Automation & Tools',
    dutyOverrides: { US: 1.5, DE: 1.7, GB: 1.7, IN: 7.5, AE: 5.0, CA: 0.0, AU: 2.5, JP: 0.0 },
  },
  general: {
    hsCode: '9900.00',
    categoryName: 'General Wholesale Merchandise',
    dutyOverrides: { US: 2.0, DE: 3.0, GB: 3.0, IN: 10.0, AE: 5.0, CA: 3.5, AU: 5.0, JP: 3.0 },
  },
};

export interface LandedCostBreakdown {
  destinationCountry: string;
  destinationCountryName: string;
  flagEmoji: string;
  hsCode: string;
  category: string;
  quantity: number;
  currency: string;
  currencySymbol: string;
  exchangeRate: number;
  // Merchandise pricing
  baseUnitPriceUsd: number;
  tieredUnitPriceUsd: number;
  volumeDiscountPercent: number;
  merchandiseSubtotalUsd: number;
  // Freight & Logistics
  internationalFreightUsd: number;
  marineInsuranceUsd: number;
  cifValueUsd: number; // Cost, Insurance & Freight
  // Customs & Duties
  dutyRatePercent: number;
  dutyAmountUsd: number;
  // Local Taxes (VAT/GST)
  taxType: 'VAT' | 'GST' | 'SALES_TAX';
  taxName: string;
  taxRatePercent: number;
  taxAmountUsd: number;
  // Port Clearance & Brokerage
  brokerageFeeUsd: number;
  brokerageWaived: boolean;
  // Landed Cost Totals
  totalLandedCostUsd: number;
  unitLandedCostUsd: number;
  // Converted to target currency
  totalLandedCostTarget: number;
  unitLandedCostTarget: number;
  merchandiseSubtotalTarget: number;
  dutyAmountTarget: number;
  taxAmountTarget: number;
  freightTarget: number;
  // DDP & Compliance
  incoterms: 'DDP' | 'CIF';
  ddpGuaranteed: boolean;
  clearanceSpeedDays: string;
  customsAuthority: string;
}

@Injectable()
export class LandedCostService {
  private readonly logger = new Logger(LandedCostService.name);

  constructor(private readonly currencyService: CurrencyService) {}

  getSupportedCountries(): CountryTradeProfile[] {
    return Object.values(SUPPORTED_TRADE_COUNTRIES);
  }

  getTradeCountry(code: string): CountryTradeProfile {
    const upper = (code || 'US').toUpperCase();
    return SUPPORTED_TRADE_COUNTRIES[upper] || SUPPORTED_TRADE_COUNTRIES['US'];
  }

  computeWholesaleTierPrice(basePrice: number, quantity: number): { unitPrice: number; discountPercent: number } {
    if (quantity >= 100) return { unitPrice: Math.round(basePrice * 0.72 * 100) / 100, discountPercent: 28 };
    if (quantity >= 50) return { unitPrice: Math.round(basePrice * 0.8 * 100) / 100, discountPercent: 20 };
    if (quantity >= 10) return { unitPrice: Math.round(basePrice * 0.88 * 100) / 100, discountPercent: 12 };
    return { unitPrice: basePrice, discountPercent: 0 };
  }

  calculateLandedCost(dto: CalculateLandedCostDto): LandedCostBreakdown {
    const country = this.getTradeCountry(dto.destinationCountry);
    const qty = Math.max(1, Number(dto.quantity) || 1);
    const rawPrice = Number(dto.unitPrice) || 50;

    // 1. Wholesale volume tier pricing
    const { unitPrice: tieredUnitPriceUsd, discountPercent: volumeDiscountPercent } =
      this.computeWholesaleTierPrice(rawPrice, qty);
    const merchandiseSubtotalUsd = Math.round(tieredUnitPriceUsd * qty * 100) / 100;

    // 2. HS Code and Duty Rate Resolution
    const normalizedCategory = (dto.category || 'general').toLowerCase();
    const tariffInfo =
      CATEGORY_HS_TARIFFS[normalizedCategory] ||
      CATEGORY_HS_TARIFFS['electronics'] ||
      CATEGORY_HS_TARIFFS['general'];

    const hsCode = dto.hsCode || tariffInfo.hsCode;
    const dutyRatePercent =
      tariffInfo.dutyOverrides[country.code] !== undefined
        ? tariffInfo.dutyOverrides[country.code]
        : country.standardDutyPercent;

    // 3. International Freight & Cargo Insurance (Free freight over $5,000)
    let internationalFreightUsd = 0;
    if (merchandiseSubtotalUsd < 5000) {
      // Standard Air Cargo Corridor formula: $18 base + $2.50 per unit
      const baseFreight = 18.0 + (qty * 2.5);
      internationalFreightUsd = merchandiseSubtotalUsd >= 3000 ? Math.round(baseFreight * 0.5 * 100) / 100 : Math.round(baseFreight * 100) / 100;
    }

    const marineInsuranceUsd = Math.round(merchandiseSubtotalUsd * 0.0035 * 100) / 100; // 0.35% Nexus Escrow Insurance
    const cifValueUsd = Math.round((merchandiseSubtotalUsd + internationalFreightUsd + marineInsuranceUsd) * 100) / 100;

    // 4. Customs Duty Calculation (Calculated on CIF value)
    const dutyAmountUsd = Math.round((cifValueUsd * dutyRatePercent / 100) * 100) / 100;

    // 5. Local Import Tax / VAT / GST Calculation (Calculated on CIF + Duty)
    const taxableBaseUsd = cifValueUsd + dutyAmountUsd;
    const taxAmountUsd = Math.round((taxableBaseUsd * country.taxRatePercent / 100) * 100) / 100;

    // 6. Customs Brokerage & Port Inspection Fee (Waived for Nexus Verified Buyers)
    const brokerageFeeUsd = 0.0;
    const brokerageWaived = true;

    // 7. Total Landed Cost (Merchandise + Freight + Duty + Tax)
    const totalLandedCostUsd = Math.round((merchandiseSubtotalUsd + internationalFreightUsd + marineInsuranceUsd + dutyAmountUsd + taxAmountUsd + brokerageFeeUsd) * 100) / 100;
    const unitLandedCostUsd = Math.round((totalLandedCostUsd / qty) * 100) / 100;

    // 8. Currency Conversion
    const targetCurrency = (dto.currency || country.currency || 'USD').toUpperCase();
    const currencySymbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      INR: '₹',
      AED: 'AED',
      CAD: 'CA$',
      AUD: 'A$',
      JPY: '¥',
    };
    const currencySymbol = currencySymbols[targetCurrency] || '$';

    let exchangeRate = Number(dto.exchangeRate);
    if (!exchangeRate || exchangeRate <= 0) {
      const liveData = this.currencyService.getRates();
      exchangeRate = liveData.rates[targetCurrency] || 1.0;
    }

    const totalLandedCostTarget = Math.round(totalLandedCostUsd * exchangeRate * 100) / 100;
    const unitLandedCostTarget = Math.round(unitLandedCostUsd * exchangeRate * 100) / 100;
    const merchandiseSubtotalTarget = Math.round(merchandiseSubtotalUsd * exchangeRate * 100) / 100;
    const dutyAmountTarget = Math.round(dutyAmountUsd * exchangeRate * 100) / 100;
    const taxAmountTarget = Math.round(taxAmountUsd * exchangeRate * 100) / 100;
    const freightTarget = Math.round(internationalFreightUsd * exchangeRate * 100) / 100;

    return {
      destinationCountry: country.code,
      destinationCountryName: country.name,
      flagEmoji: country.flag,
      hsCode,
      category: tariffInfo.categoryName,
      quantity: qty,
      currency: targetCurrency,
      currencySymbol,
      exchangeRate,
      baseUnitPriceUsd: rawPrice,
      tieredUnitPriceUsd,
      volumeDiscountPercent,
      merchandiseSubtotalUsd,
      internationalFreightUsd,
      marineInsuranceUsd,
      cifValueUsd,
      dutyRatePercent,
      dutyAmountUsd,
      taxType: country.taxType,
      taxName: country.taxName,
      taxRatePercent: country.taxRatePercent,
      taxAmountUsd,
      brokerageFeeUsd,
      brokerageWaived,
      totalLandedCostUsd,
      unitLandedCostUsd,
      totalLandedCostTarget,
      unitLandedCostTarget,
      merchandiseSubtotalTarget,
      dutyAmountTarget,
      taxAmountTarget,
      freightTarget,
      incoterms: 'DDP', // Delivered Duty Paid
      ddpGuaranteed: true,
      clearanceSpeedDays: country.clearanceSpeedDays,
      customsAuthority: country.customsAuthority,
    };
  }
}
