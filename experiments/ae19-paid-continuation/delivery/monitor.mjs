/**
 * In-process finite schedule. Nothing here arms a timer, cron, or daemon.
 * The host calls note/due. Tenant poll and ack are the product delivery.
 */
export function createFiniteMonitor(service) {
  return {
    schedulesCreated: 0,
    note(sourceId, digest) {
      return service.noteSource({ sourceId, digest });
    },
    due() {
      return service.dueOccurrences();
    },
    close(sourceId) {
      return service.closeOccurrence({ sourceId });
    },
    poll(tenantId) {
      return service.pollDeliveries(tenantId);
    },
    ack(tenantId, deliveryId) {
      return service.ackDelivery({ tenantId, deliveryId });
    },
  };
}
