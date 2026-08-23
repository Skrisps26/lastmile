import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest | Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const recipientEmail = body.email || 'delivered@resend.dev';
    const recipientName = body.name || 'Valued Customer';
    
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'RESEND_API_KEY environment variable is not configured' },
        { status: 500 }
      );
    }
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'onboarding@resend.dev';

    const resend = new Resend(apiKey);
    const trackingNumber = 'LMD-' + Date.now().toString().slice(-6);

    const subject = `Shipment ${trackingNumber} is Out for Delivery!`;
    const html = `
      <!doctype html>
      <html>
        <body style="font-family: Arial, sans-serif; background-color: #f7f8fc; padding: 24px; color: #172033;">
          <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e9edf4;">
            <div style="display: flex; align-items: center; margin-bottom: 24px;">
              <span style="font-size: 20px; font-weight: bold; color: #f2643b;">lastmile.</span>
            </div>
            <h2 style="font-size: 22px; margin-bottom: 12px; color: #17241d;">Your delivery is on the way!</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #4f5c73;">Hi ${recipientName},</p>
            <p style="font-size: 14px; line-height: 1.6; color: #4f5c73;">
              Shipment <strong>${trackingNumber}</strong> has been assigned to a delivery partner and is currently <strong>Out for Delivery</strong>.
            </p>
            <div style="background: #fff8f5; border-left: 4px solid #f2643b; padding: 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-size: 13px; color: #6b4030;"><strong>Estimated Arrival:</strong> Today within 2 hours</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #6b4030;"><strong>Destination:</strong> Koramangala 4th Block, Bengaluru</p>
            </div>
            <p style="font-size: 13px; line-height: 1.6; color: #72809a; margin-top: 24px;">
              Thank you for trusting LastMile Logistics.
            </p>
          </div>
        </body>
      </html>
    `;

    const resendResult = await resend.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject,
      html,
    });

    if (resendResult.error) {
      return NextResponse.json(
        { success: false, error: resendResult.error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Test email sent successfully to ${recipientEmail}`,
      resendId: resendResult.data?.id,
      trackingNumber,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
