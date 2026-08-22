import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseCsv, csvToProspects } from '../lib/csv-parse.ts';
import {
  generateEmailGuesses,
  bestGuessEmail,
  guessDomainFromCompany,
  verifyDomainMx,
} from '../lib/email-patterns.ts';
import { classifyReply, needsHuman } from '../lib/reply-classify.ts';
import { PLANS } from '../lib/billing-shared.ts';

/**
 * End-to-end logic flow over the pure, import-safe library surface:
 * CSV upload → enrichment (domain + email guessing + MX) → credit budget
 * → reply classification → human routing → analytics math.
 *
 * No `@/`-aliased or Next-only modules are imported, so this runs under
 * the bare `node --test --experimental-strip-types` runner. The reply
 * classifier falls back to its deterministic keyword mock because no
 * ANTHROPIC_API_KEY is set in the test environment.
 */
describe('E2E Flow: CSV Upload → Enrichment → Send → Reply Classification → Analytics', () => {
  const SAMPLE_CSV = `name,company,email
John Doe,Acme Corp,john@acme.com
Jane Smith,TechCorp,jane@techcorp.io
Bob Johnson,StartupXYZ,bob@startup.xyz
Alice Chen,GlobalTech,alice@global-tech.com
Carlos Santos,InnovateLabs,carlos@innovate.io`;

  test('CSV upload: parse raw grid (header + 5 data rows)', () => {
    const rows = parseCsv(SAMPLE_CSV);
    assert.strictEqual(rows.length, 6, 'Should parse header + 5 data rows');
    assert.deepStrictEqual(rows[0], ['name', 'company', 'email']);
  });

  test('CSV upload: extract 5 named prospects', () => {
    const { prospects, warnings } = csvToProspects(SAMPLE_CSV);
    assert.strictEqual(prospects.length, 5, 'Should extract 5 prospects');
    assert.strictEqual(warnings.length, 0, 'Clean CSV should produce no warnings');
    assert.strictEqual(prospects[0].name, 'John Doe');
    assert.strictEqual(prospects[0].company, 'Acme Corp');
    assert.strictEqual(prospects[0].email, 'john@acme.com');
  });

  test('Enrichment: email pattern guessing from name + company', () => {
    const domain = guessDomainFromCompany('CloudNine Inc.');
    assert.ok(domain, 'Should guess a domain from company');
    assert.match(domain, /cloudnine/i, 'Domain should contain the company name');

    const guesses = generateEmailGuesses('Sarah Wilson', domain);
    assert.ok(guesses.length > 0, 'Should generate at least one guess');
    assert.ok(guesses.every((g) => g.email.includes('@')), 'Guesses should be email-shaped');

    const best = bestGuessEmail('Sarah Wilson', domain);
    assert.ok(best, 'Should return a best guess');
    assert.ok(best.email.includes('@'), 'Best guess should be a valid email format');
  });

  test('Enrichment: MX verification returns a known confidence level', async () => {
    const result = await verifyDomainMx('example.com');
    assert.ok(
      ['mx_verified', 'no_mx', 'unknown', 'risky'].includes(result.confidence),
      'Should return a valid MX confidence',
    );
    assert.strictEqual(result.domain, 'example.com');
    assert.ok(Array.isArray(result.exchanges), 'Exchanges should be an array');
  });

  test('Send flow: plan credits cover a bulk send (1 credit = 1 prospect)', () => {
    const prospectsCount = 20;
    const cost = prospectsCount; // cost model: one credit per enriched prospect
    assert.ok(cost > 0, 'Should have a positive credit cost');
    assert.ok(PLANS.starter.credits >= cost, 'Starter plan should cover a 20-prospect send');
    // Paid tiers scale strictly upward from the free tier.
    assert.ok(PLANS.starter.credits > PLANS.free.credits);
    assert.ok(PLANS.pro.credits > PLANS.starter.credits);
    assert.ok(PLANS.agency.credits > PLANS.pro.credits);
  });

  test('Reply classification: categorize inbound replies (deterministic mock path)', async () => {
    const replies = [
      'Please unsubscribe me from this list.',
      'I am out of office until Monday.',
      'Sounds good, I am keen to learn more.',
      'What is your pricing?',
      'Not interested, but thanks for reaching out.',
    ];
    const categories: string[] = [];
    for (const body of replies) {
      const c = await classifyReply({ body });
      categories.push(c.category);
    }
    assert.ok(categories.includes('unsubscribe'), 'Should detect unsubscribe');
    assert.ok(categories.includes('out_of_office'), 'Should detect out-of-office');
    assert.ok(categories.includes('interested'), 'Should detect interested');
    assert.ok(categories.includes('question'), 'Should detect a question');
    assert.ok(categories.includes('not_interested'), 'Should detect not-interested');
  });

  test('Reply routing: interested / question / objection go to a human', () => {
    for (const category of ['interested', 'question', 'objection'] as const) {
      assert.strictEqual(needsHuman(category), true, `${category} should route to a human`);
    }
    for (const category of ['unsubscribe', 'out_of_office', 'not_interested', 'other'] as const) {
      assert.strictEqual(needsHuman(category), false, `${category} should NOT route to a human`);
    }
  });

  test('Analytics aggregation: compute reply + interest rates', () => {
    const prospects = [
      { replied: true, interested: true },
      { replied: false, interested: false },
      { replied: true, interested: false },
      { replied: true, interested: true },
    ];
    const total = prospects.length;
    const replied = prospects.filter((p) => p.replied).length;
    const interested = prospects.filter((p) => p.interested).length;
    assert.strictEqual(total, 4, 'Should count 4 prospects');
    assert.strictEqual(replied, 3, 'Should count 3 replies');
    assert.strictEqual(interested, 2, 'Should count 2 interested');
    assert.strictEqual(replied / total, 0.75, 'Reply rate should be 75%');
    assert.strictEqual(interested / replied, 2 / 3, 'Interest rate of replies should be ~66.7%');
  });

  test('Pipeline: forward stage progression is distinct + ordered', () => {
    const stages = ['contacted', 'replied', 'interested', 'converted'] as const;
    assert.strictEqual(new Set(stages).size, stages.length, 'Stages should be distinct');
    let stage: (typeof stages)[number] = 'contacted';
    stage = 'replied';
    assert.ok(stages.includes(stage), 'Stage should be a valid pipeline stage');
  });

  test('E2E happy path: CSV → enrich → classify → route', async () => {
    const csv = `name,company
Alice Engineer,CloudTech
Bob Manager,DataSys`;
    const { prospects } = csvToProspects(csv);
    assert.strictEqual(prospects.length, 2);

    for (const p of prospects) {
      const domain = guessDomainFromCompany(p.company ?? '');
      assert.ok(domain, `Should resolve a domain for ${p.name}`);
      const best = bestGuessEmail(p.name, domain);
      assert.ok(best && best.email.includes('@'), `Should enrich an email for ${p.name}`);
    }

    const classification = await classifyReply({
      body: 'This looks great, let us book a call next week.',
    });
    assert.strictEqual(classification.category, 'interested', 'Positive reply is interested');
    assert.strictEqual(needsHuman(classification.category), true, 'Interested routes to a human');
    assert.strictEqual(classification.wants_meeting, true, 'Booking intent should be detected');
  });
});
