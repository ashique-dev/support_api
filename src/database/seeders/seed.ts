/**
 * Database Seeder
 *
 * Generates realistic test data:
 *   - 5 Tenants
 *   - 3 Users per Tenant (1 TenantAdmin + 2 Agents)
 *   - 1 SuperAdmin
 *   - 200,000 Conversations (distributed across tenants)
 *   - 1,000,000 Messages (distributed across conversations)
 *
 * Run: npm run seed
 *
 * Strategy: Uses bulk INSERT with chunking to avoid OOM and stay within
 * PostgreSQL's parameter limit (65535 params per query).
 */

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config();

// ─── Constants ───────────────────────────────────────────────────────────────
const TENANT_COUNT = 5;
const USERS_PER_TENANT = 3; // 1 TenantAdmin + 2 Agents
const TOTAL_CONVERSATIONS = 200_000;
const TOTAL_MESSAGES = 1_000_000;
const CHUNK_SIZE = 1_000; // Rows per bulk INSERT

// ─── Sample Data ─────────────────────────────────────────────────────────────
const TENANT_NAMES = ['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Ltd', 'Hooli'];
const TENANT_SLUGS = ['acme-corp', 'globex-inc', 'initech', 'umbrella-ltd', 'hooli'];

const SUBJECTS = [
  'Cannot login to my account',
  'Payment not processed',
  'Product not delivered',
  'Refund request',
  'Technical issue with API',
  'Billing discrepancy',
  'Feature request',
  'Account suspended',
  'Data export request',
  'Integration help needed',
  'Password reset not working',
  'Slow performance issue',
];

const STATUSES = ['open', 'pending', 'resolved', 'closed'];
const STATUS_WEIGHTS = [0.35, 0.25, 0.30, 0.10]; // probability distribution
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack'];
const LAST_NAMES  = ['Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davis', 'Wilson', 'Moore'];
const DOMAINS     = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'example.com'];

const MESSAGE_BODIES = [
  'I have been experiencing this issue for a few days now.',
  'Can you please provide more details about this problem?',
  'I have checked my account and everything seems correct.',
  'Thank you for reaching out. We are looking into this.',
  'We have identified the issue and are working on a fix.',
  'Could you please provide your account ID for faster resolution?',
  'The issue has been escalated to our technical team.',
  'We apologize for the inconvenience caused.',
  'Your issue has been resolved. Please let us know if you need further help.',
  'I tried the steps you suggested but the problem persists.',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedChoice(items: string[], weights: number[]): string {
  const rand = Math.random();
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (rand < cumulative) return items[i];
  }
  return items[items.length - 1];
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function randomEmail(firstName: string, lastName: string): string {
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 999)}@${randomChoice(DOMAINS)}`;
}

async function chunkInsert(
  dataSource: DataSource,
  table: string,
  columns: string[],
  rows: any[][],
) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk
      .map(
        (_, rowIdx) =>
          `(${columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(', ')})`,
      )
      .join(', ');
    const values = chunk.flat();
    await dataSource.query(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders}`,
      values,
    );

    const progress = Math.min(i + CHUNK_SIZE, rows.length);
    process.stdout.write(`\r  → ${table}: ${progress}/${rows.length} rows`);
  }
  console.log();
}

