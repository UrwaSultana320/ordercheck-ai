import { z } from "zod";
import catalog from "../data/catalog.v1.json";

const catalogProductSchema = z.object({
  id: z.string().min(1),
  barcode: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().nullable().transform((value) => value ?? ""),
  variant: z.string().nullable().transform((value) => value ?? ""),
  size: z.string().nullable().transform((value) => value ?? ""),
});

export type CatalogProduct = z.infer<typeof catalogProductSchema>;

export type ProductLookupResult =
  | { status: "found"; product: CatalogProduct; source: "supabase" | "local-fallback" }
  | { status: "not-found"; source: "supabase" }
  | {
      status: "error";
      source: "supabase";
      reason: "configuration" | "timeout" | "network" | "http" | "invalid-response";
    };

function localProduct(barcode: string): CatalogProduct | undefined {
  const product = catalog.products.find((p) => p.barcodes.includes(barcode));
  if (!product) return undefined;
  return {
    id: product.id,
    barcode,
    name: product.name,
    brand: product.brand,
    variant: product.variant,
    size: product.size,
  };
}

export function localProductByBarcode(barcode: string) {
  return localProduct(barcode);
}

export async function lookupProductByBarcode(
  barcode: string,
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<ProductLookupResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!baseUrl || !publishableKey) {
    return { status: "error", source: "supabase", reason: "configuration" };
  }

  let endpoint: URL;
  try {
    endpoint = new URL("/rest/v1/products", baseUrl);
  } catch {
    return { status: "error", source: "supabase", reason: "configuration" };
  }

  endpoint.searchParams.set("select", "id,barcode,name,brand,variant,size");
  endpoint.searchParams.set("barcode", `eq.${barcode}`);
  endpoint.searchParams.set("active", "eq.true");
  endpoint.searchParams.set("limit", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3500);

  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return { status: "error", source: "supabase", reason: "http" };
    }

    const parsed = z.array(catalogProductSchema).safeParse(await response.json());
    if (!parsed.success || parsed.data.length > 1) {
      return {
        status: "error",
        source: "supabase",
        reason: "invalid-response",
      };
    }

    if (parsed.data.length === 0) {
      return { status: "not-found", source: "supabase" };
    }

    return {
      status: "found",
      product: parsed.data[0],
      source: "supabase",
    };
  } catch {
    return {
      status: "error",
      source: "supabase",
      reason: controller.signal.aborted ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveProductByBarcode(
  barcode: string,
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<ProductLookupResult> {
  const remote = await lookupProductByBarcode(barcode, options);

  if (remote.status !== "error") return remote;

  const fallback = localProduct(barcode);
  if (fallback) {
    return {
      status: "found",
      product: fallback,
      source: "local-fallback",
    };
  }

  return remote;
}
