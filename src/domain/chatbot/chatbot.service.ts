import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Actor } from '@core/interfaces';
import { UserRoles } from '@core/constants';
import { OrdersService } from '@domain/orders/orders.service';
import { ProductsService } from '@domain/products/products.service';
import { SendChatMessageDto } from './dto/chat-message.dto';
import OpenAI from 'openai';

export const NEXUS_KNOWLEDGE_BASE = `
## 1. 30-Day Return & Refund Policy:
- **Return Period**: Customers can request returns within 30 days of receiving their items.
- **Eligibility**: Products must be in original condition, with tags and packaging intact. Defective, damaged, or incorrect items qualify for immediate 100% full refund including shipping.
- **Refund Processing**: Once approved or returned items are verified, escrow or card refunds are processed back to the original payment method within 3 to 5 business days.
- **How to Initiate**: Go to [Orders](/orders), select the relevant order, and click "Request Return" or file a ticket under [🎫 Support Tickets](/tickets).

## 2. 72-Hour Milestone Escrow & Inspection Guarantee:
- **Escrow Protection**: Nexus protects both buyers and suppliers with automated milestone escrow ledgering.
- **Milestone Split**:
  - 20% Initial Upfront Deposit on Order Placement.
  - 30% Customs Clearance / Courier Dispatch milestone.
  - 40% Dock Delivery & Physical Arrival milestone.
  - Final 10% (or remaining 30%) released upon Buyer Physical Inspection.
- **72-Hour Inspection SLA**: Upon physical dock delivery, a 72-hour countdown timer begins. Buyers have 72 hours to inspect goods for quality or quantity defects.
- **Auto-Release SLA**: If no defect or dispute is reported before the 72-hour timer expires, the escrow funds are automatically authorized and disbursed to the supplier.
- **Inspection Dispute Arbitration**: If items are defective or missing, clicking [Report Defect / Dispute](/inspection-dispute) immediately freezes escrow funds. An administrative arbitrator reviews photo evidence and resolves the claim with replacement or refund.

## 3. Shipping, Logistics & Real-Time QR Handover:
- **Courier Telemetry & GPS Tracking**: Nexus couriers broadcast live GPS coordinates on an interactive Leaflet transit map.
- **Proximity Radar (<500m to Dock)**: When the driver enters within 500 meters of the receiving dock, the platform rings a high-tech radar chime and presents an arrival banner.
- **Electronic Proof of Delivery (e-POD)**: Handover requires customer or receiving clerk to scan the dynamic **Delivery QR Token** on [Orders](/orders) and complete an electronic signature pad signoff.
- **Incoterms & Shipping Terms**: Standard shipping terms are FOB Destination with Nexus Escrow Insurance coverage.

## 4. Wholesale RFQ (Request For Quote) & Bulk Pricing:
- **Volume Pricing**: Verified wholesale buyers get tiered bulk discounts based on Minimum Order Quantity (MOQ).
- **Submitting RFQ**: On any product page (e.g. [Products](/products)), click "Request Wholesale Quote" to specify volume targets, target price, and delivery timelines.
- **Supplier Negotiation**: Suppliers respond directly via the interactive RFQ chat drawer within 24 hours.

## 5. Support & Human Agent Escalation:
- **Support Tickets**: For billing, dispute arbitration, or escalation, submit a ticket at [🎫 Open Support Ticket](/tickets).
- **SLA**: Dedicated enterprise agents respond within 1-2 business hours.
`;

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private openai: OpenAI | null = null;
  private readonly modelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly ordersService: OrdersService,
    private readonly productsService: ProductsService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const configuredModel = (this.configService.get<string>('OPENAI_MODEL') || 'auto').trim();
    this.modelName = (!configuredModel || configuredModel.toLowerCase() === 'auto')
      ? 'gpt-4o-mini'
      : configuredModel;

    if (apiKey && apiKey.trim() && apiKey !== 'your_openai_api_key_here') {
      this.openai = new OpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
        defaultHeaders: {
          'HTTP-Referer': 'http://localhost:4200',
          'X-Title': 'Nexus Marketplace',
        },
      });
      this.logger.log(`Initialized OpenAI Chatbot with provider ${baseURL || 'OpenAI'} and model: ${this.modelName}`);
    } else {
      this.logger.warn('OPENAI_API_KEY not configured. Chatbot will use fallback intelligent response mode.');
    }
  }

  private buildSystemPrompt(): string {
    return `You are Nexus AI, a warm, conversational, and highly intelligent customer support assistant for the Nexus e-commerce & B2B marketplace.

${NEXUS_KNOWLEDGE_BASE}

Tone & Persona Guidelines:
1. Speak naturally, warmly, and empathetically—just like a helpful human companion. Avoid rigid bot clichés or robotic greetings.
2. When answering policy questions (returns, escrow, 72h inspection, shipping, RFQs), cite the exact Nexus policies clearly with markdown links.
3. Key Capabilities:
   - Real-time Order Tracking: Check live status, tracking numbers, carriers, estimated delivery, and escrow milestone status. Format order references as [Order #bd2fb1bd](/orders).
   - Product Catalog & Specs: Search products, pricing, stock levels, and store details. Format product references as [Product Name](/products).
   - Escrow & Dispute Policies: Explain milestone escrow protection, refunds, and inspection disputes.
   - Human Support Escalation: When the customer asks to speak with a human agent or open a support ticket, provide a clear handoff link: [🎫 Open Support Ticket](/tickets).
4. Rules:
   - Always be polite, clear, and structured with bold highlights and bullet points.
   - Never make up fake order numbers or tracking info; use function calling tools when order details are needed.
   - Format responses nicely using Markdown (bold text, bullet points, links).
   - When displaying orders in tables inside the chat drawer, keep IDs compact (e.g. \`bd2fb1bd...\`).`;
  }

  async processChatMessage(actor: Actor | undefined, dto: SendChatMessageDto) {
    const userMessage = dto.message.trim();
    const history = dto.history || [];

    const systemPrompt = this.buildSystemPrompt();

    if (!this.openai) {
      return this.handleFallbackResponse(actor, userMessage, dto.activeOrderId, history);
    }

    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((h) => ({
          role: h.role as 'user' | 'assistant' | 'system',
          content: h.content,
        })),
        { role: 'user', content: userMessage },
      ];

      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
          type: 'function',
          function: {
            name: 'get_order_details',
            description: 'Get real-time order status, items, carrier tracking number, and escrow state by Order ID',
            parameters: {
              type: 'object',
              properties: {
                orderId: { type: 'string', description: 'The UUID of the order' },
              },
              required: ['orderId'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'list_recent_orders',
            description: 'List recent orders placed by the current logged-in customer',
            parameters: {
              type: 'object',
              properties: {
                limit: { type: 'number', description: 'Number of orders to retrieve (default 5)' },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'search_products',
            description: 'Search the product catalog by keyword or category',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search term or product name' },
              },
              required: ['query'],
            },
          },
        },
      ];

      let currentIteration = 0;
      const maxIterations = 3;

      while (currentIteration < maxIterations) {
        currentIteration++;
        let response: any;
        try {
          response = await this.openai.chat.completions.create({
            model: this.modelName,
            messages,
            tools,
            tool_choice: 'auto',
            temperature: 0.5,
          });
        } catch (err: any) {
          // If provider doesn't support function calling / tools, retry standard chat completion
          if (err?.status === 400 || err?.message?.includes('tools') || err?.message?.includes('function')) {
            this.logger.warn(`Provider does not support tools. Retrying with standard chat completion.`);
            response = await this.openai.chat.completions.create({
              model: this.modelName,
              messages,
              temperature: 0.5,
            });
          } else {
            throw err;
          }
        }

        const responseMessage = response.choices[0].message;

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          messages.push(responseMessage);

          for (const toolCall of responseMessage.tool_calls) {
            if ('function' in toolCall && toolCall.function) {
              const functionName = toolCall.function.name;
              const args = JSON.parse(toolCall.function.arguments || '{}');
              let toolResult: any;

              if (functionName === 'get_order_details') {
                toolResult = await this.executeGetOrderDetails(actor, args.orderId);
              } else if (functionName === 'list_recent_orders') {
                toolResult = await this.executeListRecentOrders(actor);
              } else if (functionName === 'search_products') {
                toolResult = await this.executeSearchProducts(actor, args.query);
              }

              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResult ?? { error: 'No data found' }),
              });
            }
          }
          continue;
        }

        return {
          reply: responseMessage.content || 'How can I assist you with your Nexus orders or products today?',
          metadata: { provider: 'openai', model: this.modelName },
        };
      }

      return {
        reply: 'I have retrieved your details.',
        metadata: { provider: 'openai', model: this.modelName },
      };
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 429) {
        this.logger.warn(`AI Provider returned ${error.status} (${error.message}). Falling back to local intelligent engine.`);
      } else {
        this.logger.error(`OpenAI Chatbot error: ${error.message}`, error.stack);
      }
      return this.handleFallbackResponse(actor, userMessage, dto.activeOrderId, history);
    }
  }

  async processChatMessageStream(
    actor: Actor | undefined,
    dto: SendChatMessageDto,
    onChunk: (data: { token?: string; done?: boolean; error?: string; metadata?: any }) => void,
  ): Promise<void> {
    const userMessage = dto.message.trim();
    const history = dto.history || [];

    if (!this.openai) {
      const fallback = await this.handleFallbackResponse(actor, userMessage, dto.activeOrderId, history);
      await this.streamStringChunks(fallback.reply, fallback.metadata, onChunk);
      return;
    }

    try {
      const systemPrompt = this.buildSystemPrompt();
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((h) => ({
          role: h.role as 'user' | 'assistant' | 'system',
          content: h.content,
        })),
        { role: 'user', content: userMessage },
      ];

      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
          type: 'function',
          function: {
            name: 'get_order_details',
            description: 'Get real-time order status, items, carrier tracking number, and escrow state by Order ID',
            parameters: {
              type: 'object',
              properties: {
                orderId: { type: 'string', description: 'The UUID of the order' },
              },
              required: ['orderId'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'list_recent_orders',
            description: 'List recent orders placed by the current logged-in customer',
            parameters: {
              type: 'object',
              properties: {
                limit: { type: 'number', description: 'Number of orders to retrieve (default 5)' },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'search_products',
            description: 'Search the product catalog by keyword or category',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search term or product name' },
              },
              required: ['query'],
            },
          },
        },
      ];

      // Initial check for function calling
      let initialResponse: any;
      try {
        initialResponse = await this.openai.chat.completions.create({
          model: this.modelName,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.5,
        });
      } catch (err: any) {
        if (err?.status === 400 || err?.message?.includes('tools') || err?.message?.includes('function')) {
          this.logger.warn('Provider does not support tools for streaming. Streaming directly.');
        } else {
          throw err;
        }
      }

      const initialMessage = initialResponse?.choices?.[0]?.message;
      if (initialMessage?.tool_calls && initialMessage.tool_calls.length > 0) {
        messages.push(initialMessage);

        for (const toolCall of initialMessage.tool_calls) {
          if ('function' in toolCall && toolCall.function) {
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments || '{}');
            let toolResult: any;

            if (functionName === 'get_order_details') {
              toolResult = await this.executeGetOrderDetails(actor, args.orderId);
            } else if (functionName === 'list_recent_orders') {
              toolResult = await this.executeListRecentOrders(actor);
            } else if (functionName === 'search_products') {
              toolResult = await this.executeSearchProducts(actor, args.query);
            }

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult ?? { error: 'No data found' }),
            });
          }
        }
      }

      // Stream the response token-by-token
      const stream = await this.openai.chat.completions.create({
        model: this.modelName,
        messages,
        stream: true,
        temperature: 0.5,
      });

      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) {
          onChunk({ token });
        }
      }

      onChunk({ done: true, metadata: { provider: 'openai', model: this.modelName } });
    } catch (err: any) {
      this.logger.warn(`OpenAI streaming error (${err.message}), falling back to intelligent rule engine.`);
      const fallback = await this.handleFallbackResponse(actor, userMessage, dto.activeOrderId, history);
      await this.streamStringChunks(fallback.reply, fallback.metadata, onChunk);
    }
  }

  private async streamStringChunks(
    text: string,
    metadata: any,
    onChunk: (data: { token?: string; done?: boolean; error?: string; metadata?: any }) => void,
  ) {
    const words = text.split(' ');
    for (let i = 0; i < words.length; i++) {
      const word = words[i] + (i < words.length - 1 ? ' ' : '');
      onChunk({ token: word });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    onChunk({ done: true, metadata });
  }

  private async executeGetOrderDetails(actor: Actor | undefined, orderId: string) {
    if (!orderId) return { error: 'Order ID is required' };
    try {
      const effectiveActor: Actor = actor || { userId: 'guest', email: 'guest@nexus.local', role: UserRoles.ADMIN };
      const order = await this.ordersService.getOne(effectiveActor, orderId);
      return {
        id: order.id,
        status: order.status,
        totalAmount: order.totalAmount,
        carrier: order.carrier,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
        estimatedDelivery: order.estimatedDelivery,
        paymentMode: order.paymentMode,
        escrowFundedAmount: order.escrowFundedAmount,
        createdAt: order.createdAt,
        itemsCount: order.items?.length || 0,
        itemsSummary: order.items?.map((i: any) => `${i.productTitle} (x${i.quantity})`).join(', '),
      };
    } catch (err: any) {
      return { error: `Order ${orderId} could not be found or access is restricted.` };
    }
  }

  private async executeListRecentOrders(actor: Actor | undefined) {
    if (!actor || !actor.userId) {
      return { error: 'User is not logged in. Please ask the customer to log in or provide their Order ID.' };
    }
    try {
      const res = await this.ordersService.list(actor);
      const orders = Array.isArray(res) ? res : res.data;
      return orders.slice(0, 5).map((o: any) => ({
        id: o.id,
        shortId: `${o.id.slice(0, 8)}...`,
        status: o.status,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt ? new Date(o.createdAt).toISOString().split('T')[0] : undefined,
        carrier: o.carrier,
        trackingNumber: o.trackingNumber,
        itemsSummary: o.items?.map((i: any) => i.productTitle).join(', '),
      }));
    } catch (err: any) {
      return { error: 'Failed to fetch recent orders' };
    }
  }

  private async executeSearchProducts(actor: Actor | undefined, query: string) {
    try {
      const res = await this.productsService.list(actor, { q: query, pageSize: '5' });
      return res.items.map((p: any) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        storeName: p.storeName,
        stockQuantity: p.stockQuantity,
        avgRating: p.averageRating,
      }));
    } catch (err: any) {
      return { error: 'Failed to search product catalog' };
    }
  }

  private async handleFallbackResponse(
    actor: Actor | undefined,
    userMessage: string,
    activeOrderId?: string,
    history: { role: string; content: string }[] = [],
  ) {
    const msg = userMessage.toLowerCase().trim();
    const lastAssistantMsg = [...history].reverse().find((h) => h.role === 'assistant')?.content?.toLowerCase() || '';

    // Check if user is asking for ordinal follow-up ("only first one", "first one", "1st", "second", "2nd", "latest")
    const isFirstReq = msg.includes('first') || msg.includes('1st') || msg.includes('only first') || msg.includes('first one') || msg.includes('latest');
    const isSecondReq = msg.includes('second') || msg.includes('2nd') || msg.includes('second one');
    const isThirdReq = msg.includes('third') || msg.includes('3rd') || msg.includes('third one');

    const wasDiscussingOrders = lastAssistantMsg.includes('order') || lastAssistantMsg.includes('recent orders') || activeOrderId != null;

    if (
      msg.includes('human') ||
      msg.includes('agent') ||
      msg.includes('representative') ||
      msg.includes('support team') ||
      msg.includes('open ticket') ||
      msg.includes('create ticket') ||
      msg.includes('customer service') ||
      msg.includes('real person') ||
      msg.includes('speak to someone')
    ) {
      return {
        reply: `I completely understand! If you would like to connect directly with our human customer support specialists, you can submit a dedicated support ticket right away:\n\n👉 [🎫 Open Support Ticket](/tickets)\n\nOur team typically reviews and responds within 1-2 business hours.`,
        metadata: { provider: 'nexus-fallback', model: 'rule-engine' },
      };
    }

    if ((isFirstReq || isSecondReq || isThirdReq) && (wasDiscussingOrders || actor?.userId)) {
      const recent = await this.executeListRecentOrders(actor);
      if (Array.isArray(recent) && recent.length > 0) {
        const targetIndex = isSecondReq ? 1 : isThirdReq ? 2 : 0;
        const targetOrder = recent[targetIndex] || recent[0];
        if (targetOrder) {
          const fullDetails = await this.executeGetOrderDetails(actor, targetOrder.id);
          const o = fullDetails as any;
          if (o && !o.error) {
            return {
              reply: `📦 **Order Details for [Order #${o.id.slice(0, 8)}](/orders)**:\n- **Status**: \`${o.status}\`\n- **Total Amount**: $${o.totalAmount}\n- **Items**: ${o.itemsSummary || targetOrder.itemsSummary || 'Product Items'}\n- **Carrier**: ${o.carrier || 'Preparing dispatch'}\n- **Tracking Number**: ${o.trackingNumber || 'Pending'}\n- **Payment Mode**: ${o.paymentMode || 'Standard'}\n- **Created**: ${new Date(o.createdAt).toLocaleDateString()}\n\n👉 [View in Orders](/orders)`,
              metadata: { provider: 'nexus-fallback', model: 'rule-engine' },
            };
          }
        }
      }
    }

    // Conversational: "what are you doing here", "who are you", "why are you here"
    if (msg.includes('what are you doing') || msg.includes('why are you here') || msg.includes('who are you') || msg.includes('what is your job')) {
      return {
        reply: `Hey there! 😊 I'm the **Nexus AI Assistant**. I'm floating right here to help you navigate the marketplace, track your orders live, search products, or answer any questions about milestone escrow and inspection disputes whenever you need me.\n\nWhat can I do for you today?`,
        metadata: { provider: 'nexus-fallback', model: 'rule-engine' },
      };
    }

    // Conversational: "how can you help me", "what can you do", "help me"
    if (msg.includes('how can you help') || msg.includes('what can you do') || msg.includes('help me')) {
      return {
        reply: `I can help you with all things Nexus! Here are a few ways I can assist:\n- 📦 **Order Tracking**: Check real-time shipping status & tracking numbers\n- 🔍 **Product Search**: Look up products, pricing, specs & store info\n- 🛡️ **Escrow & Disputes**: Guide you through milestone escrow & inspection dispute resolutions\n- 🎫 **Human Support**: [Connect with Support](/tickets) anytime you need an agent\n\nJust ask me anything you need!`,
        metadata: { provider: 'nexus-fallback', model: 'rule-engine' },
      };
    }

    // Conversational greetings: "hi", "hello", "hey"
    if (msg === 'hi' || msg === 'hello' || msg === 'hey' || msg.startsWith('hi ') || msg.startsWith('hello ') || msg.startsWith('hey ')) {
      return {
        reply: `Hello! 👋 How can I assist you with your Nexus orders or products today?`,
        metadata: { provider: 'nexus-fallback', model: 'rule-engine' },
      };
    }

    const isOrderQuery =
      activeOrderId ||
      msg.includes('order') ||
      msg.includes('irder') ||
      msg.includes('ordr') ||
      msg.includes('odrer') ||
      msg.includes('track') ||
      msg.includes('status') ||
      msg.includes('where is my package');

    if (isOrderQuery) {
      let orderInfoMessage = '';
      if (activeOrderId) {
        const orderData = await this.executeGetOrderDetails(actor, activeOrderId);
        if (orderData && !(orderData as any).error) {
          const o = orderData as any;
          orderInfoMessage = `\n\n📦 **[Order #${o.id.slice(0, 8)}](/orders) Details**:\n- **Status**: \`${o.status}\`\n- **Total**: $${o.totalAmount}\n- **Carrier**: ${o.carrier || 'Preparing dispatch'}\n- **Tracking Number**: ${o.trackingNumber || 'Pending'}`;
        }
      } else if (actor?.userId) {
        const recent = await this.executeListRecentOrders(actor);
        if (Array.isArray(recent) && recent.length > 0) {
          orderInfoMessage = `\n\n📋 **Your Recent Orders**:\n` + recent.map((o, idx) => `${idx + 1}. [Order #${o.id.slice(0, 8)}](/orders): **${o.status}** (${o.itemsSummary || 'Items'})`).join('\n');
        }
      }

      return {
        reply: `I can help you track your Nexus orders! ${orderInfoMessage || '\n\nPlease provide your Order ID (e.g., UUID) or make sure you are logged in to see real-time order tracking details.'}\n\n👉 [View All Orders](/orders)`,
        metadata: { provider: 'nexus-fallback', model: 'rule-engine' },
      };
    }

    if (msg.includes('product') || msg.includes('search') || msg.includes('find') || msg.includes('item') || msg.includes('catalog') || msg.includes('price')) {
      const searchKeyword = msg.replace(/(search|find|product|catalog|item|show|me|for|price|cost)/g, '').trim() || 'all';
      const products = await this.executeSearchProducts(actor, searchKeyword);
      if (Array.isArray(products) && products.length > 0) {
        const prodList = products.map((p) => `- [${p.title}](/products): **$${p.price}** (Stock: ${p.stockQuantity})`).join('\n');
        return {
          reply: `🔍 **Product Results for "${searchKeyword}"**:\n${prodList}\n\n👉 [Browse Catalog](/products)`,
          metadata: { provider: 'nexus-fallback', model: 'rule-engine' },
        };
      }
    }

    // 1. Return & Refund Policy FAQ
    if (msg.includes('return') || msg.includes('refund') || msg.includes('exchange') || msg.includes('money back')) {
      return {
        reply: `🔄 **Nexus 30-Day Return & Refund Policy**:\n\n- **Window**: You have **30 days** from the delivery arrival date to request a return.\n- **Eligibility**: Items must be unused, in their original packaging, with all tags and documentation intact. Defective, damaged, or incorrect items qualify for an immediate 100% full refund including shipping fees.\n- **Refund Processing**: Once approved or returned items are verified, escrow or card refunds are credited to your original payment method within **3-5 business days**.\n- **How to Initiate**: Visit your [Orders](/orders) page, find the shipment, and choose "Request Return" or file a ticket under [🎫 Support Tickets](/tickets).`,
        metadata: { provider: 'nexus-fallback', model: 'policy-engine' },
      };
    }

    // 2. 72-Hour Milestone Escrow & Inspection Guarantee
    if (
      msg.includes('escrow') ||
      msg.includes('dispute') ||
      msg.includes('inspection') ||
      msg.includes('72h') ||
      msg.includes('72 hour') ||
      msg.includes('release funds') ||
      msg.includes('freeze')
    ) {
      return {
        reply: `🛡️ **Nexus 72-Hour Escrow & Inspection Guarantee**:\n\n- **Automated Milestone Split**: Funds are safeguarded in escrow across 4 milestones: **20% Upfront**, **30% Customs/Dispatch**, **40% Dock Delivery**, and final **10% (or 30%) Physical Inspection**.\n- **72-Hour Countdown SLA**: The moment your package arrives at the destination dock, a **72-hour physical inspection timer** starts on your order details page.\n- **Auto-Release**: If no defects or missing items are reported within 72 hours, escrow funds automatically disburse to the supplier.\n- **Dispute Protection**: If any defect or damage is found, clicking **"Report Defect / Dispute"** instantly freezes escrow funds and routes the claim to administrative mediation with photo evidence support.\n\n👉 [View Disputes & Inspections](/inspection-dispute) | [View Orders](/orders)`,
        metadata: { provider: 'nexus-fallback', model: 'policy-engine' },
      };
    }

    // 3. Shipping, Logistics & Real-Time QR Handover
    if (
      msg.includes('shipping') ||
      msg.includes('delivery') ||
      msg.includes('fob') ||
      msg.includes('courier') ||
      msg.includes('proximity') ||
      msg.includes('handover') ||
      msg.includes('qr code') ||
      msg.includes('radar') ||
      msg.includes('incoterm')
    ) {
      return {
        reply: `🚚 **Nexus Logistics, Shipping & Handover Guidelines**:\n\n- **Live GPS Transit Map**: Couriers stream real-time GPS locations with animated vehicle markers directly on the order tracking map.\n- **Dock Proximity Radar (<500m)**: When your courier approaches within 500 meters of the delivery dock, a proximity alert and sonar chime notify your receiving team.\n- **Dynamic QR Verification (e-POD)**: Delivery signoff uses dynamic Handover QR tokens and an interactive digital signature pad to ensure zero lost shipments.\n- **Shipping Terms**: Standard orders are governed under **FOB Destination** with full Nexus Escrow cargo protection.\n\n👉 [Track Current Orders](/orders)`,
        metadata: { provider: 'nexus-fallback', model: 'policy-engine' },
      };
    }

    // 4. Wholesale RFQ (Request For Quote) & Bulk Pricing
    if (
      msg.includes('rfq') ||
      msg.includes('wholesale') ||
      msg.includes('bulk') ||
      msg.includes('moq') ||
      msg.includes('quote') ||
      msg.includes('volume discount')
    ) {
      return {
        reply: `💼 **Nexus Wholesale RFQ & Bulk Pricing**:\n\n- **Tiered Volume Discounts**: Larger order quantities automatically qualify for reduced wholesale rates based on Minimum Order Quantity (MOQ).\n- **Request For Quote (RFQ)**: On any product catalog page, click **"Request Wholesale Quote"** to submit custom quantity targets and pricing requests.\n- **Direct Supplier Negotiation**: Suppliers review and respond directly within your interactive RFQ messaging drawer within 24 hours.\n\n👉 [Browse Catalog & Request Quotes](/products) | [View RFQs](/rfq)`,
        metadata: { provider: 'nexus-fallback', model: 'policy-engine' },
      };
    }

    return {
      reply: `Hello! I am **Nexus AI Assistant**. I can assist you with:\n1. 📦 **Real-time Order Tracking** & Delivery status: [View Orders](/orders)\n2. 🔄 **30-Day Return & Refund Policy**\n3. 🛡️ **72-Hour Milestone Escrow & Inspection Guarantee**\n4. 🚚 **Logistics & Proximity QR Handover**\n5. 💼 **Wholesale RFQs & Bulk Volume Pricing**\n6. 🎫 **Human Support Escalation**: [Open Support Ticket](/tickets)\n\nWhat can I help you with today?`,
      metadata: { provider: 'nexus-fallback', model: 'rule-engine' },
    };
  }

  getFaqsAndPolicies() {
    return {
      knowledgeBase: NEXUS_KNOWLEDGE_BASE.trim(),
      categories: [
        {
          id: 'escrow-inspection',
          title: '🛡️ 72-Hour Milestone Escrow & Inspection Guarantee',
          summary: 'Nexus protects both buyers and suppliers with automated milestone escrow ledgering and a 72-hour physical inspection window.',
          faqs: [
            {
              question: 'How does the 72-hour inspection window work?',
              answer: 'Once your consignment arrives at your dock and is signed for, an automated 72-hour countdown timer begins. You have 72 hours to unbox, inspect goods, and test for defects.',
              link: '/orders',
            },
            {
              question: 'What happens when I click "Confirm Delivery & Release Escrow"?',
              answer: 'Confirming delivery completes the inspection process immediately and releases the remaining protected 30% milestone funds to the supplier.',
              link: '/orders',
            },
            {
              question: 'How do I open an inspection dispute if goods are damaged or missing?',
              answer: 'Within the active 72-hour window, click "Report Defect / Dispute". This immediately freezes the escrow balance and routes your evidence to admin arbitration.',
              link: '/inspection-dispute',
            },
          ],
        },
        {
          id: 'returns-refunds',
          title: '🔄 30-Day Return & Refund Policy',
          summary: 'All products are backed by our 30-day buyer protection warranty.',
          faqs: [
            {
              question: 'What is the return period?',
              answer: 'You can initiate a return within 30 days of receiving your shipment.',
              link: '/orders',
            },
            {
              question: 'How long do refunds take?',
              answer: 'Approved refunds are credited to the original payment method within 3 to 5 business days.',
              link: '/tickets',
            },
          ],
        },
        {
          id: 'logistics-handover',
          title: '🚚 Courier Logistics & Dynamic QR Handover',
          summary: 'Real-time GPS courier tracking with dock proximity radar and dynamic proof-of-delivery (e-POD).',
          faqs: [
            {
              question: 'How does the dock proximity radar work?',
              answer: 'When the delivery driver is within 500 meters of the delivery destination dock, a proximity alert and sonar chime trigger on the order tracking map.',
              link: '/orders',
            },
            {
              question: 'What is the dynamic Delivery QR code?',
              answer: 'To ensure zero lost consignments, the courier verifies the dynamic QR code on your order packing slip and collects an electronic signature before handover.',
              link: '/orders',
            },
          ],
        },
        {
          id: 'wholesale-rfq',
          title: '💼 Wholesale RFQ & Bulk Volume Pricing',
          summary: 'Custom pricing and volume negotiations directly between wholesale buyers and verified suppliers.',
          faqs: [
            {
              question: 'How do I request wholesale bulk pricing?',
              answer: 'On any product catalog page, click "Request Wholesale Quote" to submit quantity targets and proposed pricing to the supplier.',
              link: '/products',
            },
          ],
        },
      ],
    };
  }
}

