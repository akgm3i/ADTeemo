import {
  type CompleteNotificationDelivery,
  type FailNotificationDelivery,
  type PrepareNotificationDelivery,
  responseContracts,
} from "@adteemo/api/contract";
import { type ApiRpcClient, requestResult } from "./transport.ts";

export function createNotificationDeliveriesApiClient(
  { rpcClient }: { rpcClient: ApiRpcClient },
) {
  const resource = rpcClient["notification-deliveries"];
  return {
    prepareNotificationDelivery: (
      { key, ...json }: PrepareNotificationDelivery,
    ) =>
      requestResult(
        responseContracts.prepareNotificationDelivery,
        () => resource[":key"].$put({ param: { key }, json }),
      ),
    claimNotificationDelivery: (key: string) =>
      requestResult(
        responseContracts.claimNotificationDelivery,
        () => resource[":key"].claim.$post({ param: { key } }),
      ),
    completeNotificationDelivery: (
      key: string,
      json: CompleteNotificationDelivery,
    ) =>
      requestResult(
        responseContracts.completeNotificationDelivery,
        () => resource[":key"].complete.$post({ param: { key }, json }),
      ),
    failNotificationDelivery: (key: string, json: FailNotificationDelivery) =>
      requestResult(
        responseContracts.failNotificationDelivery,
        () => resource[":key"].fail.$post({ param: { key }, json }),
      ),
    getPendingNotificationDeliveries: () =>
      requestResult(
        responseContracts.pendingNotificationDeliveries,
        () => resource.pending.$get(),
      ),
  };
}
export type NotificationDeliveriesApiClient = ReturnType<
  typeof createNotificationDeliveriesApiClient
>;
