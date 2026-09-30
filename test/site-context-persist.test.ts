/**
 * A site context is built once and kept: the store writes a project only when
 * its `updatedAt` moves, so building one has to move it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, projectToIdentity } from '../packages/shared/src';

// No mapping provider: a coordinate the file states is enough to place the site.
delete process.env.REALYTICA_GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;

describe('a site context built for a project', () => {
  it('moves updatedAt, so the store writes it and every server has it', async () => {
    const { ensureIdentitySiteContext } = await import('../apps/api/src/site-context');
    const project = createProject({ name: 'Stated pin', type: 'residential', location: 'Whitefield', city: 'Bengaluru' }, 'RYT-0010');
    project.siteCoordinate = { lat: 12.9698, lng: 77.7499 };
    const built = '2026-09-30T12:00:00.000Z';
    assert.notEqual(project.updatedAt, built);

    const context = await ensureIdentitySiteContext(project, projectToIdentity(project), built);
    assert.ok(context?.location, 'a stated coordinate places the site without a provider');
    assert.equal(project.siteContext, context);
    assert.equal(project.updatedAt, built);

    // Still current: nothing is rebuilt, so nothing moves.
    await ensureIdentitySiteContext(project, projectToIdentity(project), '2026-09-30T13:00:00.000Z');
    assert.equal(project.updatedAt, built);
  });
});
