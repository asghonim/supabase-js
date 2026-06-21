/**
 * Tests for the content management system.
 *
 * Tables under test:
 *   content_types, contents, content_versions, content_blocks, content_history
 *
 * Permission matrix (from migration):
 *   owner  → content.view, content.create, content.edit, content.publish, content.delete
 *   admin  → content.view, content.create, content.edit, content.publish, content.delete
 *   member → content.view, content.create, content.edit   (no publish, no delete)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  admin,
  addOrgMember,
  createTestUser,
  createTestOrg,
  deleteTestUser,
  uniqueSlug,
  type TestUser,
  type TestOrg,
} from './helpers'
import { createContentDb } from './content'

// ── content types ─────────────────────────────────────────────────────────────

describe('content types', () => {
  let owner: TestUser
  let org: TestOrg

  beforeAll(async () => {
    owner = await createTestUser('ct-owner')
    org   = await createTestOrg(uniqueSlug('ct-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
  })

  it('listContentTypes returns system types (no org filter)', async () => {
    const db = createContentDb(owner.client)
    const { data, error } = await db.listContentTypes()
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every(t => t.organization_id === null)).toBe(true)
  })

  it('listContentTypes with orgId returns system and org-specific types', async () => {
    const db = createContentDb(owner.client)

    const { data: created } = await db.createContentType(org.id, {
      slug: uniqueSlug('custom-type'),
      name: 'Custom Type',
    })
    expect(created).not.toBeNull()

    const { data, error } = await db.listContentTypes(org.id)
    expect(error).toBeNull()
    expect(data!.some(t => t.id === created!.id)).toBe(true)
    expect(data!.some(t => t.organization_id === null)).toBe(true)
  })

  it('createContentType creates an org-scoped type', async () => {
    const db = createContentDb(owner.client)
    const slug = uniqueSlug('press-release')
    const { data, error } = await db.createContentType(org.id, {
      slug,
      name: 'Press Release',
      description: 'A press release article',
    })
    expect(error).toBeNull()
    expect(data!.slug).toBe(slug)
    expect(data!.organization_id).toBe(org.id)
  })

  it('outsider cannot see org-specific content types', async () => {
    const outsider = await createTestUser('ct-outsider')
    try {
      const db = createContentDb(outsider.client)
      const { data: types } = await db.listContentTypes(org.id)
      const orgTypes = (types ?? []).filter(t => t.organization_id === org.id)
      expect(orgTypes).toHaveLength(0)
    } finally {
      await deleteTestUser(outsider.id)
    }
  })
})

// ── contents CRUD ─────────────────────────────────────────────────────────────

describe('contents CRUD', () => {
  let owner: TestUser
  let org: TestOrg
  let db: ReturnType<typeof createContentDb>
  let contentTypeId: number

  beforeAll(async () => {
    owner = await createTestUser('content-crud-owner')
    org   = await createTestOrg(uniqueSlug('content-crud-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    db = createContentDb(owner.client)

    const { data: ct } = await admin.from('content_types').select('id').eq('slug', 'blog_post').single()
    if (!ct) throw new Error('blog_post content type not found')
    contentTypeId = ct.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
  })

  it('create inserts a content row with default draft status', async () => {
    const slug = uniqueSlug('my-post')
    const { data, error } = await db.create(org.id, {
      content_type_id: contentTypeId,
      slug,
      title: 'My First Post',
    })
    expect(error).toBeNull()
    expect(data!.slug).toBe(slug)
    expect(data!.status).toBe('draft')
    expect(data!.organization_id).toBe(org.id)
  })

  it('list returns all org contents ordered by created_at desc', async () => {
    const { data, error } = await db.list(org.id)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every(c => c.organization_id === org.id)).toBe(true)
  })

  it('list can filter by status', async () => {
    const slug = uniqueSlug('draft-only')
    await db.create(org.id, { content_type_id: contentTypeId, slug, title: 'Draft Post' })

    const { data, error } = await db.list(org.id, { status: 'draft' })
    expect(error).toBeNull()
    expect(data!.every(c => c.status === 'draft')).toBe(true)
  })

  it('list can filter by contentTypeId', async () => {
    const { data, error } = await db.list(org.id, { contentTypeId })
    expect(error).toBeNull()
    expect(data!.every(c => c.content_type_id === contentTypeId)).toBe(true)
  })

  it('getById returns the correct content', async () => {
    const slug = uniqueSlug('get-by-id')
    const { data: created } = await db.create(org.id, {
      content_type_id: contentTypeId,
      slug,
      title: 'Get By Id',
    })

    const { data, error } = await db.getById(created!.id)
    expect(error).toBeNull()
    expect(data!.id).toBe(created!.id)
    expect(data!.slug).toBe(slug)
  })

  it('getBySlug returns the correct content', async () => {
    const slug = uniqueSlug('get-by-slug')
    const { data: created } = await db.create(org.id, {
      content_type_id: contentTypeId,
      slug,
      title: 'Get By Slug',
    })

    const { data, error } = await db.getBySlug(org.id, slug)
    expect(error).toBeNull()
    expect(data!.id).toBe(created!.id)
  })

  it('update changes title and slug', async () => {
    const slug = uniqueSlug('updatable')
    const { data: created } = await db.create(org.id, {
      content_type_id: contentTypeId,
      slug,
      title: 'Original Title',
    })

    const newSlug = uniqueSlug('updated-slug')
    const { data, error } = await db.update(created!.id, {
      title: 'Updated Title',
      slug: newSlug,
    })
    expect(error).toBeNull()
    expect(data!.title).toBe('Updated Title')
    expect(data!.slug).toBe(newSlug)
  })

  it('delete soft-deletes: content is hidden from queries but row is preserved', async () => {
    const slug = uniqueSlug('deletable')
    const { data: created } = await db.create(org.id, {
      content_type_id: contentTypeId,
      slug,
      title: 'To Delete',
    })

    const { error } = await db.delete(created!.id)
    expect(error).toBeNull()

    // Soft-deleted content is invisible to normal client queries
    const { data: afterDelete } = await db.getById(created!.id)
    expect(afterDelete).toBeNull()

    // But the row is still in the database with deleted_at set
    const { data: raw } = await admin
      .from('contents')
      .select('id, deleted_at')
      .eq('id', created!.id)
      .single()
    expect(raw).not.toBeNull()
    expect(raw!.deleted_at).not.toBeNull()
  })
})

// ── publish / unpublish / archive ─────────────────────────────────────────────

describe('content status transitions', () => {
  let owner: TestUser
  let member: TestUser
  let org: TestOrg
  let ownerDb: ReturnType<typeof createContentDb>
  let memberDb: ReturnType<typeof createContentDb>
  let contentTypeId: number

  beforeAll(async () => {
    owner  = await createTestUser('status-owner')
    member = await createTestUser('status-member')
    org    = await createTestOrg(uniqueSlug('status-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')

    ownerDb  = createContentDb(owner.client)
    memberDb = createContentDb(member.client)

    const { data: ct } = await admin.from('content_types').select('id').eq('slug', 'page').single()
    if (!ct) throw new Error('page content type not found')
    contentTypeId = ct.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(member.id)
  })

  it('owner can publish a content item', async () => {
    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: contentTypeId,
      slug: uniqueSlug('to-publish'),
      title: 'To Publish',
    })
    const { data: version, error: versionError } = await ownerDb.createVersion(content!.id, { title: 'v1' })
    expect(versionError).toBeNull()

    const { data, error } = await ownerDb.publish(content!.id, version!.id)
    expect(error).toBeNull()
    expect(data!.status).toBe('published')
    expect(data!.published_version_id).toBe(version!.id)
  })

  it('owner can unpublish a content item', async () => {
    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: contentTypeId,
      slug: uniqueSlug('to-unpublish'),
      title: 'To Unpublish',
    })
    const { data: version } = await ownerDb.createVersion(content!.id, { title: 'v1' })
    await ownerDb.publish(content!.id, version!.id)

    const { data, error } = await ownerDb.unpublish(content!.id)
    expect(error).toBeNull()
    expect(data!.status).toBe('draft')
    expect(data!.published_version_id).toBeNull()
  })

  it('owner can archive a content item', async () => {
    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: contentTypeId,
      slug: uniqueSlug('to-archive'),
      title: 'To Archive',
    })

    const { data, error } = await ownerDb.archive(content!.id)
    expect(error).toBeNull()
    expect(data!.status).toBe('archived')
  })

  it('member cannot publish (missing content.publish permission)', async () => {
    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: contentTypeId,
      slug: uniqueSlug('member-publish-attempt'),
      title: 'Member Publish Attempt',
    })
    const { data: version } = await ownerDb.createVersion(content!.id, { title: 'v1' })

    const { error } = await memberDb.publish(content!.id, version!.id)
    expect(error).not.toBeNull()
  })

  it('member cannot archive content', async () => {
    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: contentTypeId,
      slug: uniqueSlug('member-archive-attempt'),
      title: 'Member Archive Attempt',
    })

    const { error } = await memberDb.archive(content!.id)
    expect(error).not.toBeNull()
  })

  it('member cannot delete content', async () => {
    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: contentTypeId,
      slug: uniqueSlug('member-delete-attempt'),
      title: 'Member Delete Attempt',
    })

    const { error } = await memberDb.delete(content!.id)
    expect(error).not.toBeNull()
    const { data } = await admin.from('contents').select('id').eq('id', content!.id)
    expect(data!.length).toBeGreaterThan(0)
  })

  it('member cannot unpublish content (unpublish requires publish permission)', async () => {
    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: contentTypeId,
      slug: uniqueSlug('member-unpublish-attempt'),
      title: 'Member Unpublish Attempt',
    })
    const { data: version } = await ownerDb.createVersion(content!.id, { title: 'v1' })
    await ownerDb.publish(content!.id, version!.id)

    const { error } = await memberDb.unpublish(content!.id)
    expect(error).not.toBeNull()
  })
})

// ── content versions ──────────────────────────────────────────────────────────

describe('content versions', () => {
  let owner: TestUser
  let org: TestOrg
  let db: ReturnType<typeof createContentDb>
  let contentId: number

  beforeAll(async () => {
    owner = await createTestUser('versions-owner')
    org   = await createTestOrg(uniqueSlug('versions-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    db = createContentDb(owner.client)

    const { data: ct } = await admin.from('content_types').select('id').eq('slug', 'blog_post').single()
    if (!ct) throw new Error('blog_post content type not found')

    const { data: content } = await db.create(org.id, {
      content_type_id: ct.id,
      slug: uniqueSlug('versioned-post'),
      title: 'Versioned Post',
    })
    if (!content) throw new Error('failed to create content for versions test')
    contentId = content.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
  })

  it('createVersion auto-increments version_number', async () => {
    const { data: v1, error: e1 } = await db.createVersion(contentId, { title: 'Version 1' })
    expect(e1).toBeNull()
    expect(v1!.version_number).toBe(1)

    const { data: v2, error: e2 } = await db.createVersion(contentId, { title: 'Version 2' })
    expect(e2).toBeNull()
    expect(v2!.version_number).toBe(2)
  })

  it('createVersion stores optional fields', async () => {
    const { data, error } = await db.createVersion(contentId, {
      title: 'Rich Version',
      summary: 'A brief summary',
      seo_title: 'SEO Title',
      seo_description: 'SEO description text',
      body_json: [{ type: 'paragraph', text: 'Hello' }],
    })
    expect(error).toBeNull()
    expect(data!.summary).toBe('A brief summary')
    expect(data!.seo_title).toBe('SEO Title')
  })

  it('listVersions returns versions in descending order', async () => {
    const { data, error } = await db.listVersions(contentId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    expect(data!.length).toBeGreaterThan(1)
    for (let i = 1; i < data!.length; i++) {
      expect(data![i - 1].version_number).toBeGreaterThan(data![i].version_number)
    }
  })

  it('getVersion returns a single version by id', async () => {
    const { data: created } = await db.createVersion(contentId, { title: 'Fetchable' })
    const { data, error } = await db.getVersion(created!.id)
    expect(error).toBeNull()
    expect(data!.id).toBe(created!.id)
    expect(data!.title).toBe('Fetchable')
  })
})

// ── content blocks ────────────────────────────────────────────────────────────

describe('content blocks', () => {
  let owner: TestUser
  let org: TestOrg
  let db: ReturnType<typeof createContentDb>
  let versionId: number

  beforeAll(async () => {
    owner = await createTestUser('blocks-owner')
    org   = await createTestOrg(uniqueSlug('blocks-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    db = createContentDb(owner.client)

    const { data: ct } = await admin.from('content_types').select('id').eq('slug', 'page').single()
    if (!ct) throw new Error('page content type not found')

    const { data: content } = await db.create(org.id, {
      content_type_id: ct.id,
      slug: uniqueSlug('blocks-page'),
      title: 'Blocks Page',
    })
    const { data: version } = await db.createVersion(content!.id, { title: 'v1' })
    if (!version) throw new Error('failed to create version for blocks test')
    versionId = version.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
  })

  it('replaceBlocks inserts blocks for a version', async () => {
    const { data, error } = await db.replaceBlocks(versionId, [
      { block_order: 1, block_type: 'heading', data_json: { text: 'Hello' } },
      { block_order: 2, block_type: 'paragraph', data_json: { text: 'World' } },
    ])
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
  })

  it('listBlocks returns blocks ordered by block_order', async () => {
    const { data, error } = await db.listBlocks(versionId)
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < data!.length; i++) {
      expect(data![i].block_order).toBeGreaterThan(data![i - 1].block_order)
    }
  })

  it('replaceBlocks updates existing blocks', async () => {
    await db.replaceBlocks(versionId, [
      { block_order: 1, block_type: 'heading', data_json: { text: 'Updated Heading' } },
    ])

    const { data } = await db.listBlocks(versionId)
    const block1 = data!.find(b => b.block_order === 1)
    expect((block1!.data_json as { text: string }).text).toBe('Updated Heading')
  })

  it('replaceBlocks removes blocks absent from the new set', async () => {
    await db.replaceBlocks(versionId, [
      { block_order: 1, block_type: 'heading',   data_json: { text: 'A' } },
      { block_order: 2, block_type: 'paragraph', data_json: { text: 'B' } },
    ])

    await db.replaceBlocks(versionId, [
      { block_order: 1, block_type: 'heading', data_json: { text: 'A' } },
    ])

    const { data } = await db.listBlocks(versionId)
    expect(data).toHaveLength(1)
    expect(data![0].block_order).toBe(1)
  })

  it('replaceBlocks with empty array removes all blocks', async () => {
    await db.replaceBlocks(versionId, [
      { block_order: 1, block_type: 'heading', data_json: { text: 'X' } },
    ])

    const { data, error } = await db.replaceBlocks(versionId, [])
    expect(error).toBeNull()
    expect(data).toHaveLength(0)

    const { data: listed } = await db.listBlocks(versionId)
    expect(listed).toHaveLength(0)
  })
})

// ── content history ───────────────────────────────────────────────────────────

describe('content history', () => {
  let owner: TestUser
  let org: TestOrg
  let db: ReturnType<typeof createContentDb>
  let contentId: number

  beforeAll(async () => {
    owner = await createTestUser('history-owner')
    org   = await createTestOrg(uniqueSlug('history-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    db = createContentDb(owner.client)

    const { data: ct } = await admin.from('content_types').select('id').eq('slug', 'announcement').single()
    if (!ct) throw new Error('announcement content type not found')

    const { data: content } = await db.create(org.id, {
      content_type_id: ct.id,
      slug: uniqueSlug('history-post'),
      title: 'History Post',
    })
    if (!content) throw new Error('failed to create content for history test')
    contentId = content.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
  })

  it('listHistory returns the auto-created "created" event', async () => {
    const { data, error } = await db.listHistory(contentId)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    const createdEvent = data!.find(h => h.action === 'created')
    expect(createdEvent).toBeDefined()
  })

  it('listHistory records a "published" event after publish', async () => {
    const { data: version } = await db.createVersion(contentId, { title: 'v1' })
    await db.publish(contentId, version!.id)

    const { data, error } = await db.listHistory(contentId)
    expect(error).toBeNull()
    const publishedEvent = data!.find(h => h.action === 'published')
    expect(publishedEvent).toBeDefined()
  })

  it('listHistory records an "unpublished" event after unpublish', async () => {
    await db.unpublish(contentId)

    const { data } = await db.listHistory(contentId)
    const unpublishedEvent = data!.find(h => h.action === 'unpublished')
    expect(unpublishedEvent).toBeDefined()
  })

  it('listHistory records an "archived" event after archive', async () => {
    await db.archive(contentId)

    const { data } = await db.listHistory(contentId)
    const archivedEvent = data!.find(h => h.action === 'archived')
    expect(archivedEvent).toBeDefined()
  })

  it('listHistory is ordered descending by created_at', async () => {
    const { data } = await db.listHistory(contentId)
    for (let i = 1; i < data!.length; i++) {
      expect(data![i - 1].created_at >= data![i].created_at).toBe(true)
    }
  })
})

// ── RLS: outsider isolation ───────────────────────────────────────────────────

describe('RLS — outsider cannot access org content', () => {
  let owner: TestUser
  let outsider: TestUser
  let org: TestOrg
  let contentId: number

  beforeAll(async () => {
    owner    = await createTestUser('rls-owner')
    outsider = await createTestUser('rls-outsider')
    org      = await createTestOrg(uniqueSlug('rls-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')

    const ownerDb = createContentDb(owner.client)
    const { data: ct } = await admin.from('content_types').select('id').eq('slug', 'page').single()
    if (!ct) throw new Error('page content type not found')

    const { data: content } = await ownerDb.create(org.id, {
      content_type_id: ct.id,
      slug: uniqueSlug('rls-page'),
      title: 'RLS Page',
    })
    if (!content) throw new Error('failed to create content for RLS test')
    contentId = content.id
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(outsider.id)
  })

  it('outsider cannot list org contents', async () => {
    const db = createContentDb(outsider.client)
    const { data, error } = await db.list(org.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('outsider cannot get content by id', async () => {
    const db = createContentDb(outsider.client)
    const { data } = await db.getById(contentId)
    expect(data).toBeNull()
  })

  it('outsider cannot create content in org', async () => {
    const db = createContentDb(outsider.client)
    const { data: ct } = await admin.from('content_types').select('id').eq('slug', 'page').single()
    const { error } = await db.create(org.id, {
      content_type_id: ct!.id,
      slug: uniqueSlug('rls-outsider-create'),
      title: 'Should Fail',
    })
    expect(error).not.toBeNull()
  })

  it('outsider cannot UPDATE content from another org', async () => {
    const { error } = await outsider.client
      .from('contents')
      .update({ title: 'Hijacked Title' })
      .eq('id', contentId)
    expect(error).not.toBeNull()
    const { data } = await admin.from('contents').select('title').eq('id', contentId).single()
    expect(data!.title).not.toBe('Hijacked Title')
  })

  it('outsider cannot DELETE content from another org', async () => {
    const { error } = await outsider.client
      .from('contents')
      .delete()
      .eq('id', contentId)
    expect(error).not.toBeNull()
    const { data } = await admin.from('contents').select('id').eq('id', contentId)
    expect(data!.length).toBeGreaterThan(0)
  })

  it('outsider cannot INSERT a content version for another org content', async () => {
    const { error } = await outsider.client
      .from('content_versions')
      .insert({ content_id: contentId, title: 'Injected Version', version_number: 99 })
    expect(error).not.toBeNull()
  })
})

// ── security: content type creation restricted to org admins/owners ───────────

describe('security: content type creation restricted to org admins/owners', () => {
  let owner: TestUser
  let member: TestUser
  let outsider: TestUser
  let org: TestOrg

  beforeAll(async () => {
    owner = await createTestUser('sec-ct-owner')
    member = await createTestUser('sec-ct-member')
    outsider = await createTestUser('sec-ct-outsider')
    org = await createTestOrg(uniqueSlug('sec-ct-org'))
    await addOrgMember(org.id, owner.accountId, 'owner')
    await addOrgMember(org.id, member.accountId, 'member')
  })

  afterAll(async () => {
    await deleteTestUser(owner.id)
    await deleteTestUser(member.id)
    await deleteTestUser(outsider.id)
  })

  it('regular member cannot create a custom content type', async () => {
    const db = createContentDb(member.client)
    const { error } = await db.createContentType(org.id, {
      slug: uniqueSlug('sneaky-type'),
      name: 'Sneaky Type',
    })
    expect(error).not.toBeNull()
  })

  it('outsider cannot create a content type for another org', async () => {
    const db = createContentDb(outsider.client)
    const { error } = await db.createContentType(org.id, {
      slug: uniqueSlug('outsider-type'),
      name: 'Outsider Type',
    })
    expect(error).not.toBeNull()
  })

  it('outsider cannot create a system content type (organization_id = null)', async () => {
    const { error } = await outsider.client
      .from('content_types')
      .insert({ slug: uniqueSlug('sys-type'), name: 'Fake System Type', organization_id: null })
    expect(error).not.toBeNull()
  })
})
