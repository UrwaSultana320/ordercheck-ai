import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupProductByBarcode,
  resolveProductByBarcode,
} from "../src/lib/product-catalog";

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
