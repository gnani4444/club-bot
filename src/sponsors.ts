// Optional sponsor integrations. Each is a no-op when its env vars are unset, so the bot runs without them.
import Stripe from "stripe";

const log = (what: string, e: unknown) => console.warn(`[${what}] ${e instanceof Error ? e.message : e}`);

/** Stripe test-mode payment link for one player's share; falls back to PAY_LINK. */
export async function paymentLink(sessionLabel: string, amountPence: number): Promise<string> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return process.env.PAY_LINK ?? "(set PAY_LINK in .env)";
  const stripe = new Stripe(key);
  const price = await stripe.prices.create({
    currency: "gbp", unit_amount: amountPence, product_data: { name: sessionLabel },
  });
  const link = await stripe.paymentLinks.create({ line_items: [{ price: price.id, quantity: 1 }] });
  return link.url;
}

const DATASET = "club";

/** Cognee: club memory. Stores events as text; !ask queries the graph. */
async function cognee(path: string, body: unknown) {
  const base = process.env.COGNEE_API_URL;
  if (!base) return undefined;
  const form = body instanceof FormData;
  const headers: Record<string, string> = form ? {} : { "Content-Type": "application/json" };
  if (process.env.COGNEE_API_KEY) headers["X-Api-Key"] = process.env.COGNEE_API_KEY;
  const res = await fetch(`${base.replace(/\/$/, "")}/api/v1${path}`, { method: "POST", headers, body: form ? body : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return res.json();
}

export function remember(fact: string): void {
  // JSON /add ignores datasetName (409); multipart is the form that accepts it.
  const fd = new FormData();
  fd.append("datasetName", DATASET);
  fd.append("data", new Blob([fact], { type: "text/plain" }), `fact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  cognee("/add", fd).catch((e) => log("cognee", e));
}

export async function ask(question: string): Promise<string> {
  if (!process.env.COGNEE_API_URL) return "Club memory is off (set COGNEE_API_URL).";
  try {
    await cognee("/cognify", { datasets: [DATASET] });
    const r = await cognee("/search", { query: question, search_type: "GRAPH_COMPLETION", datasets: [DATASET] });
    // Response: [{ dataset_name, search_result: [answer, ...] }, ...]
    const answers = (r as { search_result?: unknown[] }[]).flatMap((d) => d.search_result ?? []);
    return answers.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join("\n") || "Nothing in club memory about that yet.";
  } catch (e) {
    log("cognee", e);
    return "Club memory is unavailable right now.";
  }
}

/** Notion: one log page per finished session. DB title property must be named "Name". */
export async function notionLog(title: string, lines: string[]): Promise<void> {
  const token = process.env.NOTION_TOKEN, dbId = process.env.NOTION_DB_ID;
  if (!token || !dbId) return;
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: { Name: { title: [{ text: { content: title } }] } },
      children: lines.map((l) => ({
        object: "block", type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ text: { content: l } }] },
      })),
    }),
  });
  if (!res.ok) log("notion", `${res.status} ${await res.text()}`);
}
