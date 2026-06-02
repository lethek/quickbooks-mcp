// Handler for list_tax_codes tool

import QuickBooks from "node-quickbooks";
import { getTaxCodeCache } from "../../client/index.js";
import { outputReport } from "../../utils/index.js";

export async function handleListTaxCodes(
  client: QuickBooks,
  args: { active_only?: boolean }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { active_only = true } = args;

  // Use the tax code cache (fetches all tax codes)
  const cache = await getTaxCodeCache(client);

  // Apply filters client-side
  let codes = cache.items;

  if (active_only) {
    codes = codes.filter(t => t.Active !== false);
  }

  const result = {
    QueryResponse: {
      TaxCode: codes.map(c => ({
        Id: c.Id,
        Name: c.Name,
        Description: c.Description,
        Taxable: c.Taxable,
        Active: c.Active,
      })),
    },
  };

  const summary = [
    `Tax Codes: ${codes.length}`,
    "",
    "Sample (first 20):",
    ...codes.slice(0, 20).map(t =>
      `  ${t.Id} - ${t.Name} (${t.Taxable ? "Taxable" : "Non-taxable"}, ${t.Active !== false ? "Active" : "Inactive"})`
    )
  ].join("\n");

  return outputReport("tax_codes", result, summary);
}
