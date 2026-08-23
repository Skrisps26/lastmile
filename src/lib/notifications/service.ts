import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import type { OrderStatus } from '@/lib/orders/status-machine';

type NotificationResult = {
  success: boolean;
  provider: 'RESEND' | 'MOCK_LOGGER';
  notificationId?: string;
  error?: string;
};

function statusLabel(status: OrderStatus): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildStatusEmail(order: {
  trackingNumber: string;
  customer: { name: string; email: string };
  recipientCity: string;
}, status: OrderStatus, reason?: string | null) {
  const label = statusLabel(status);
  const reasonLine = reason ? `<p><strong>Delivery note:</strong> ${reason}</p>` : '';
  const subject = `Shipment ${order.trackingNumber} is ${label}`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
    <h2>Your LastMile shipment has been updated</h2>
    <p>Hi ${order.customer.name},</p>
    <p>Your shipment <strong>${order.trackingNumber}</strong> is now <strong>${label}</strong>.</p>
    <p>Destination: ${order.recipientCity}</p>${reasonLine}
    <p>You can use the tracking number in the LastMile tracking page to view the full timeline.</p>
    <p>— LastMile Logistics</p>
  </body></html>`;
  return { subject, html };
}

/**
 * Central status-change notification integration.
 * Notification failures are audited but never roll back a committed order event.
 */
export async function notifyOrderStatusChange(
  orderId: string,
  status: OrderStatus,
  reason?: string | null
): Promise<NotificationResult> {
  let order;
  try {
    order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        trackingNumber: true,
        recipientCity: true,
        customer: { select: { name: true, email: true } },
      },
    });
  } catch (error: any) {
    return {
      success: false,
      provider: 'MOCK_LOGGER',
      error: error?.message || 'Unable to load order for notification',
    };
  }

  if (!order) {
    return { success: false, provider: 'MOCK_LOGGER', error: `Order '${orderId}' not found` };
  }

  const event = `STATUS_${status}`;
  const { subject, html } = buildStatusEmail(order, status, reason);
  const configuredProvider = (process.env.NOTIFICATION_PROVIDER || 'mock').toLowerCase();
  const useResend = configuredProvider === 'resend';
  const provider = useResend ? 'RESEND' : 'MOCK_LOGGER';

  try {
    if (useResend) {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.NOTIFICATION_FROM_EMAIL;
      if (!apiKey || !from) {
        throw new Error('RESEND_API_KEY and NOTIFICATION_FROM_EMAIL are required when NOTIFICATION_PROVIDER=resend');
      }

      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from,
        to: order.customer.email,
        subject,
        html,
      });

      if (result.error) throw new Error(result.error.message);
    }

    const log = await prisma.notificationLog.create({
      data: {
        orderId,
        recipientEmail: order.customer.email,
        event,
        subject,
        provider,
        status: 'SENT',
        payload: JSON.stringify({ status, trackingNumber: order.trackingNumber }),
      },
    });

    return { success: true, provider, notificationId: log.id };
  } catch (error: any) {
    const message = error?.message || 'Notification delivery failed';
    try {
      const log = await prisma.notificationLog.create({
        data: {
          orderId,
          recipientEmail: order.customer.email,
          event,
          subject,
          provider,
          status: 'FAILED',
          errorMessage: message,
          payload: JSON.stringify({ status, trackingNumber: order.trackingNumber }),
        },
      });
      return { success: false, provider, notificationId: log.id, error: message };
    } catch {
      return { success: false, provider, error: message };
    }
  }
}
