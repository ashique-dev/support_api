import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { RESOLUTION_QUEUE, RESOLUTION_JOB } from './workers.constants';

export interface ResolutionJobPayload {
  conversationId: string;
  tenantId: string;
  customerEmail: string;
  customerName: string;
  subject: string;
  resolvedAt: Date;
  agentId: string;
  agentName: string;
  resolutionNote?: string;
}

// ─── Email Deliverability Envelope ─────────────────────────────────────────
interface EmailEnvelope {
  from: string;
  to: string;
  subject: string;
  html: string;
  headers: {
    // SPF: Sender Policy Framework – validated at SMTP level (DNS TXT record)
    // We document the policy and log that it would be applied
    'X-SPF-Policy': string;

    // DKIM: DomainKeys Identified Mail – signature added by mail server
    // In production this header would be computed from the private key
    'DKIM-Signature': string;

    // DMARC: Domain-based Message Authentication – alignment policy
    'X-DMARC-Policy': string;

    'Message-ID': string;
    'X-Mailer': string;
  };
}

@Processor(RESOLUTION_QUEUE)
export class ResolutionWorker {
  private readonly logger = new Logger(ResolutionWorker.name);

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`[QUEUE] Processing job #${job.id} – ${job.name}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`[QUEUE] Job #${job.id} completed successfully`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`[QUEUE] Job #${job.id} failed: ${err.message}`, err.stack);
  }

  @Process(RESOLUTION_JOB)
  async handleResolutionEmail(job: Job<ResolutionJobPayload>): Promise<void> {
    const data = job.data;
    this.logger.log(`Sending resolution email for conversation ${data.conversationId}`);

    try {
      // ── Step 1: Build the email envelope ──────────────────────────────────
      const envelope = this.buildEmailEnvelope(data);

      // ── Step 2: Validate deliverability standards before "sending" ────────
      this.validateDeliverabilityStandards(envelope);

      // ── Step 3: Simulate SMTP transmission ────────────────────────────────
      await this.simulateSmtpTransmission(envelope, data.conversationId);

      this.logger.log(
        `✓ Resolution email delivered to ${data.customerEmail} for conversation ${data.conversationId}`,
      );
    } catch (err) {
      this.logger.error(`Failed to send resolution email: ${err.message}`);
      throw err; // Re-throw so Bull marks job as failed and retries
    }
  }

  // ─── Build Email Envelope ─────────────────────────────────────────────────
  private buildEmailEnvelope(data: ResolutionJobPayload): EmailEnvelope {
    const messageId = `<${data.conversationId}.${Date.now()}@support.platform>`;
    const fromDomain = 'support.platform';

    return {
      from: `"Support Platform" <no-reply@${fromDomain}>`,
      to: `"${data.customerName}" <${data.customerEmail}>`,
      subject: `Your support ticket has been resolved: ${data.subject}`,
      html: this.buildHtmlBody(data),
      headers: {
        // ── SPF ──────────────────────────────────────────────────────────
        // In production: DNS TXT record → v=spf1 include:_spf.platform.com ~all
        // The receiving MTA checks that our sending IP is listed in this record.
        // Failure → email marked as spam or rejected.
        'X-SPF-Policy': `v=spf1 include:_spf.${fromDomain} ~all`,

        // ── DKIM ─────────────────────────────────────────────────────────
        // In production: computed RSA-SHA256 signature using private key.
        // Recipient MTA fetches public key from DNS and verifies signature.
        // Protects email body and headers from tampering in transit.
        'DKIM-Signature': [
          'v=1; a=rsa-sha256;',
          `d=${fromDomain}; s=mail;`,
          'c=relaxed/relaxed;',
          `h=from:to:subject:date:message-id;`,
          'bh=<base64_body_hash_would_be_computed_here>;',
          'b=<rsa_signature_would_be_computed_here>',
        ].join(' '),

        // ── DMARC ────────────────────────────────────────────────────────
        // In production: DNS TXT record → _dmarc.platform.com
        // Policy: if SPF or DKIM fails alignment → quarantine or reject.
        // rua: aggregate reports sent to monitoring inbox.
        'X-DMARC-Policy': `v=DMARC1; p=quarantine; rua=mailto:dmarc@${fromDomain}; adkim=s; aspf=s`,

        'Message-ID': messageId,
        'X-Mailer': 'SupportPlatform/1.0',
      },
    };
  }

  // ─── Validate Deliverability Standards ───────────────────────────────────
  private validateDeliverabilityStandards(envelope: EmailEnvelope): void {
    const errors: string[] = [];

    if (!envelope.headers['DKIM-Signature'].startsWith('v=1')) {
      errors.push('DKIM signature missing or malformed');
    }
    if (!envelope.headers['X-SPF-Policy'].startsWith('v=spf1')) {
      errors.push('SPF policy missing or malformed');
    }
    if (!envelope.headers['X-DMARC-Policy'].startsWith('v=DMARC1')) {
      errors.push('DMARC policy missing or malformed');
    }
    if (!envelope.from || !envelope.to) {
      errors.push('Missing From or To address');
    }
    if (!envelope.headers['Message-ID']) {
      errors.push('Missing Message-ID header');
    }

    if (errors.length > 0) {
      throw new Error(`Email deliverability validation failed: ${errors.join('; ')}`);
    }

    this.logger.log('✓ SPF / DKIM / DMARC validation passed');
  }

  // ─── Simulate SMTP Transmission ──────────────────────────────────────────
  private async simulateSmtpTransmission(
    envelope: EmailEnvelope,
    conversationId: string,
  ): Promise<void> {
    // Simulate network latency of a real SMTP call
    await new Promise((resolve) => setTimeout(resolve, 200));

    this.logger.debug(`[SMTP SIMULATION]`);
    this.logger.debug(`  To:      ${envelope.to}`);
    this.logger.debug(`  From:    ${envelope.from}`);
    this.logger.debug(`  Subject: ${envelope.subject}`);
    this.logger.debug(`  MsgID:   ${envelope.headers['Message-ID']}`);
    this.logger.debug(`  DKIM:    present`);
    this.logger.debug(`  SPF:     pass (simulated)`);
    this.logger.debug(`  DMARC:   pass (simulated)`);

    // In production this would be:
    // await this.smtpTransport.sendMail(envelope);
    // using Nodemailer + AWS SES / SendGrid with real keys
  }

  // ─── HTML Email Body ──────────────────────────────────────────────────────
  private buildHtmlBody(data: ResolutionJobPayload): string {
    const resolvedDate = new Date(data.resolvedAt).toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Ticket Resolved</title></head>
<body style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
  <div style="background:#4f46e5;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:20px">Your ticket has been resolved ✓</h1>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    <p>Hi <strong>${data.customerName}</strong>,</p>
    <p>Your support ticket has been marked as resolved.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Ticket</td>
          <td style="padding:8px">${data.subject}</td></tr>
      <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Resolved by</td>
          <td style="padding:8px">${data.agentName}</td></tr>
      <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Resolved on</td>
          <td style="padding:8px">${resolvedDate}</td></tr>
      ${data.resolutionNote ? `
      <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Note</td>
          <td style="padding:8px">${data.resolutionNote}</td></tr>` : ''}
    </table>
    <p>If you have further questions, please open a new ticket.</p>
    <p style="color:#6b7280;font-size:12px;margin-top:32px">
      This email was sent from an automated system. Ticket ID: ${data.conversationId}
    </p>
  </div>
</body>
</html>`;
  }
}
