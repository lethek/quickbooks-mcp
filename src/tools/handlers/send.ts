// Handlers for send tools — email an invoice, sales receipt, or estimate PDF to the customer

import QuickBooks from "node-quickbooks";
import { promisify } from "../../client/index.js";

interface SendableEntity {
  Id: string;
  DocNumber?: string;
  EmailStatus?: string;
  TotalAmt?: number;
  CustomerRef?: { value: string; name?: string };
  BillEmail?: { Address?: string };
}

interface SendConfig {
  label: string;       // e.g. "Invoice"
  getMethod: string;   // node-quickbooks getter, e.g. "getInvoice"
  sendMethod: string;  // node-quickbooks sender, e.g. "sendInvoicePdf"
  urlSlug: string;     // QBO app path segment, e.g. "invoice"
}

async function sendTransaction(
  client: QuickBooks,
  config: SendConfig,
  args: { id: string; send_to?: string; draft?: boolean }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id, send_to, draft = true } = args;
  const { label, getMethod, sendMethod, urlSlug } = config;

  // Fetch the entity so we can resolve the recipient and show context before sending
  const entity = await promisify<unknown>((cb) =>
    (client as unknown as Record<string, Function>)[getMethod](id, cb)
  ) as SendableEntity;

  // QBO sends to ?sendTo= if provided, otherwise to the entity's BillEmail address
  const recipient = send_to || entity.BillEmail?.Address;
  const recipientSource = send_to ? "send_to" : "BillEmail on record";
  const qboUrl = `https://app.qbo.intuit.com/app/${urlSlug}?txnId=${id}`;

  if (draft) {
    const preview = [
      `DRAFT - Send ${label} Preview`,
      "",
      `${label}: #${entity.DocNumber || "(no ref)"} (ID ${id})`,
      `Customer: ${entity.CustomerRef?.name || entity.CustomerRef?.value || "(none)"}`,
      `Total: $${(entity.TotalAmt || 0).toFixed(2)}`,
      `Current Email Status: ${entity.EmailStatus || "(none)"}`,
      "",
      recipient
        ? `Will email to: ${recipient}  (from ${recipientSource})`
        : `WARNING: No recipient. This ${label.toLowerCase()} has no BillEmail and no send_to was provided — the send will fail. Provide send_to or set the customer's email first.`,
      "",
      `Set draft=false to email this ${label.toLowerCase()}.`,
    ].join("\n");

    return { content: [{ type: "text", text: preview }] };
  }

  // Pre-check the recipient so we return a clear error instead of an opaque QBO fault
  if (!recipient) {
    throw new Error(
      `No recipient: ${label} ${id} has no BillEmail on record and no send_to was provided. Provide send_to or set the customer's email first.`
    );
  }

  const result = await promisify<unknown>((cb) =>
    (client as unknown as Record<string, Function>)[sendMethod](id, send_to, cb)
  ) as SendableEntity;

  const response = [
    `${label} emailed to ${recipient}.`,
    "",
    `${label}: #${result.DocNumber || entity.DocNumber || "(no ref)"} (ID ${id})`,
    `Email Status: ${result.EmailStatus || "EmailSent"}`,
    "",
    `View in QuickBooks: ${qboUrl}`,
  ].join("\n");

  return { content: [{ type: "text", text: response }] };
}

const INVOICE_CONFIG: SendConfig = {
  label: "Invoice", getMethod: "getInvoice", sendMethod: "sendInvoicePdf", urlSlug: "invoice",
};
const SALES_RECEIPT_CONFIG: SendConfig = {
  label: "Sales Receipt", getMethod: "getSalesReceipt", sendMethod: "sendSalesReceiptPdf", urlSlug: "salesreceipt",
};

export function handleSendInvoice(
  client: QuickBooks,
  args: { id: string; send_to?: string; draft?: boolean }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return sendTransaction(client, INVOICE_CONFIG, args);
}

export function handleSendSalesReceipt(
  client: QuickBooks,
  args: { id: string; send_to?: string; draft?: boolean }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return sendTransaction(client, SALES_RECEIPT_CONFIG, args);
}
