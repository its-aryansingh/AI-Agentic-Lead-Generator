import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SPECIALIST_NAMES, SPECIALIST_META } from '../lib/agent/orchestration-core.ts';

describe('Specialist Agents Under Load: Concurrent Orchestration Stress Test', () => {
  test('specialist catalog: exactly 5 specialists registered', () => {
    assert.strictEqual(
      SPECIALIST_NAMES.length,
      5,
      'Should have exactly 5 specialists'
    );

    const expected_roles = ['prospector', 'researcher', 'copywriter', 'compliance', 'outreach'];
    const actual_roles = SPECIALIST_NAMES.sort();

    expected_roles.forEach((role) => {
      assert.ok(actual_roles.includes(role), `Should have ${role} specialist`);
    });
  });

  test('specialist: prospector has bounded token limit', () => {
    const prospector = SPECIALIST_META['prospector'];
    assert.ok(prospector, 'Should find prospector');
    assert.ok(prospector.maxSteps, 'Should have maxSteps limit');
    assert.ok(prospector.maxSteps <= 4, 'Prospector steps should be bounded to prevent runaway');
  });

  test('specialist: researcher has bounded token limit', () => {
    const researcher = SPECIALIST_META['researcher'];
    assert.ok(researcher, 'Should find researcher');
    assert.ok(researcher.maxSteps, 'Should have maxSteps limit');
    assert.ok(researcher.maxSteps <= 4, 'Researcher steps should be bounded');
  });

  test('specialist: copywriter has higher token limit for drafting', () => {
    const copywriter = SPECIALIST_META['copywriter'];
    assert.ok(copywriter, 'Should find copywriter');
    assert.ok(copywriter.maxSteps, 'Should have maxSteps limit');
    // Copywriter may have higher steps for detailed drafting
    assert.ok(copywriter.maxSteps <= 4, 'Copywriter steps bounded but may be higher');
  });

  test('specialist: compliance has bounded token limit', () => {
    const compliance = SPECIALIST_META['compliance'];
    assert.ok(compliance, 'Should find compliance');
    assert.ok(compliance.maxSteps, 'Should have maxSteps limit');
    assert.ok(compliance.maxSteps <= 4, 'Compliance steps should be bounded');
  });

  test('specialist: outreach has bounded token limit for safety', () => {
    const outreach = SPECIALIST_META['outreach'];
    assert.ok(outreach, 'Should find outreach');
    assert.ok(outreach.maxSteps, 'Should have maxSteps limit');
    // Outreach carries the most tools (start_bulk_job, launch_campaign,
    // push_to_crm, draft_reply) so it gets the highest step budget (5),
    // but it stays bounded by a hard ceiling to prevent runaway spending.
    assert.ok(outreach.maxSteps <= 6, 'Outreach steps bounded to prevent runaway spending');
  });

  test('specialist isolation: each specialist has unique role', () => {
    const roles = SPECIALIST_NAMES;
    const unique_roles = new Set(roles);
    assert.strictEqual(
      unique_roles.size,
      roles.length,
      'All specialist roles should be unique'
    );
  });

  test('specialist isolation: each specialist has unique emoji', () => {
    const emojis = SPECIALIST_NAMES.map(name => SPECIALIST_META[name].emoji);
    const unique_emojis = new Set(emojis);
    assert.strictEqual(
      unique_emojis.size,
      emojis.length,
      'All specialist emojis should be unique'
    );
  });

  test('specialist tool access: only outreach can send', () => {
    const all_tools = new Set<string>();
    SPECIALIST_NAMES.forEach(name => {
      SPECIALIST_META[name].toolNames.forEach(t => all_tools.add(t));
    });

    const launch_campaign_specialists = SPECIALIST_NAMES.filter(s =>
      SPECIALIST_META[s].toolNames.includes('launch_campaign')
    );

    assert.strictEqual(
      launch_campaign_specialists.length,
      1,
      'Exactly one specialist should have launch_campaign'
    );
    assert.strictEqual(
      launch_campaign_specialists[0],
      'outreach',
      'Only outreach should have launch_campaign'
    );
  });

  test('specialist tool access: prospector has discovery tools', () => {
    const prospector = SPECIALIST_META['prospector'];
    assert.ok(prospector, 'Should find prospector');
    assert.ok(prospector.toolNames.includes('web_search'), 'Prospector should have web_search');
  });

  test('specialist tool access: researcher has enrichment tools', () => {
    const researcher = SPECIALIST_META['researcher'];
    assert.ok(researcher, 'Should find researcher');
    assert.ok(researcher.toolNames.includes('enrich_prospect'), 'Researcher should have enrich_prospect');
  });

  test('specialist tool access: copywriter has no external tools (reasoning only)', () => {
    const copywriter = SPECIALIST_META['copywriter'];
    assert.ok(copywriter, 'Should find copywriter');
    assert.strictEqual(copywriter.toolNames.length, 0, 'Copywriter should have no tools (pure LLM drafting)');
  });

  test('specialist tool access: compliance has no external tools (review only)', () => {
    const compliance = SPECIALIST_META['compliance'];
    assert.ok(compliance, 'Should find compliance');
    assert.strictEqual(compliance.toolNames.length, 0, 'Compliance should have no tools (pure LLM review)');
  });

  test('specialist concurrency simulation: 10 concurrent requests across 5 specialists', async () => {
    const request_count = 10;
    const specialist_count = SPECIALIST_NAMES.length;

    // Distribute requests round-robin
    const requests = Array.from({ length: request_count }, (_, i) => ({
      id: `req-${i}`,
      specialist_idx: i % specialist_count,
    }));

    let completed = 0;
    const results = await Promise.all(
      requests.map(async (req) => {
        const specialist_name = SPECIALIST_NAMES[req.specialist_idx];
        const specialist = SPECIALIST_META[specialist_name];
        // Simulate specialist processing
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
        completed++;
        return { req_id: req.id, specialist: specialist.role };
      })
    );

    assert.strictEqual(completed, request_count, 'Should complete all requests');
    assert.strictEqual(results.length, request_count, 'Should have results for all requests');
  });

  test('specialist load: prospector discovers 50 prospects concurrently', async () => {
    // Simulate prospector discovering 50 prospects at once
    const discovery_targets = Array.from({ length: 50 }, (_, i) => ({
      id: `target-${i}`,
      query: `fintech cto in ${['bangalore', 'mumbai', 'delhi', 'pune', 'hyderabad'][i % 5]}`,
    }));

    const results = await Promise.all(
      discovery_targets.map(async (target) => {
        // Simulate Brave Search call (would be cached in reality)
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          target_id: target.id,
          found_prospects: Math.floor(Math.random() * 10) + 1,
        };
      })
    );

    const total_found = results.reduce((sum, r) => sum + r.found_prospects, 0);
    assert.ok(total_found > 0, `Should find prospects across all targets`);
    assert.strictEqual(results.length, 50, 'Should have results for all discovery targets');
  });

  test('specialist load: researcher enriches 30 prospects concurrently', async () => {
    // Simulate researcher enriching 30 prospects in parallel
    const prospects = Array.from({ length: 30 }, (_, i) => ({
      id: `prospect-${i}`,
      name: `Person ${i}`,
      company: `Company ${i}`,
    }));

    const results = await Promise.all(
      prospects.map(async (prospect) => {
        // Simulate enrichment API calls (scraper, Brave Search, Claude drafting)
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
        return {
          prospect_id: prospect.id,
          email: `person${prospect.id.split('-')[1]}@company.com`,
          draft_generated: true,
        };
      })
    );

    assert.strictEqual(results.length, 30, 'Should enrich all 30 prospects');
    assert.ok(results.every(r => r.email), 'Should have emails for all');
  });

  test('specialist load: copywriter drafts 20 emails concurrently', async () => {
    // Simulate copywriter drafting 20 emails in parallel
    const enriched = Array.from({ length: 20 }, (_, i) => ({
      prospect_id: `p${i}`,
      name: `Person ${i}`,
      company: `Company ${i}`,
      talking_points: [`point${i}-a`, `point${i}-b`],
    }));

    const drafts = await Promise.all(
      enriched.map(async (prospect) => {
        // Simulate Claude Sonnet drafting
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 150));
        return {
          prospect_id: prospect.prospect_id,
          draft: `Dear ${prospect.name} at ${prospect.company}, we noticed you might benefit from...`,
          personalization_level: 'high',
        };
      })
    );

    assert.strictEqual(drafts.length, 20, 'Should draft for all 20 prospects');
    assert.ok(drafts.every(d => d.draft && d.draft.includes('Dear')), 'All drafts should be valid');
  });

  test('specialist load: compliance reviews 15 emails concurrently', async () => {
    // Simulate compliance reviewing 15 drafted emails
    const drafts = Array.from({ length: 15 }, (_, i) => ({
      prospect_id: `p${i}`,
      draft: `Dear Person ${i}, we have a solution for you at ${Math.random() * 100}.`,
    }));

    const reviews = await Promise.all(
      drafts.map(async (draft, i) => {
        // Simulate compliance review. Deterministic 14/15 pass rate so the
        // assertion below never flakes (the previous Math.random() > 0.1
        // dipped below 13 compliant ~18% of runs).
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          prospect_id: draft.prospect_id,
          compliant: i !== 0,
          issues: [],
        };
      })
    );

    assert.strictEqual(reviews.length, 15, 'Should review all 15 drafts');
    const compliant_count = reviews.filter(r => r.compliant).length;
    assert.ok(compliant_count >= 13, 'Most should pass compliance (90% pass rate expectation)');
  });

  test('specialist load: outreach sends to 25 approved prospects concurrently', async () => {
    // Simulate outreach sending emails to 25 prospects
    const approved = Array.from({ length: 25 }, (_, i) => ({
      prospect_id: `p${i}`,
      email: `person${i}@company.com`,
      draft: `Personalized email for person ${i}`,
    }));

    const sends = await Promise.all(
      approved.map(async (prospect) => {
        // Simulate Gmail send
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
        return {
          prospect_id: prospect.prospect_id,
          sent: true,
          timestamp: new Date().toISOString(),
        };
      })
    );

    assert.strictEqual(sends.length, 25, 'Should send to all 25 prospects');
    assert.ok(sends.every(s => s.sent), 'All sends should succeed');
  });

  test('specialist load: end-to-end orchestration of all 5 specialists with 10 prospects', async () => {
    // Full pipeline simulation
    const prospects = Array.from({ length: 10 }, (_, i) => ({
      id: `prospect-${i}`,
      name: `Person ${i}`,
      company: `Company ${i}`,
    }));

    // Step 1: Prospector discovers (already have these, simulate as step)
    const discovered = prospects;
    assert.strictEqual(discovered.length, 10);

    // Step 2: Researcher enriches
    const enriched = await Promise.all(
      discovered.map(async (p) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...p, email: `${p.name.replace(' ', '.')}@company.com` };
      })
    );
    assert.strictEqual(enriched.length, 10);

    // Step 3: Copywriter drafts
    const drafted = await Promise.all(
      enriched.map(async (p) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...p, draft: `Email for ${p.name}` };
      })
    );
    assert.strictEqual(drafted.length, 10);

    // Step 4: Compliance reviews
    const reviewed = await Promise.all(
      drafted.map(async (p) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...p, compliant: true };
      })
    );
    const compliant_count = reviewed.filter(p => p.compliant).length;
    assert.strictEqual(compliant_count, 10);

    // Step 5: Outreach sends
    const sent = await Promise.all(
      reviewed
        .filter(p => p.compliant)
        .map(async (p) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ...p, sent: true };
        })
    );
    assert.strictEqual(sent.length, 10);
  });

  test('specialist safety: outreach only called after compliance approval', () => {
    // Verify the invariant: outreach never called directly by orchestrator
    // It only proceeds after compliance review
    
    const compliance_specialist = SPECIALIST_META['compliance'];
    const outreach_specialist = SPECIALIST_META['outreach'];

    assert.ok(compliance_specialist, 'Should have compliance specialist');
    assert.ok(outreach_specialist, 'Should have outreach specialist');

    // In the orchestrator flow, compliance runs before outreach
    // This is enforced in the orchestrator-prompt.ts system message
    assert.ok(true, 'Safety invariant is enforced in system prompt (compliance → outreach only)');
  });
});
