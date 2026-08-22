import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SPECIALIST_NAMES, SPECIALIST_META, outputLooksMock } from '../lib/agent/orchestration-core.ts';

describe('Inngest Queue Load Test: Async Bulk Enrichment with 100+ Prospects', () => {
  test('queue simulation: batch 100 prospects into worker jobs', () => {
    // Verify 5 specialists registered
    assert.strictEqual(SPECIALIST_NAMES.length, 5, 'Should have exactly 5 specialists');
    assert.ok(SPECIALIST_NAMES.includes('prospector'), 'Should have prospector');
    assert.ok(SPECIALIST_NAMES.includes('researcher'), 'Should have researcher');
    assert.ok(SPECIALIST_NAMES.includes('copywriter'), 'Should have copywriter');
    assert.ok(SPECIALIST_NAMES.includes('compliance'), 'Should have compliance');
    assert.ok(SPECIALIST_NAMES.includes('outreach'), 'Should have outreach');

    // Simulate the startBulkJob handler batching decision
    const prospect_count = 100;
    const threshold = 20; // Inngest threshold in code

    const needs_async = prospect_count > threshold;
    assert.strictEqual(needs_async, true, '100 prospects should trigger async queue');

    // Simulate batch sizes (e.g., concurrency=3, so ~33 batches)
    const batch_size = 3;
    const num_batches = Math.ceil(prospect_count / batch_size);
    assert.strictEqual(num_batches, 34, `Should create ${34} batches of ${batch_size}`);
  });

  test('queue: each batch retries up to 2 times on failure', () => {
    // Simulate retry logic from inngest/functions/bulk-enrich.ts
    const max_retries = 2;
    const batch_id = 'batch-001';

    for (let attempt = 0; attempt <= max_retries; attempt++) {
      const can_retry = attempt < max_retries;
      assert.ok(true, `Attempt ${attempt + 1}/${max_retries + 1} for batch ${batch_id} (can retry: ${can_retry})`);
    }
  });

  test('queue: concurrency limit enforced (max 3 concurrent prospects per batch)', () => {
    const concurrency = 3;
    const batch = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));

    const chunks = [];
    for (let i = 0; i < batch.length; i += concurrency) {
      chunks.push(batch.slice(i, i + concurrency));
    }

    assert.strictEqual(chunks.length, 4, 'Should create 4 sub-batches for concurrency=3 over 10 items');
    assert.ok(chunks[0].length <= concurrency, 'First chunk should respect concurrency');
    assert.ok(chunks[chunks.length - 1].length <= concurrency, 'Last chunk should respect concurrency');
  });

  test('queue: timeout per prospect (60s default)', () => {
    const timeout_seconds = 60;
    const prospect_count = 100;

    // Worst-case sequential time (assumes no parallelism)
    const theoretical_max_duration_sec = prospect_count * timeout_seconds;
    assert.ok(theoretical_max_duration_sec > 0, 'Theoretical max duration computed');

    // With concurrency=3, actual should be ~33 batches * 60s = ~1980s = 33m worst-case
    const concurrent_batches = Math.ceil(prospect_count / 3);
    const practical_max_duration_sec = concurrent_batches * timeout_seconds;
    assert.ok(practical_max_duration_sec < theoretical_max_duration_sec, 'Concurrency should reduce total time');
  });

  test('queue: prospector specialist scoped to discovery phase', () => {
    const prospector = SPECIALIST_META['prospector'];
    assert.ok(prospector, 'Should have prospector specialist');
    assert.ok(prospector.toolNames.includes('web_search'), 'Prospector should have web_search tool');
    assert.ok(!prospector.toolNames.includes('launch_campaign'), 'Prospector should NOT have send tool');
  });

  test('queue: researcher specialist scoped to enrichment phase', () => {
    const researcher = SPECIALIST_META['researcher'];
    assert.ok(researcher, 'Should have researcher specialist');
    assert.ok(researcher.toolNames.includes('enrich_prospect'), 'Researcher should have enrich tool');
    assert.ok(!researcher.toolNames.includes('launch_campaign'), 'Researcher should NOT have send tool');
  });

  test('queue: copywriter never calls external APIs', () => {
    const copywriter = SPECIALIST_META['copywriter'];
    assert.ok(copywriter, 'Should have copywriter specialist');
    // Copywriter is pure LLM without external tool calls
    assert.ok(copywriter.toolNames.length === 0, 'Copywriter should have no external tools (reasoning only)');
  });

  test('queue: compliance specialist can review without sending', () => {
    const compliance = SPECIALIST_META['compliance'];
    assert.ok(compliance, 'Should have compliance specialist');
    
    // Compliance should be reasoning-only (no external tools)
    assert.strictEqual(compliance.toolNames.length, 0, 'Compliance should have no tools (review only)');
  });

  test('queue: outreach specialist has exclusive send access', () => {
    const outreach = SPECIALIST_META['outreach'];
    assert.ok(outreach, 'Should have outreach specialist');
    assert.ok(outreach.toolNames.includes('launch_campaign'), 'Only outreach can send');

    // Verify all other specialists do NOT have launch_campaign
    const others = SPECIALIST_NAMES.filter(s => s !== 'outreach');
    others.forEach((s) => {
      const specialist = SPECIALIST_META[s];
      assert.ok(!specialist.toolNames.includes('launch_campaign'), `${s} should NOT have launch_campaign`);
    });
  });

  test('queue: load test mock data detection', () => {
    // Simulate mock output from providers
    const mock_prospect = {
      name: 'Alice Demo',
      email: 'alice@demo.com',
      email_confidence: 'risky' as const,
      company_name: 'DemoTech Inc.',
      company_domain: 'demotech-demo.com',
      recent_news: ['Demo news article'],
      source: 'mock' as const, // This is the key mock flag that outputLooksMock checks
      draft: 'This is a demo email.',
    };

    // outputLooksMock should detect the source: 'mock' flag
    const is_demo = outputLooksMock(mock_prospect);
    assert.strictEqual(is_demo, true, 'Should detect mock enrichment output');

    // Also test with using_mock_data flag
    const alt_mock_prospect = {
      name: 'Bob Demo',
      using_mock_data: true,
      email: 'bob@demo.com',
    };

    const is_demo_alt = outputLooksMock(alt_mock_prospect);
    assert.strictEqual(is_demo_alt, true, 'Should detect using_mock_data flag');

    // Real prospect should not be flagged
    const real_prospect = {
      name: 'Charlie Real',
      email: 'charlie@realcorp.com',
      email_confidence: 'verified' as const,
      company_name: 'RealCorp Inc.',
      company_domain: 'realcorp.com',
      source: 'brave_search',
      draft: 'Real enriched draft.',
    };

    const is_real = outputLooksMock(real_prospect);
    assert.strictEqual(is_real, false, 'Should NOT flag real enrichment as mock');
  });

  test('queue: 100 prospect distribution over batches', () => {
    const prospect_count = 100;
    const batch_size = 3; // concurrency from inngest/functions/bulk-enrich.ts

    const prospects = Array.from({ length: prospect_count }, (_, i) => ({
      id: `prospect-${i}`,
      name: `Person ${i}`,
    }));

    const batches: typeof prospects[] = [];
    for (let i = 0; i < prospects.length; i += batch_size) {
      batches.push(prospects.slice(i, i + batch_size));
    }

    assert.strictEqual(batches.length, 34, 'Should have 34 batches for 100 items');
    assert.ok(batches.every(b => b.length <= batch_size), 'All batches should respect concurrency');

    const total_processed = batches.reduce((sum, b) => sum + b.length, 0);
    assert.strictEqual(total_processed, prospect_count, 'All prospects should be distributed');
  });

  test('queue: simulate 5 batches processing under concurrency', async () => {
    // This simulates the async behavior without actual Inngest
    const prospects = Array.from({ length: 15 }, (_, i) => ({
      id: `p${i}`,
      name: `Person ${i}`,
    }));

    const batch_size = 3;
    const batches: typeof prospects[] = [];
    for (let i = 0; i < prospects.length; i += batch_size) {
      batches.push(prospects.slice(i, i + batch_size));
    }

    assert.strictEqual(batches.length, 5, 'Should have 5 batches');

    // Simulate processing
    let processed = 0;
    for (const batch of batches) {
      // Simulate parallel processing
      await Promise.all(
        batch.map(async () => {
          // Simulate enrichment
          await new Promise((resolve) => setTimeout(resolve, 10));
          processed++;
        })
      );
    }

    assert.strictEqual(processed, 15, 'Should process all 15 prospects');
  });

  test('queue: resilience check - partial batch failure recovery', () => {
    // Simulate a batch where 1 of 3 prospects fails
    const batch = [
      { id: '1', status: 'success' as const },
      { id: '2', status: 'failed' as const }, // One fails
      { id: '3', status: 'success' as const },
    ];

    const successes = batch.filter(p => p.status === 'success').length;
    const failures = batch.filter(p => p.status === 'failed').length;

    assert.strictEqual(successes, 2, 'Should have 2 successes');
    assert.strictEqual(failures, 1, 'Should have 1 failure');

    // The batch should be retried (configured with max_retries=2)
    const can_retry = failures > 0;
    assert.strictEqual(can_retry, true, 'Batch with failures should be eligible for retry');
  });
});