// ─── Main Seeder ─────────────────────────────────────────────────────────────
async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USER || 'support_user',
    password: process.env.DB_PASSWORD || 'support_pass',
    database: process.env.DB_NAME || 'support_db',
    entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
    synchronize: false,
  });

  await dataSource.initialize();
  console.log('\n🌱 Starting database seeder...\n');

  const startTime = Date.now();
  const hashedPassword = await bcrypt.hash('Password123!', 10);

  try {
    // ── 1. Tenants ──────────────────────────────────────────────────────────
    console.log(`[1/5] Seeding ${TENANT_COUNT} tenants...`);
    const tenantRows = TENANT_NAMES.map((name, i) => [
      TENANT_SLUGS[i], // Use slug as UUID-like seed (we'll get real IDs back)
      name,
      TENANT_SLUGS[i],
      true,
    ]);

    const insertedTenants = await Promise.all(
      TENANT_NAMES.map((name, i) =>
        dataSource.query(
          `INSERT INTO tenants (name, slug, is_active) VALUES ($1, $2, $3)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [name, TENANT_SLUGS[i], true],
        ),
      ),
    );
    const tenantIds = insertedTenants.map((r) => r[0].id);
    console.log(`  ✓ ${tenantIds.length} tenants created`);

    // ── 2. SuperAdmin ────────────────────────────────────────────────────────
    console.log('\n[2/5] Seeding SuperAdmin...');
    await dataSource.query(
      `INSERT INTO users (first_name, last_name, email, password, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      ['Super', 'Admin', 'superadmin@platform.com', hashedPassword, 'SuperAdmin'],
    );
    console.log('  ✓ superadmin@platform.com / Password123!');

    // ── 3. Users per Tenant ──────────────────────────────────────────────────
    console.log('\n[3/5] Seeding users per tenant...');
    const agentIdsByTenant: Record<string, string[]> = {};

    for (const tenantId of tenantIds) {
      const tenantIdx = tenantIds.indexOf(tenantId);
      const slug = TENANT_SLUGS[tenantIdx];

      // 1 TenantAdmin
      const admin = await dataSource.query(
        `INSERT INTO users (tenant_id, first_name, last_name, email, password, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [tenantId, 'Admin', slug, `admin@${slug}.com`, hashedPassword, 'TenantAdmin'],
      );

      // 2 Agents
      const agents: string[] = [];
      for (let a = 1; a <= 2; a++) {
        const fn = randomChoice(FIRST_NAMES);
        const ln = randomChoice(LAST_NAMES);
        const result = await dataSource.query(
          `INSERT INTO users (tenant_id, first_name, last_name, email, password, role)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [tenantId, fn, ln, `agent${a}@${slug}.com`, hashedPassword, 'Agent'],
        );
        if (result[0]) agents.push(result[0].id);
      }
      agentIdsByTenant[tenantId] = agents;
    }
    console.log(`  ✓ ${TENANT_COUNT * 3} users created`);

    // ── 4. Conversations ─────────────────────────────────────────────────────
    console.log(`\n[4/5] Seeding ${TOTAL_CONVERSATIONS.toLocaleString()} conversations...`);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const conversationRows: any[][] = [];
    const conversationIds: { id: string; tenantId: string; status: string }[] = [];

    for (let i = 0; i < TOTAL_CONVERSATIONS; i++) {
      const tenantId = tenantIds[i % TENANT_COUNT]; // Round-robin across tenants
      const agents = agentIdsByTenant[tenantId] || [];
      const status = weightedChoice(STATUSES, STATUS_WEIGHTS);
      const priority = randomChoice(PRIORITIES);
      const subject = randomChoice(SUBJECTS);
      const firstName = randomChoice(FIRST_NAMES);
      const lastName = randomChoice(LAST_NAMES);
      const customerEmail = randomEmail(firstName, lastName);
      const createdAt = randomDate(ninetyDaysAgo, now);

      const assignedAgentId =
        status !== 'open' && agents.length > 0
          ? randomChoice(agents)
          : null;

      const resolvedAt =
        status === 'resolved' || status === 'closed'
          ? new Date(createdAt.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000)
          : null;

      conversationRows.push([
        tenantId,
        subject,
        `Customer reported: ${subject.toLowerCase()}. Please investigate.`,
        status,
        priority,
        assignedAgentId,
        customerEmail,
        `${firstName} ${lastName}`,
        resolvedAt,
        createdAt,
        createdAt,
      ]);
    }

    // Bulk insert in chunks; collect IDs
    for (let i = 0; i < conversationRows.length; i += CHUNK_SIZE) {
      const chunk = conversationRows.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk
        .map(
          (_, rowIdx) =>
            `(${Array.from({ length: 11 }, (_, c) => `$${rowIdx * 11 + c + 1}`).join(', ')})`,
        )
        .join(', ');

      const result = await dataSource.query(
        `INSERT INTO conversations
           (tenant_id, subject, description, status, priority, assigned_agent_id,
            customer_email, customer_name, resolved_at, created_at, updated_at)
         VALUES ${placeholders}
         RETURNING id, tenant_id, status`,
        chunk.flat(),
      );

      conversationIds.push(...result);
      const progress = Math.min(i + CHUNK_SIZE, TOTAL_CONVERSATIONS);
      process.stdout.write(`\r  → conversations: ${progress}/${TOTAL_CONVERSATIONS} rows`);
    }
    console.log(`\n  ✓ ${conversationIds.length.toLocaleString()} conversations created`);

    // ── 5. Messages ──────────────────────────────────────────────────────────
    console.log(`\n[5/5] Seeding ${TOTAL_MESSAGES.toLocaleString()} messages...`);

    const messageRows: any[][] = [];
    const senderTypes = ['customer', 'agent', 'system'];

    for (let i = 0; i < TOTAL_MESSAGES; i++) {
      const conv = conversationIds[i % conversationIds.length];
      const senderType = randomChoice(senderTypes);
      const body = randomChoice(MESSAGE_BODIES);
      const createdAt = randomDate(thirtyDaysAgo, now);

      messageRows.push([conv.id, senderType, body, false, createdAt]);
    }

    for (let i = 0; i < messageRows.length; i += CHUNK_SIZE) {
      const chunk = messageRows.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk
        .map(
          (_, rowIdx) =>
            `(${Array.from({ length: 5 }, (_, c) => `$${rowIdx * 5 + c + 1}`).join(', ')})`,
        )
        .join(', ');

      await dataSource.query(
        `INSERT INTO messages (conversation_id, sender_type, body, is_internal, created_at)
         VALUES ${placeholders}`,
        chunk.flat(),
      );

      const progress = Math.min(i + CHUNK_SIZE, TOTAL_MESSAGES);
      process.stdout.write(`\r  → messages: ${progress}/${TOTAL_MESSAGES} rows`);
    }
    console.log(`\n  ✓ ${TOTAL_MESSAGES.toLocaleString()} messages created`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Seeding complete in ${elapsed}s\n`);

    console.log('─'.repeat(50));
    console.log('Test Credentials:');
    console.log('─'.repeat(50));
    console.log('SuperAdmin:  superadmin@platform.com / Password123!');
    TENANT_SLUGS.forEach((slug) => {
      console.log(`${slug} admin:  admin@${slug}.com / Password123!`);
      console.log(`${slug} agent1: agent1@${slug}.com / Password123!`);
    });
    console.log('─'.repeat(50));
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((err) => {
  console.error('\n❌ Seeder failed:', err.message);
  process.exit(1);
});
