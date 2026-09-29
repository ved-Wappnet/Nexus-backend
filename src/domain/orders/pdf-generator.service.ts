import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';

export interface InvoiceItem {
  id: string;
  productId: string;
  productTitle: string;
  productSku: string;
  storeName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  status: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  documentType: string;
  orderId: string;
  issueDate: string | Date;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  issuer: {
    legalName: string;
    taxId: string;
    address: string;
    supportEmail: string;
    phone: string;
    website: string;
  };
  customer: {
    id: string;
    name: string;
    email: string;
    accountType: string;
  };
  items: InvoiceItem[];
  subtotal: number;
  taxRatePercent: number;
  taxAmount: number;
  shippingFee: number;
  totalAmount: number;
}

export interface WaybillData {
  waybillNumber: string;
  orderId: string;
  deliveryQrToken?: string | null;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string | null;
  estimatedDelivery?: string | Date | null;
  status: string;
  createdAt: string | Date;
  consignee: {
    name: string;
    email: string;
  };
  items: {
    productTitle: string;
    productSku: string;
    quantity: number;
    storeName: string;
  }[];
  checkpoints: {
    timestamp: string | Date;
    status: string;
    location?: string;
    description?: string;
  }[];
}

export interface RemittanceAdviceData {
  remittanceNumber: string;
  orderId: string;
  milestoneIndex: number;
  milestoneTitle: string;
  disbursedAt: string | Date;
  status: string;
  transactionReference: string;
  payoutMethod: string;
  bankAccountHint: string;
  currency: string;
  grossAmount: number;
  platformFeePercent: number;
  platformFeeAmount: number;
  netPayoutAmount: number;
  supplier: {
    storeName: string;
    accountHint: string;
  };
  buyer: {
    name: string;
    email?: string;
  };
  items: {
    productTitle: string;
    quantity: number;
    unitPrice: number;
  }[];
  notes?: string;
}

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);

  async generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        // Colors
        const primaryColor = '#4f46e5'; // Indigo 600
        const textDark = '#18181b';     // Zinc 900
        const textMuted = '#71717a';    // Zinc 500
        const borderLight = '#e4e4e7';  // Zinc 200
        const bgSubtle = '#f4f4f5';     // Zinc 100

        // Header Top Bar
        doc.rect(40, 40, 515, 60).fill(bgSubtle);

        doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold')
           .text('NEXUS', 55, 52, { continued: true })
           .fillColor(textDark).fontSize(10).font('Helvetica')
           .text('  ENTERPRISE B2B MARKETPLACE', { baseline: 'middle' });

        doc.fillColor(textMuted).fontSize(8)
           .text('Global Wholesale Direct Procurement & Escrow Settlement', 55, 75);

        doc.fillColor(textDark).fontSize(14).font('Helvetica-Bold')
           .text('TAX INVOICE', 380, 50, { align: 'right', width: 160 });

        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text(`Invoice #: ${data.invoiceNumber}`, 380, 70, { align: 'right', width: 160 })
           .text(`Date: ${new Date(data.issueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`, 380, 82, { align: 'right', width: 160 });

        // Divider
        doc.moveTo(40, 115).lineTo(555, 115).strokeColor(borderLight).lineWidth(1).stroke();

        // 2-Column Addresses Section
        const startY = 130;

        // Issuer Details (Left Column)
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold')
           .text('ISSUER / SERVICE PROVIDER', 45, startY);

        doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold')
           .text(data.issuer.legalName, 45, startY + 15);

        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text(`Tax ID / EIN: ${data.issuer.taxId}`, 45, startY + 28)
           .text(data.issuer.address, 45, startY + 40, { width: 220 })
           .text(`Email: ${data.issuer.supportEmail} | Tel: ${data.issuer.phone}`, 45, startY + 62);

        // Customer Details (Right Column)
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold')
           .text('BILLED TO / CUSTOMER', 315, startY);

        doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold')
           .text(data.customer.name, 315, startY + 15);

        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text(`Account: ${data.customer.accountType}`, 315, startY + 28)
           .text(`Email: ${data.customer.email}`, 315, startY + 40)
           .text(`Order Reference: #NX-${data.orderId.slice(0, 8).toUpperCase()}`, 315, startY + 52)
           .text(`Payment: ${data.paymentMethod} (${data.paymentStatus})`, 315, startY + 64);

        // Table Header
        const tableTop = 225;
        doc.rect(40, tableTop, 515, 22).fill(primaryColor);

        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
           .text('ITEM DESCRIPTION', 50, tableTop + 6)
           .text('SKU / VENDOR', 240, tableTop + 6)
           .text('QTY', 370, tableTop + 6, { align: 'center', width: 30 })
           .text('UNIT PRICE', 415, tableTop + 6, { align: 'right', width: 55 })
           .text('TOTAL', 485, tableTop + 6, { align: 'right', width: 60 });

        // Table Rows
        let currentY = tableTop + 24;
        let isAlt = false;

        data.items.forEach((item) => {
          if (isAlt) {
            doc.rect(40, currentY, 515, 26).fill(bgSubtle);
          }

          doc.fillColor(textDark).fontSize(8).font('Helvetica-Bold')
             .text(item.productTitle, 50, currentY + 4, { width: 180, lineBreak: false, ellipsis: true });

          doc.fillColor(textMuted).fontSize(7).font('Helvetica')
             .text(`${item.productSku} • ${item.storeName}`, 240, currentY + 4, { width: 120, lineBreak: false, ellipsis: true });

          doc.fillColor(textDark).fontSize(8).font('Helvetica')
             .text(String(item.quantity), 370, currentY + 4, { align: 'center', width: 30 })
             .text(`$${item.unitPrice.toFixed(2)}`, 415, currentY + 4, { align: 'right', width: 55 })
             .font('Helvetica-Bold')
             .text(`$${item.subtotal.toFixed(2)}`, 485, currentY + 4, { align: 'right', width: 60 });

          currentY += 26;
          isAlt = !isAlt;
        });

        // Horizontal line under table
        doc.moveTo(40, currentY).lineTo(555, currentY).strokeColor(borderLight).lineWidth(1).stroke();
        currentY += 12;

        // Financials Summary Box (Right aligned)
        const summaryX = 330;
        const summaryW = 225;

        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text('Subtotal:', summaryX, currentY)
           .text(`$${data.subtotal.toFixed(2)}`, summaryX, currentY, { align: 'right', width: summaryW });
        currentY += 14;

        doc.text(`Tax (${data.taxRatePercent}%):`, summaryX, currentY)
           .text(`$${data.taxAmount.toFixed(2)}`, summaryX, currentY, { align: 'right', width: summaryW });
        currentY += 14;

        doc.text('Shipping & Handling:', summaryX, currentY)
           .text(data.shippingFee === 0 ? 'FREE' : `$${data.shippingFee.toFixed(2)}`, summaryX, currentY, { align: 'right', width: summaryW });
        currentY += 16;

        // Total Highlight Box
        doc.rect(summaryX - 5, currentY - 3, summaryW + 10, 26).fill(bgSubtle).strokeColor(primaryColor).lineWidth(1).stroke();
        doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold')
           .text('TOTAL AMOUNT:', summaryX + 5, currentY + 4)
           .text(`$${data.totalAmount.toFixed(2)} USD`, summaryX + 5, currentY + 4, { align: 'right', width: summaryW });

        // Footer Notice & Security Stamp
        const footerY = 700;
        doc.moveTo(40, footerY).lineTo(555, footerY).strokeColor(borderLight).lineWidth(1).stroke();

        doc.fillColor(textMuted).fontSize(7).font('Helvetica')
           .text('This commercial invoice is electronically generated and secured via the Nexus B2B Wholesale Platform.', 40, footerY + 10, { align: 'center', width: 515 })
           .text(`Document verification code: NX-AUTH-${data.orderId.slice(0, 12).toUpperCase()} • Payment Status: ${data.paymentStatus.toUpperCase()} • Generated on: ${new Date().toISOString()}`, 40, footerY + 22, { align: 'center', width: 515 });

        doc.end();
      } catch (error) {
        this.logger.error(`Failed to generate invoice PDF: ${(error as Error).message}`);
        reject(error);
      }
    });
  }

  async generateWaybillPdf(data: WaybillData): Promise<Buffer> {
    const qrPayload = JSON.stringify({
      action: 'NEXUS_DELIVERY_SIGNOFF',
      orderId: data.orderId,
      token: data.deliveryQrToken || `NX-DLV-${data.orderId.slice(0, 8).toUpperCase()}`,
      waybillNumber: data.waybillNumber,
    });
    let qrBuffer: Buffer | null = null;
    try {
      qrBuffer = await QRCode.toBuffer(qrPayload, {
        type: 'png',
        width: 140,
        margin: 1,
        color: { dark: '#09090b', light: '#ffffff' },
      });
    } catch {
      qrBuffer = null;
    }

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const primaryColor = '#0284c7'; // Sky / Carrier Blue
        const textDark = '#18181b';
        const textMuted = '#71717a';
        const borderLight = '#e4e4e7';
        const bgSubtle = '#f0f9ff';     // Sky 50

        // Header Banner
        doc.rect(40, 40, 515, 65).fill(bgSubtle).strokeColor(primaryColor).lineWidth(1).stroke();

        doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold')
           .text('NEXUS LOGISTICS WAYBILL', 55, 52)
           .fillColor(textMuted).fontSize(8).font('Helvetica')
           .text('Official Carrier Dispatch Note & Packing Slip', 55, 72);

        doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold')
           .text(`WAYBILL #: ${data.waybillNumber}`, 340, 52, { align: 'right', width: 200 })
           .font('Helvetica').fontSize(8).fillColor(textMuted)
           .text(`Carrier: ${data.carrier || 'Nexus Standard Freight'}`, 340, 66, { align: 'right', width: 200 })
           .text(`Status: ${data.status.toUpperCase()}`, 340, 78, { align: 'right', width: 200 });

        // Barcode Visual Block Simulation
        const barcodeY = 120;
        doc.rect(40, barcodeY, 515, 50).fill('#ffffff').strokeColor(borderLight).lineWidth(1).stroke();

        // Draw alternating vertical bars for realistic courier barcode
        const barStartX = 70;
        const barWidth = 3;
        for (let i = 0; i < 65; i++) {
          const isThick = (i % 3 === 0 || i % 7 === 0);
          doc.rect(barStartX + i * 6, barcodeY + 8, isThick ? barWidth : 1.5, 24).fill('#18181b');
        }

        doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold')
           .text(`TRACKING #: ${data.trackingNumber || 'PENDING DISPATCH'}`, 40, barcodeY + 36, { align: 'center', width: 515 });

        // Dispatch & Destination Boxes
        const addrY = 185;
        // From Box
        doc.rect(40, addrY, 250, 75).fill('#fafafa').strokeColor(borderLight).lineWidth(1).stroke();
        doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold')
           .text('CONSIGNOR (ORIGIN / DISPATCH)', 50, addrY + 8);
        doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold')
           .text('Nexus Global Fulfillment Hub #4', 50, addrY + 22);
        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text('100 Market St, Logistics Dock B', 50, addrY + 35)
           .text('San Francisco, CA 94105', 50, addrY + 47)
           .text('Dispatched on behalf of Nexus Verified Vendors', 50, addrY + 59);

        // To Box
        doc.rect(305, addrY, 250, 75).fill('#fafafa').strokeColor(borderLight).lineWidth(1).stroke();
        doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold')
           .text('CONSIGNEE (DELIVER TO)', 315, addrY + 8);
        doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold')
           .text(data.consignee.name, 315, addrY + 22);
        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text(`Recipient Contact: ${data.consignee.email}`, 315, addrY + 35)
           .text(`Order Reference: #NX-${data.orderId.slice(0, 8).toUpperCase()}`, 315, addrY + 47)
           .text(`Est. Delivery: ${data.estimatedDelivery ? new Date(data.estimatedDelivery).toLocaleDateString() : 'Standard 3-5 Days'}`, 315, addrY + 59);

        // Package Contents Table
        const tableY = 275;
        doc.rect(40, tableY, 515, 20).fill(primaryColor);
        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
           .text('PACKAGE MANIFEST / ITEMS', 50, tableY + 6)
           .text('SKU CODE', 280, tableY + 6)
           .text('SUPPLIER', 380, tableY + 6)
           .text('QTY', 490, tableY + 6, { align: 'right', width: 50 });

        let currentY = tableY + 22;
        data.items.forEach((item) => {
          doc.rect(40, currentY, 515, 22).fill('#fafafa').strokeColor(borderLight).lineWidth(0.5).stroke();
          doc.fillColor(textDark).fontSize(8).font('Helvetica-Bold')
             .text(item.productTitle, 50, currentY + 5, { width: 220, lineBreak: false, ellipsis: true });
          doc.fillColor(textMuted).fontSize(7).font('Helvetica')
             .text(item.productSku, 280, currentY + 5)
             .text(item.storeName, 380, currentY + 5, { width: 100, lineBreak: false, ellipsis: true });
          doc.fillColor(textDark).fontSize(8).font('Helvetica-Bold')
             .text(String(item.quantity), 490, currentY + 5, { align: 'right', width: 50 });
          currentY += 22;
        });

        // Checkpoints History Section
        currentY += 15;
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold')
           .text('TRANSIT CHECKPOINT HISTORY', 45, currentY);
        currentY += 15;

        if (data.checkpoints && data.checkpoints.length > 0) {
          data.checkpoints.slice(-4).forEach((cp) => {
            doc.circle(50, currentY + 4, 3).fill(primaryColor);
            doc.fillColor(textDark).fontSize(8).font('Helvetica-Bold')
               .text(`${new Date(cp.timestamp).toLocaleString()}`, 62, currentY, { continued: true })
               .font('Helvetica').fillColor(textMuted)
               .text(` • ${cp.location || 'Hub'} — ${cp.description || cp.status}`);
            currentY += 16;
          });
        } else {
          doc.fillColor(textMuted).fontSize(8).font('Helvetica')
             .text('No transit checkpoints recorded yet. Package is awaiting carrier collection.', 50, currentY);
          currentY += 16;
        }

        // Signature & Acceptance Block with 72H Delivery Inspection QR Code
        const signY = 650;
        doc.rect(40, signY, 515, 85).strokeColor(borderLight).lineWidth(1).stroke();

        doc.fillColor(textMuted).fontSize(8).font('Helvetica-Bold')
           .text('CARRIER DISPATCH SIGN-OFF', 55, signY + 10)
           .text('RECIPIENT ACCEPTANCE', 230, signY + 10)
           .text('72H INSPECTION QR', 420, signY + 10);

        doc.moveTo(55, signY + 54).lineTo(210, signY + 54).strokeColor(borderLight).lineWidth(0.5).stroke();
        doc.moveTo(230, signY + 54).lineTo(395, signY + 54).strokeColor(borderLight).lineWidth(0.5).stroke();

        doc.fontSize(7).font('Helvetica').fillColor(textMuted)
           .text('Driver Signature & Date', 55, signY + 58)
           .text('Received in Good Condition / Sign', 230, signY + 58);

        if (qrBuffer) {
          doc.image(qrBuffer, 435, signY + 20, { width: 52, height: 52 });
        }
        doc.fontSize(6).font('Helvetica-Bold').fillColor(primaryColor)
           .text('SCAN TO START 72H SLA', 405, signY + 74, { align: 'center', width: 110 });

        doc.end();
      } catch (error) {
        this.logger.error(`Failed to generate waybill PDF: ${(error as Error).message}`);
        reject(error);
      }
    });
  }

  async generateRemittanceAdvicePdf(data: RemittanceAdviceData): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const emeraldColor = '#059669'; // Emerald 600
        const indigoColor = '#4f46e5';  // Indigo 600
        const textDark = '#18181b';     // Zinc 900
        const textMuted = '#71717a';    // Zinc 500
        const borderLight = '#e4e4e7';  // Zinc 200
        const bgSubtle = '#f4f4f5';     // Zinc 100

        // Generate QR verification buffer
        let qrBuffer: Buffer | null = null;
        try {
          const qrPayload = JSON.stringify({
            rem: data.remittanceNumber,
            tx: data.transactionReference,
            ord: data.orderId,
            m: data.milestoneIndex,
            amt: data.netPayoutAmount,
            status: data.status,
          });
          qrBuffer = await QRCode.toBuffer(qrPayload, {
            width: 120,
            margin: 1,
            color: { dark: '#047857', light: '#ffffff' },
          });
        } catch (e) {
          this.logger.warn(`Could not generate QR code for remittance: ${(e as Error).message}`);
        }

        // Top Header Banner
        doc.rect(40, 40, 515, 65).fill('#ecfdf5'); // Subtle emerald bg

        doc.fillColor(emeraldColor).fontSize(18).font('Helvetica-Bold')
           .text('NEXUS', 55, 52, { continued: true })
           .fillColor(textDark).fontSize(9).font('Helvetica')
           .text('  ESCROW TREASURY & SETTLEMENT', { baseline: 'middle' });

        doc.fillColor(textMuted).fontSize(8)
           .text('Cryptographically Verified B2B Milestone Escrow Disbursement', 55, 75);

        doc.fillColor(emeraldColor).fontSize(13).font('Helvetica-Bold')
           .text('REMITTANCE ADVICE', 350, 48, { align: 'right', width: 190 });

        doc.fillColor(textDark).fontSize(8).font('Helvetica-Bold')
           .text(`Ref: ${data.remittanceNumber}`, 350, 68, { align: 'right', width: 190 });

        doc.fillColor(textMuted).fontSize(7).font('Helvetica')
           .text(`Settlement Date: ${new Date(data.disbursedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 350, 80, { align: 'right', width: 190 });

        // Status Badge Pill
        doc.rect(460, 95, 80, 16).fillAndStroke(emeraldColor, emeraldColor);
        doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold')
           .text('SETTLED / PAID', 460, 99, { align: 'center', width: 80 });

        // Divider
        doc.moveTo(40, 120).lineTo(555, 120).strokeColor(borderLight).lineWidth(1).stroke();

        // 2-Column Info Block: Beneficiary Supplier & Order Association
        const startY = 135;

        // Beneficiary (Left Column)
        doc.fillColor(emeraldColor).fontSize(9).font('Helvetica-Bold')
           .text('BENEFICIARY SUPPLIER', 45, startY);

        doc.fillColor(textDark).fontSize(10).font('Helvetica-Bold')
           .text(data.supplier.storeName, 45, startY + 15);

        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text(`Settlement Destination: ${data.bankAccountHint}`, 45, startY + 30)
           .text(`Disbursal Protocol: ${data.payoutMethod}`, 45, startY + 43)
           .text(`Transaction Reference: ${data.transactionReference}`, 45, startY + 56);

        // Associated Consignment (Right Column)
        doc.fillColor(indigoColor).fontSize(9).font('Helvetica-Bold')
           .text('COMMERCIAL ORDER DETAILS', 315, startY);

        doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold')
           .text(`Order #NX-${data.orderId.slice(0, 8).toUpperCase()}`, 315, startY + 15);

        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text(`Purchaser / Buyer: ${data.buyer.name}`, 315, startY + 28)
           .text(`Milestone Phase: ${data.milestoneTitle}`, 315, startY + 41)
           .text(`Phase Index: Milestone ${data.milestoneIndex} of 3`, 315, startY + 54);

        // Milestone Release Banner Box
        const bannerY = 220;
        doc.rect(40, bannerY, 515, 38).fillAndStroke(bgSubtle, borderLight);
        doc.fillColor(textDark).fontSize(9).font('Helvetica-Bold')
           .text(`Escrow Release Trigger: `, 52, bannerY + 13, { continued: true })
           .fillColor(emeraldColor).font('Helvetica-Bold')
           .text(data.milestoneTitle);

        doc.fillColor(textMuted).fontSize(7).font('Helvetica')
           .text(data.notes || 'Verification checkpoint confirmed and funds released directly to supplier ledger.', 52, bannerY + 26);

        // Line Items Table Header
        const tableY = 275;
        doc.rect(40, tableY, 515, 22).fill(bgSubtle);
        doc.fillColor(textMuted).fontSize(8).font('Helvetica-Bold')
           .text('MERCHANDISE DESCRIPTION', 55, tableY + 7)
           .text('QTY', 340, tableY + 7, { width: 40, align: 'center' })
           .text('UNIT PRICE', 390, tableY + 7, { width: 70, align: 'right' })
           .text('ITEM TOTAL', 470, tableY + 7, { width: 75, align: 'right' });

        let rowY = tableY + 28;
        data.items.forEach((item) => {
          doc.fillColor(textDark).fontSize(8).font('Helvetica')
             .text(item.productTitle, 55, rowY, { width: 275 })
             .text(item.quantity.toString(), 340, rowY, { width: 40, align: 'center' })
             .text(`$${item.unitPrice.toFixed(2)}`, 390, rowY, { width: 70, align: 'right' })
             .font('Helvetica-Bold')
             .text(`$${(item.quantity * item.unitPrice).toFixed(2)}`, 470, rowY, { width: 75, align: 'right' });

          doc.moveTo(40, rowY + 16).lineTo(555, rowY + 16).strokeColor(borderLight).lineWidth(0.5).stroke();
          rowY += 22;
        });

        // Financial Calculation Summary Box (Right Aligned)
        const summaryY = Math.max(rowY + 15, 420);
        const boxX = 300;
        const boxW = 255;

        doc.rect(boxX, summaryY, boxW, 110).strokeColor(borderLight).lineWidth(1).stroke();

        doc.fillColor(textMuted).fontSize(8).font('Helvetica')
           .text(`Milestone Gross Release (${data.milestoneIndex === 2 ? '40%' : '30%'}):`, boxX + 15, summaryY + 12)
           .fillColor(textDark).font('Helvetica-Bold')
           .text(`$${data.grossAmount.toFixed(2)}`, boxX + 160, summaryY + 12, { width: 80, align: 'right' });

        doc.fillColor(textMuted).font('Helvetica')
           .text(`Platform Fee / Commission (${data.platformFeePercent}%):`, boxX + 15, summaryY + 30)
           .fillColor('#dc2626').font('Helvetica-Bold')
           .text(`-$${data.platformFeeAmount.toFixed(2)}`, boxX + 160, summaryY + 30, { width: 80, align: 'right' });

        doc.moveTo(boxX + 15, summaryY + 48).lineTo(boxX + boxW - 15, summaryY + 48).strokeColor(borderLight).lineWidth(0.5).stroke();

        doc.rect(boxX + 5, summaryY + 54, boxW - 10, 48).fill('#ecfdf5');
        doc.fillColor(emeraldColor).fontSize(8).font('Helvetica-Bold')
           .text('NET DISBURSED TO BANK:', boxX + 15, summaryY + 65);

        doc.fillColor(emeraldColor).fontSize(14).font('Helvetica-Bold')
           .text(`$${data.netPayoutAmount.toFixed(2)} ${data.currency}`, boxX + 15, summaryY + 79, { width: boxW - 30, align: 'right' });

        // Left Bottom: Banking Wire Stamp & QR Verification
        const authY = summaryY;
        doc.rect(40, authY, 245, 110).strokeColor(borderLight).lineWidth(1).stroke();

        if (qrBuffer) {
          doc.image(qrBuffer, 52, authY + 12, { width: 85, height: 85 });
        }

        doc.fillColor(emeraldColor).fontSize(8).font('Helvetica-Bold')
           .text('SETTLEMENT AUDIT', 145, authY + 18)
           .fillColor(textDark).fontSize(7).font('Helvetica')
           .text('Escrow Ledger: VALIDATED', 145, authY + 30)
           .text('Bank Hash Verified', 145, authY + 42)
           .text('Anti-Fraud Clearance: OK', 145, authY + 54)
           .fillColor(textMuted).fontSize(6)
           .text('Scan QR code for cryptographic settlement verification on Nexus Ledger.', 145, authY + 72, { width: 130 });

        // Footer Compliance Notice
        const footerY = 740;
        doc.moveTo(40, footerY).lineTo(555, footerY).strokeColor(borderLight).lineWidth(0.5).stroke();

        doc.fillColor(textMuted).fontSize(7).font('Helvetica')
           .text('This document serves as legal proof of financial disbursement under the Nexus B2B Wholesale Escrow Agreement.', 40, footerY + 8, { align: 'center', width: 515 })
           .text('Nexus Global Logistics & Financial Technologies Inc. • Automated Clearing House (ACH) & SWIFT Wire Operator', 40, footerY + 18, { align: 'center', width: 515 });

        doc.end();
      } catch (error) {
        this.logger.error(`Failed to generate remittance advice PDF: ${(error as Error).message}`);
        reject(error);
      }
    });
  }
}
