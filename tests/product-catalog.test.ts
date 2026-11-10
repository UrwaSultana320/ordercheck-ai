import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupProductByBarcode,
  resolveProductByBarcode,
} from "../src/lib/product-catalog";
import { verify, type Order } from "../src/lib/engine";

const product = {
  id: "love-jojo-body-lotion-vitamin-c-500ml",
  barcode: "4897099081562",
  name: "Body Lotion",
  brand: "LOVE JOJO",
  variant: "Vitamin C Whitening",
  size: "500 ml",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function configured() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
}

describe("Supabase product catalog", () => {
  it("queries an active product by exact encoded barcode", async () => {
    configured();
    let requested = "";
    const result = await lookupProductByBarcode("4897099081562", {
      fetcher: async (input) => {
        requested = String(input);
        return new Response(JSON.stringify([product]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(result).toMatchObject({
      status: "found",
      source: "supabase",
      product,
    });
    const url = new URL(requested);
    expect(url.pathname).toBe("/rest/v1/products");
    expect(url.searchParams.get("barcode")).toBe("eq.4897099081562");
    expect(url.searchParams.get("active")).toBe("eq.true");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("treats an empty successful response as not found without JSON fallback", async () => {
    configured();
    const result = await resolveProductByBarcode("4897099081562", {
      fetcher: async () =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(result).toEqual({ status: "not-found", source: "supabase" });
  });

  it("uses the local catalog only when the Supabase request fails", async () => {
    configured();
    const result = await resolveProductByBarcode("4897099081562", {
      fetcher: async () => {
        throw new Error("offline");
      },
    });
    expect(result).toMatchObject({
      status: "found",
      source: "local-fallback",
      product,
    });
  });

  it("reports missing configuration without exposing values", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(await lookupProductByBarcode("4897099081562")).toEqual({
      status: "error",
      source: "supabase",
      reason: "configuration",
    });
  });

  it("accepts nullable optional database fields without substituting local data", async () => {
    configured();
    const result = await resolveProductByBarcode(product.barcode, {
      fetcher: async () => new Response(JSON.stringify([
        { ...product, brand: null, variant: null, size: null },
      ])),
    });
    expect(result).toMatchObject({
      status: "found", source: "supabase",
      product: { ...product, brand: "", variant: "", size: "" },
    });
  });

  it("passes database identity to verification and never revives a missing local barcode", async () => {
    configured();
    const orders: Order[] = [{ id: "order", label: "Spoken order", source: "voice", items: [{
      id: "item", name: product.name, brand: product.brand, variant: product.variant,
      size: product.size, quantity: 1, verified: 0,
    }] }];
    const remoteProduct = { ...product, id: "721e6f82-d952-4d75-bc7b-7c48035193bd" };
    const found = await resolveProductByBarcode(product.barcode, {
      fetcher: async () => new Response(JSON.stringify([remoteProduct])),
    });
    expect(found.status).toBe("found");
    if (found.status !== "found") throw new Error("Expected database identity");
    const verdict = verify(orders, {
      barcode: product.barcode, product: found.product,
      productSource: found.source, productLookup: "resolved",
    });
    expect(verdict).toMatchObject({ status: "MATCH", identity: remoteProduct.id });
    expect(verdict.fields?.[0].source).toContain("product database");
    expect(verify(orders, { barcode: product.barcode, productLookup: "not-found" }).status)
      .toBe("INCOMPLETE");
    expect(verify(orders, {
      barcode: product.barcode, productLookup: "not-found",
      text: "LOVE JOJO Body Lotion Vitamin C Whitening 500 ml", confidence: 99,
    })).toMatchObject({ status: "MATCH", reason: "COMPLETE_LABEL" });
  });

  it("rejects malformed database rows", async () => {
    configured();
    const result = await lookupProductByBarcode("4897099081562", {
      fetcher: async () =>
        new Response(JSON.stringify([{ barcode: "4897099081562" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(result).toEqual({
      status: "error",
      source: "supabase",
      reason: "invalid-response",
    });
  });
});
