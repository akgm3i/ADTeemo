import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  completeNotificationDeliverySchema,
  failNotificationDeliverySchema,
  notificationDeliveryKeySchema,
  prepareNotificationDeliverySchema,
} from "../contract/notification_delivery.ts";
import type { AppDependencies } from "../dependencies.ts";
import { DomainConflictError, RecordNotFoundError } from "../errors.ts";
import {
  ApiHttpError,
  apiValidationHook,
  repositoryApiError,
} from "../api_errors.ts";

type DeliveryActions = Pick<
  AppDependencies["dbActions"],
  | "prepareNotificationDelivery"
  | "claimNotificationDelivery"
  | "completeNotificationDelivery"
  | "failNotificationDelivery"
  | "getPendingNotificationDeliveries"
>;

function deliveryError(error: unknown): never {
  if (error instanceof DomainConflictError) throw new ApiHttpError("CONFLICT");
  if (error instanceof RecordNotFoundError) {
    throw new ApiHttpError("RESOURCE_NOT_FOUND");
  }
  throw repositoryApiError(error);
}

export function notificationDeliveriesRoutes(
  { dbActions }: { dbActions: DeliveryActions },
) {
  return new Hono()
    .get("/pending", async (c) => {
      try {
        return c.json({
          deliveries: await dbActions.getPendingNotificationDeliveries(),
        }, 200);
      } catch (error) {
        return deliveryError(error);
      }
    })
    .put(
      "/:key",
      zValidator("param", notificationDeliveryKeySchema, apiValidationHook),
      zValidator("json", prepareNotificationDeliverySchema, apiValidationHook),
      async (c) => {
        try {
          const delivery = await dbActions.prepareNotificationDelivery({
            ...c.req.valid("json"),
            ...c.req.valid("param"),
          });
          return c.json({ delivery }, 200);
        } catch (error) {
          return deliveryError(error);
        }
      },
    )
    .post(
      "/:key/claim",
      zValidator("param", notificationDeliveryKeySchema, apiValidationHook),
      async (c) => {
        try {
          const delivery = await dbActions.claimNotificationDelivery(
            c.req.valid("param").key,
          );
          return c.json({ delivery }, 200);
        } catch (error) {
          return deliveryError(error);
        }
      },
    )
    .post(
      "/:key/complete",
      zValidator("param", notificationDeliveryKeySchema, apiValidationHook),
      zValidator("json", completeNotificationDeliverySchema, apiValidationHook),
      async (c) => {
        try {
          const delivery = await dbActions.completeNotificationDelivery(
            c.req.valid("param").key,
            c.req.valid("json"),
          );
          return c.json({ delivery }, 200);
        } catch (error) {
          return deliveryError(error);
        }
      },
    )
    .post(
      "/:key/fail",
      zValidator("param", notificationDeliveryKeySchema, apiValidationHook),
      zValidator("json", failNotificationDeliverySchema, apiValidationHook),
      async (c) => {
        try {
          const delivery = await dbActions.failNotificationDelivery(
            c.req.valid("param").key,
            c.req.valid("json"),
          );
          return c.json({ delivery }, 200);
        } catch (error) {
          return deliveryError(error);
        }
      },
    );
}
