import { assertEquals } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import * as apiClient from "./api_client.ts";

Deno.test("API Client", async (t) => {
  await t.step("checkHealth", async (t) => {
    await t.step("should return success when API is healthy", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ ok: true, message: "Healthy" }), {
              status: 200,
            }),
          ),
      );

      try {
        const result = await apiClient.checkHealth();
        assertEquals(result.success, true);
        assertEquals(result.message, "Healthy");
        assertEquals(result.error, null);
      } finally {
        fetchStub.restore();
      }
    });

    await t.step(
      "should return error when API returns non-200 status",
      async () => {
        const fetchStub = stub(
          globalThis,
          "fetch",
          () =>
            Promise.resolve(
              new Response("Internal Server Error", {
                status: 500,
              }),
            ),
        );

        try {
          const result = await apiClient.checkHealth();
          assertEquals(result.success, false);
          assertEquals(result.error, "API returned status 500");
        } finally {
          fetchStub.restore();
        }
      },
    );

    await t.step("should return error on fetch failure", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network error")),
      );

      try {
        const result = await apiClient.checkHealth();
        assertEquals(result.success, false);
        assertEquals(result.error, "Failed to communicate with API");
      } finally {
        fetchStub.restore();
      }
    });
  });

  await t.step("setMainRole", async (t) => {
    const userId = "test-user";
    const role = "Top";

    await t.step(
      "should return success when API call is successful",
      async () => {
        const fetchStub = stub(
          globalThis,
          "fetch",
          () =>
            Promise.resolve(
              new Response(JSON.stringify({ success: true }), { status: 200 }),
            ),
        );

        try {
          const result = await apiClient.setMainRole(userId, role);
          assertEquals(result.success, true);
          assertEquals(result.error, null);
        } finally {
          fetchStub.restore();
        }
      },
    );

    await t.step(
      "should return error when API returns non-200 status",
      async () => {
        const fetchStub = stub(
          globalThis,
          "fetch",
          () =>
            Promise.resolve(
              new Response("Bad Request", {
                status: 400,
              }),
            ),
        );

        try {
          const result = await apiClient.setMainRole(userId, role);
          assertEquals(result.success, false);
          assertEquals(result.error, "API returned status 400");
        } finally {
          fetchStub.restore();
        }
      },
    );

    await t.step("should return error on fetch failure", async () => {
      const fetchStub = stub(
        globalThis,
        "fetch",
        () => Promise.reject(new Error("Network error")),
      );

      try {
        const result = await apiClient.setMainRole(userId, role);
        assertEquals(result.success, false);
        assertEquals(result.error, "Failed to communicate with API");
      } finally {
        fetchStub.restore();
      }
    });
  });
});
