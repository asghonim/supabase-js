/**
 * RLS and helper tests for the comments / conversations system.
 *
 * Tables under test:
 *   conversations, conversation_participants, conversation_targets,
 *   conversation_titles, messages, message_attachments, message_reactions,
 *   conversation_reads, message_versions
 *
 * Conversations and participants are seeded via the admin client because
 * there is no user INSERT policy for conversations — apps manage membership
 * server-side.  User clients are tested for SELECT / INSERT governed by RLS.
 *
 * Messages and reactions are never updated/deleted directly by users; those
 * paths go through the edit_message / delete_message / remove_message_reaction
 * RPCs. Titles are event sourced through the conversation_titles table.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { admin, createTestUser, createTestOrg, deleteTestUser, uniqueSlug, type TestUser, type TestOrg } from './helpers'
import { createCommentsDb } from './conversations'

// ── seed helpers ──────────────────────────────────────────────────────────────

async function seedConversation(tenantOrgId?: number, title?: string) {
  const { data, error } = await admin
    .from('conversations')
    .insert({ tenant_id: tenantOrgId ?? null, type: 'group', title: title ?? null })
    .select()
    .single()
  if (error || !data) throw new Error(`seedConversation: ${error?.message}`)
  return data
}

async function addParticipant(
  conversationId: number,
  accountId: number,
  role: 'owner' | 'admin' | 'member' = 'member',
) {
  const { error } = await admin
    .from('conversation_participants')
    .insert({ conversation_id: conversationId, account_id: accountId, role })
  if (error) throw new Error(`addParticipant: ${error.message}`)
}

async function seedMessage(
  conversationId: number,
  senderAccountId: number,
  body = 'Hello, world.',
) {
  const { data, error } = await admin
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderAccountId, body })
    .select()
    .single()
  if (error || !data) throw new Error(`seedMessage: ${error?.message}`)
  return data
}

// ── conversations RLS ─────────────────────────────────────────────────────────

describe('conversations RLS', () => {
  let userA: TestUser
  let userB: TestUser
  let org: TestOrg

  beforeAll(async () => {
    userA = await createTestUser('conv-rls-a')
    userB = await createTestUser('conv-rls-b')
    org = await createTestOrg(uniqueSlug('conv-rls-org'))
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('participant can view their conversation', async () => {
    const conv = await seedConversation(org.id)
    await addParticipant(conv.id, userA.accountId)

    const { data, error } = await userA.client
      .from('conversations')
      .select('id')
      .eq('id', conv.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('non-participant cannot view the conversation', async () => {
    const conv = await seedConversation(org.id)
    await addParticipant(conv.id, userA.accountId)

    const { data, error } = await userB.client
      .from('conversations')
      .select('id')
      .eq('id', conv.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('admin can view any conversation', async () => {
    const conv = await seedConversation()
    const { data, error } = await admin
      .from('conversations')
      .select('id')
      .eq('id', conv.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})

// ── conversation_titles (event-sourced title) ─────────────────────────────────
//
// Users no longer UPDATE conversations.title directly. They insert a new row
// into conversation_titles; a trigger syncs the latest title back to the
// denormalized conversations.title column.

describe('conversation_titles', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('conv-title-a')
    userB = await createTestUser('conv-title-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('participant can set a title and it syncs to conversations.title', async () => {
    const conv = await seedConversation(undefined, 'Original title')
    await addParticipant(conv.id, userA.accountId)

    const { error } = await userA.client
      .from('conversation_titles')
      .insert({ conversation_id: conv.id, title: 'Renamed by participant' })
    expect(error).toBeNull()

    const { data } = await admin
      .from('conversations')
      .select('title')
      .eq('id', conv.id)
      .single()
    expect(data!.title).toBe('Renamed by participant')
  })

  it('participant can view the title history', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    await userA.client.from('conversation_titles').insert({ conversation_id: conv.id, title: 'First' })
    await userA.client.from('conversation_titles').insert({ conversation_id: conv.id, title: 'Second' })

    const { data, error } = await userA.client
      .from('conversation_titles')
      .select('title')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
    expect(error).toBeNull()
    expect(data!.map(t => t.title)).toEqual(['First', 'Second'])
  })

  it('non-participant cannot set a title', async () => {
    const conv = await seedConversation(undefined, 'Untouched')
    await addParticipant(conv.id, userA.accountId)

    const { error } = await userB.client
      .from('conversation_titles')
      .insert({ conversation_id: conv.id, title: 'Hijacked' })
    expect(error).not.toBeNull()

    const { data } = await admin
      .from('conversations')
      .select('title')
      .eq('id', conv.id)
      .single()
    expect(data!.title).toBe('Untouched')
  })

  it('non-participant cannot view titles', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    await admin.from('conversation_titles').insert({ conversation_id: conv.id, title: 'Secret' })

    const { data } = await userB.client
      .from('conversation_titles')
      .select('id')
      .eq('conversation_id', conv.id)
    expect(data).toHaveLength(0)
  })
})

// ── messages RLS ──────────────────────────────────────────────────────────────

describe('messages RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('msg-rls-a')
    userB = await createTestUser('msg-rls-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('participant can view messages', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    const { data, error } = await userA.client
      .from('messages')
      .select('id')
      .eq('id', msg.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('non-participant cannot view messages', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    const { data, error } = await userB.client
      .from('messages')
      .select('id')
      .eq('id', msg.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('participant can insert their own message', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)

    const { data, error } = await userA.client
      .from('messages')
      .insert({ conversation_id: conv.id, body: 'Hi!' })
      .select()
      .single()
    expect(error).toBeNull()
    expect(data!.body).toBe('Hi!')
  })

  it('participant cannot insert a message on behalf of another sender', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)

    const { error } = await userA.client
      .from('messages')
      .insert({ conversation_id: conv.id, sender_id: userB.accountId, body: 'Impersonation' })
      .select()
      .single()
    expect(error).not.toBeNull()
  })

  it('non-participant cannot insert a message', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)

    const { error } = await userB.client
      .from('messages')
      .insert({ conversation_id: conv.id, sender_id: userB.accountId, body: 'Should fail' })
      .select()
      .single()
    expect(error).not.toBeNull()
  })

  it('soft-deleted messages are hidden from participants', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)
    await admin.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', msg.id)

    const { data } = await userA.client
      .from('messages')
      .select('id')
      .eq('id', msg.id)
    expect(data).toHaveLength(0)
  })
})

describe('edit_message / delete_message (RPC)', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('msg-edit-a')
    userB = await createTestUser('msg-edit-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('sender can edit their own message and a version is recorded', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId, 'Original body')

    const { error } = await userA.client.rpc('edit_message', {
      p_message_id: msg.id,
      p_body: 'Edited body',
    })
    expect(error).toBeNull()

    const { data: row } = await admin
      .from('messages')
      .select('body, edited_at')
      .eq('id', msg.id)
      .single()
    expect(row!.body).toBe('Edited body')
    expect(row!.edited_at).not.toBeNull()

    const { data: versions } = await admin
      .from('message_versions')
      .select('body')
      .eq('message_id', msg.id)
    expect(versions!.map(v => v.body)).toContain('Original body')

    const { data: auditRows } = await admin
      .from('messages_audit')
      .select('operation, old_row, new_row, performed_by_account_id')
      .eq('old_row->>id', String(msg.id))
      .order('performed_at', { ascending: false })
      .limit(1)
    expect(auditRows).toHaveLength(1)
    expect(auditRows![0].operation).toBe('UPDATE')
    expect(auditRows![0].old_row.body).toBe('Original body')
    expect(auditRows![0].new_row.body).toBe('Edited body')
    expect(auditRows![0].performed_by_account_id).toBe(userA.accountId)
  })

  it('a non-sender cannot edit the message', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    await addParticipant(conv.id, userB.accountId)
    const msg = await seedMessage(conv.id, userA.accountId, 'Owned by A')

    const { error } = await userB.client.rpc('edit_message', {
      p_message_id: msg.id,
      p_body: 'Tampered',
    })
    expect(error).not.toBeNull()

    const { data: row } = await admin.from('messages').select('body').eq('id', msg.id).single()
    expect(row!.body).toBe('Owned by A')
  })

  it('sender can soft-delete their own message', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    const { error } = await userA.client.rpc('delete_message', { p_message_id: msg.id })
    expect(error).toBeNull()

    const { data: row } = await admin
      .from('messages')
      .select('deleted_at')
      .eq('id', msg.id)
      .single()
    expect(row!.deleted_at).not.toBeNull()

    const { data: auditRows } = await admin
      .from('messages_audit')
      .select('operation, old_row, new_row, performed_by_account_id')
      .eq('old_row->>id', String(msg.id))
      .order('performed_at', { ascending: false })
      .limit(1)
    expect(auditRows).toHaveLength(1)
    expect(auditRows![0].operation).toBe('UPDATE')
    expect(auditRows![0].old_row.deleted_at).toBeNull()
    expect(auditRows![0].new_row.deleted_at).not.toBeNull()
    expect(auditRows![0].performed_by_account_id).toBe(userA.accountId)
  })

  it('a non-sender cannot delete the message', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    await addParticipant(conv.id, userB.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    const { error } = await userB.client.rpc('delete_message', { p_message_id: msg.id })
    expect(error).not.toBeNull()

    const { data: row } = await admin
      .from('messages')
      .select('deleted_at')
      .eq('id', msg.id)
      .single()
    expect(row!.deleted_at).toBeNull()
  })
})

// ── message_number sequence ───────────────────────────────────────────────────

describe('message_number sequence', () => {
  let userA: TestUser

  beforeAll(async () => {
    userA = await createTestUser('seq-a')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
  })

  it('assigns sequential message_number per conversation', async () => {
    const conv = await seedConversation()

    const m1 = await seedMessage(conv.id, userA.accountId, 'First')
    const m2 = await seedMessage(conv.id, userA.accountId, 'Second')
    const m3 = await seedMessage(conv.id, userA.accountId, 'Third')

    expect(m1.message_number).toBe(1)
    expect(m2.message_number).toBe(2)
    expect(m3.message_number).toBe(3)
  })

  it('sequences are independent across conversations', async () => {
    const convX = await seedConversation()
    const convY = await seedConversation()

    const mx = await seedMessage(convX.id, userA.accountId)
    const my = await seedMessage(convY.id, userA.accountId)

    expect(mx.message_number).toBe(1)
    expect(my.message_number).toBe(1)
  })

  it('conversation message_count increments on insert', async () => {
    const conv = await seedConversation()
    await seedMessage(conv.id, userA.accountId)
    await seedMessage(conv.id, userA.accountId)

    const { data } = await admin
      .from('conversations')
      .select('message_count')
      .eq('id', conv.id)
      .single()
    expect(data!.message_count).toBe(2)
  })

  it('last_message_number tracks the most recent message', async () => {
    const conv = await seedConversation()
    await seedMessage(conv.id, userA.accountId)
    const last = await seedMessage(conv.id, userA.accountId)

    const { data } = await admin
      .from('conversations')
      .select('last_message_number')
      .eq('id', conv.id)
      .single()
    expect(data!.last_message_number).toBe(last.message_number)
  })
})

// ── message_reactions RLS ─────────────────────────────────────────────────────

describe('message_reactions RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('react-a')
    userB = await createTestUser('react-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('participant can add and view a reaction', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    const { error: insertErr } = await userA.client
      .from('message_reactions')
      .insert({ message_id: msg.id, reaction: '👍' })
    expect(insertErr).toBeNull()

    const { data } = await userA.client
      .from('message_reactions')
      .select('reaction')
      .eq('message_id', msg.id)
    expect(data!.map(r => r.reaction)).toContain('👍')
  })

  it('non-participant cannot add a reaction', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    const { error } = await userB.client
      .from('message_reactions')
      .insert({ message_id: msg.id, account_id: userB.accountId, reaction: '❤️' })
    expect(error).not.toBeNull()
  })

  it('user can remove their own reaction', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    await admin
      .from('message_reactions')
      .insert({ message_id: msg.id, account_id: userA.accountId, reaction: '🎉' })

    const { error } = await userA.client.rpc('remove_message_reaction', {
      p_message_id: msg.id,
      p_reaction: '🎉',
    })
    expect(error).toBeNull()

    const { data } = await admin
      .from('message_reactions')
      .select('reaction')
      .eq('message_id', msg.id)
      .eq('account_id', userA.accountId)
    expect(data!.map(r => r.reaction)).not.toContain('🎉')

    const { data: auditRows } = await admin
      .from('message_reactions_audit')
      .select('operation, old_row, new_row, performed_by_account_id')
      .eq('old_row->>message_id', String(msg.id))
      .eq('old_row->>account_id', String(userA.accountId))
      .order('performed_at', { ascending: false })
      .limit(1)
    expect(auditRows).toHaveLength(1)
    expect(auditRows![0].operation).toBe('DELETE')
    expect(auditRows![0].old_row.reaction).toBe('🎉')
    expect(auditRows![0].new_row).toBeNull()
    expect(auditRows![0].performed_by_account_id).toBe(userA.accountId)
  })

  it('a user cannot remove another account\'s reaction', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    await admin
      .from('message_reactions')
      .insert({ message_id: msg.id, account_id: userA.accountId, reaction: '👏' })

    const { error } = await userB.client.rpc('remove_message_reaction', {
      p_message_id: msg.id,
      p_reaction: '👏',
    })
    expect(error).toBeNull()

    const { data } = await admin
      .from('message_reactions')
      .select('reaction')
      .eq('message_id', msg.id)
      .eq('account_id', userA.accountId)
    expect(data!.map(r => r.reaction)).toContain('👏')
  })
})

// ── conversation_reads RLS ────────────────────────────────────────────────────

describe('conversation_reads RLS', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser('reads-a')
    userB = await createTestUser('reads-b')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  it('user can insert and read their own read state', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    const { error } = await userA.client.from('conversation_reads').insert({
      conversation_id:          conv.id,
      last_read_message_id:     msg.id,
      last_read_message_number: msg.message_number
    })
    expect(error).toBeNull()

    const { data } = await userA.client
      .from('conversation_reads')
      .select('last_read_message_id')
      .eq('conversation_id', conv.id)
      .eq('account_id', userA.accountId)
      .single()
    expect(data!.last_read_message_id).toBe(msg.id)
  })

  it('user cannot view another account read state', async () => {
    const conv = await seedConversation()
    await addParticipant(conv.id, userA.accountId)
    const msg = await seedMessage(conv.id, userA.accountId)

    await admin.from('conversation_reads').insert({
      conversation_id:          conv.id,
      account_id:               userA.accountId,
      last_read_message_id:     msg.id,
      last_read_message_number: msg.message_number,
    })

    const { data } = await userB.client
      .from('conversation_reads')
      .select('account_id')
      .eq('conversation_id', conv.id)
      .eq('account_id', userA.accountId)
    expect(data).toHaveLength(0)
  })
})

// ── createCommentsDb ──────────────────────────────────────────────────────────

describe('createCommentsDb', () => {
  let userA: TestUser
  let userB: TestUser
  let org: TestOrg
  const adminDb = createCommentsDb(admin)

  beforeAll(async () => {
    userA = await createTestUser('cdb-a')
    userB = await createTestUser('cdb-b')
    org = await createTestOrg(uniqueSlug('cdb-org'))
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  })

  describe('createConversation / listConversations', () => {
    it('creates a conversation and lists it for a participant', async () => {
      const conv = await adminDb.createConversation({
        tenant_id: org.id,
        type: 'group',
        title: 'Test chat',
        created_by: userA.accountId,
      })
      expect(conv.error).toBeNull()
      await addParticipant(conv.data!.id, userA.accountId)

      const userADb = createCommentsDb(userA.client)
      const list = await userADb.listConversations({ tenantId: org.id })
      expect(list.error).toBeNull()
      expect(list.data!.map(c => c.id)).toContain(conv.data!.id)
    })

    it('filters by type', async () => {
      const conv = await adminDb.createConversation({ type: 'comments' })
      expect(conv.error).toBeNull()
      await addParticipant(conv.data!.id, userA.accountId)

      const userADb = createCommentsDb(userA.client)
      const list = await userADb.listConversations({ type: 'comments' })
      expect(list.error).toBeNull()
      list.data!.forEach(c => expect(c.type).toBe('comments'))
    })
  })

  describe('sendMessage / listMessages', () => {
    it('admin can send a message and list it', async () => {
      const conv = await adminDb.createConversation({ type: 'group' })
      await addParticipant(conv.data!.id, userA.accountId)

      const send = await adminDb.sendMessage({
        conversation_id: conv.data!.id,
        sender_id:       userA.accountId,
        body:            'First message',
      })
      expect(send.error).toBeNull()

      const userADb = createCommentsDb(userA.client)
      const list = await userADb.listMessages(conv.data!.id)
      expect(list.error).toBeNull()
      expect(list.data!.map(m => m.id)).toContain(send.data!.id)
    })

    it('listMessages filters by parent_message_id', async () => {
      const conv = await adminDb.createConversation({ type: 'group' })
      await addParticipant(conv.data!.id, userA.accountId)
      const root = await adminDb.sendMessage({
        conversation_id: conv.data!.id,
        sender_id:       userA.accountId,
        body:            'Root',
      })
      await adminDb.sendMessage({
        conversation_id:   conv.data!.id,
        sender_id:         userA.accountId,
        body:              'Reply',
        parent_message_id: root.data!.id,
      })

      const userADb = createCommentsDb(userA.client)
      const roots = await userADb.listMessages(conv.data!.id, { parentMessageId: null })
      expect(roots.data!.every(m => m.parent_message_id === null)).toBe(true)

      const replies = await userADb.listMessages(conv.data!.id, { parentMessageId: root.data!.id })
      expect(replies.data!.length).toBe(1)
      expect(replies.data![0].parent_message_id).toBe(root.data!.id)
    })

    it('listMessages paginates with before/after', async () => {
      const conv = await adminDb.createConversation({ type: 'group' })
      await addParticipant(conv.data!.id, userA.accountId)
      const m1 = await adminDb.sendMessage({ conversation_id: conv.data!.id, sender_id: userA.accountId, body: 'a' })
      await adminDb.sendMessage({ conversation_id: conv.data!.id, sender_id: userA.accountId, body: 'b' })
      const m3 = await adminDb.sendMessage({ conversation_id: conv.data!.id, sender_id: userA.accountId, body: 'c' })

      const userADb = createCommentsDb(userA.client)
      const after = await userADb.listMessages(conv.data!.id, { after: m1.data!.message_number })
      expect(after.data!.map(m => m.id)).not.toContain(m1.data!.id)

      const before = await userADb.listMessages(conv.data!.id, { before: m3.data!.message_number })
      expect(before.data!.map(m => m.id)).not.toContain(m3.data!.id)
    })
  })

  describe('editMessage', () => {
    // editMessage now goes through the edit_message RPC, so it must be called
    // with the sender's own client (service_role has no account context).
    it('updates body and sets edited_at', async () => {
      const conv = await adminDb.createConversation({ type: 'group' })
      await addParticipant(conv.data!.id, userA.accountId)
      const msg = await adminDb.sendMessage({
        conversation_id: conv.data!.id,
        sender_id:       userA.accountId,
        body:            'Original',
      })

      const userADb = createCommentsDb(userA.client)
      const { data, error } = await userADb.editMessage(msg.data!.id, 'Edited')
      expect(error).toBeNull()
      expect(data!.body).toBe('Edited')
      expect(data!.edited_at).not.toBeNull()

      const { data: auditRows } = await admin
        .from('messages_audit')
        .select('operation, old_row, new_row, performed_by_account_id')
        .eq('old_row->>id', String(msg.data!.id))
        .order('performed_at', { ascending: false })
        .limit(1)
      expect(auditRows).toHaveLength(1)
      expect(auditRows![0].operation).toBe('UPDATE')
      expect(auditRows![0].old_row.body).toBe('Original')
      expect(auditRows![0].new_row.body).toBe('Edited')
      expect(auditRows![0].performed_by_account_id).toBe(userA.accountId)
    })
  })

  describe('softDeleteMessage', () => {
    // softDeleteMessage now goes through the delete_message RPC (sender's client).
    // It sets deleted_at; RLS then hides the message from users (the body is
    // retained for the service_role audit trail rather than nulled).
    it('sets deleted_at and hides the message from the sender', async () => {
      const conv = await adminDb.createConversation({ type: 'group' })
      await addParticipant(conv.data!.id, userA.accountId)
      const msg = await adminDb.sendMessage({
        conversation_id: conv.data!.id,
        sender_id:       userA.accountId,
        body:            'Going away',
      })

      const userADb = createCommentsDb(userA.client)
      const { error } = await userADb.softDeleteMessage(msg.data!.id)
      expect(error).toBeNull()

      const { data } = await admin
        .from('messages')
        .select('deleted_at')
        .eq('id', msg.data!.id)
        .single()
      expect(data!.deleted_at).not.toBeNull()

      const visible = await userADb.getMessage(msg.data!.id)
      expect(visible.data).toBeNull()

      const { data: auditRows } = await admin
        .from('messages_audit')
        .select('operation, old_row, new_row, performed_by_account_id')
        .eq('old_row->>id', String(msg.data!.id))
        .order('performed_at', { ascending: false })
        .limit(1)
      expect(auditRows).toHaveLength(1)
      expect(auditRows![0].operation).toBe('UPDATE')
      expect(auditRows![0].old_row.deleted_at).toBeNull()
      expect(auditRows![0].new_row.deleted_at).not.toBeNull()
      expect(auditRows![0].performed_by_account_id).toBe(userA.accountId)
    })
  })

  describe('conversation_targets', () => {
    it('setTarget and findByTarget round-trip', async () => {
      const conv = await adminDb.createConversation({ type: 'comments' })
      await adminDb.setTarget({ conversation_id: conv.data!.id, target_type: 'blog_post', target_id: '42' })

      const { data, error } = await adminDb.findByTarget('blog_post', '42')
      expect(error).toBeNull()
      expect(data!.conversation_id).toBe(conv.data!.id)
    })
  })

  describe('addReaction / removeReaction', () => {
    it('adds a reaction and removes it', async () => {
      const conv = await adminDb.createConversation({ type: 'group' })
      await addParticipant(conv.data!.id, userA.accountId)
      const msg = await adminDb.sendMessage({
        conversation_id: conv.data!.id,
        sender_id:       userA.accountId,
        body:            'React to me',
      })

      const { error: addErr } = await adminDb.addReaction({
        message_id: msg.data!.id,
        account_id: userA.accountId,
        reaction:   '🚀',
      })
      expect(addErr).toBeNull()

      const { data: list } = await adminDb.listReactions(msg.data!.id)
      expect(list!.map(r => r.reaction)).toContain('🚀')

      // removeReaction now goes through the remove_message_reaction RPC and only
      // removes the caller's own reaction, so it runs on the owner's client.
      const userADb = createCommentsDb(userA.client)
      const { error: delErr } = await userADb.removeReaction(msg.data!.id, '🚀')
      expect(delErr).toBeNull()

      const { data: after } = await adminDb.listReactions(msg.data!.id)
      expect(after!.map(r => r.reaction)).not.toContain('🚀')

      const { data: auditRows } = await admin
        .from('message_reactions_audit')
        .select('operation, old_row, new_row, performed_by_account_id')
        .eq('old_row->>message_id', String(msg.data!.id))
        .eq('old_row->>account_id', String(userA.accountId))
        .order('performed_at', { ascending: false })
        .limit(1)
      expect(auditRows).toHaveLength(1)
      expect(auditRows![0].operation).toBe('DELETE')
      expect(auditRows![0].old_row.reaction).toBe('🚀')
      expect(auditRows![0].new_row).toBeNull()
      expect(auditRows![0].performed_by_account_id).toBe(userA.accountId)
    })
  })

  describe('markRead / getReadState', () => {
    it('marks a conversation read and retrieves state', async () => {
      const conv = await adminDb.createConversation({ type: 'group' })
      await addParticipant(conv.data!.id, userA.accountId)
      const msg = await adminDb.sendMessage({
        conversation_id: conv.data!.id,
        sender_id:       userA.accountId,
        body:            'Read me',
      })

      const userADb = createCommentsDb(userA.client)
      const { error } = await userADb.markRead(
        conv.data!.id,
        msg.data!.id,
        msg.data!.message_number,
      )
      expect(error).toBeNull()

      const { data } = await userADb.getReadState(conv.data!.id, userA.accountId)
      expect(data!.last_read_message_id).toBe(msg.data!.id)
      expect(data!.last_read_message_number).toBe(msg.data!.message_number)
    })
  })

  describe('snapshotVersion / listVersions', () => {
    it('stores and retrieves message version history', async () => {
      const conv = await adminDb.createConversation({ type: 'group' })
      const msg = await adminDb.sendMessage({
        conversation_id: conv.data!.id,
        sender_id:       userA.accountId,
        body:            'v1',
      })

      await adminDb.snapshotVersion(msg.data!.id, 'v1')
      await admin.from('messages').update({ body: 'v2' }).eq('id', msg.data!.id)
      await adminDb.snapshotVersion(msg.data!.id, 'v2')

      const { data, error } = await adminDb.listVersions(msg.data!.id)
      expect(error).toBeNull()
      expect(data!.map(v => v.body)).toEqual(['v1', 'v2'])
    })
  })
})

// ── createCommentsDb — additional method coverage ─────────────────────────────

describe('createCommentsDb — additional methods', () => {
  let userA: TestUser
  const adminDb = createCommentsDb(admin)

  beforeAll(async () => {
    userA = await createTestUser('cdb-extra-a')
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
  })

  it('getConversation returns the conversation by id', async () => {
    const conv = await adminDb.createConversation({ type: 'group', title: 'Get Me' })
    const { data, error } = await adminDb.getConversation(conv.data!.id)
    expect(error).toBeNull()
    expect(data!.id).toBe(conv.data!.id)
    expect(data!.title).toBe('Get Me')
  })

  it('updateConversation updates the title', async () => {
    const conv = await adminDb.createConversation({ type: 'group', title: 'Original' })
    const { data, error } = await adminDb.updateConversation(conv.data!.id, { title: 'Updated' })
    expect(error).toBeNull()
    expect(data!.title).toBe('Updated')
  })

  it('deleteConversation removes the conversation', async () => {
    const conv = await adminDb.createConversation({ type: 'group' })
    const { error } = await adminDb.deleteConversation(conv.data!.id)
    expect(error).toBeNull()
  })

  it('addParticipant and listParticipants round-trip', async () => {
    const conv = await adminDb.createConversation({ type: 'group' })
    const { data, error } = await adminDb.addParticipant({
      conversation_id: conv.data!.id,
      account_id:      userA.accountId,
      role:            'member',
    })
    expect(error).toBeNull()
    expect(data!.account_id).toBe(userA.accountId)

    const { data: list, error: listErr } = await adminDb.listParticipants(conv.data!.id)
    expect(listErr).toBeNull()
    expect(list!.some(p => p.account_id === userA.accountId)).toBe(true)
  })

  it('updateParticipantRole changes the role', async () => {
    const conv = await adminDb.createConversation({ type: 'group' })
    await adminDb.addParticipant({ conversation_id: conv.data!.id, account_id: userA.accountId, role: 'member' })

    const { data, error } = await adminDb.updateParticipantRole(conv.data!.id, userA.accountId, 'admin')
    expect(error).toBeNull()
    expect(data!.role).toBe('admin')
  })

  it('removeParticipant removes them from the conversation', async () => {
    const conv = await adminDb.createConversation({ type: 'group' })
    await adminDb.addParticipant({ conversation_id: conv.data!.id, account_id: userA.accountId, role: 'member' })

    const { error } = await adminDb.removeParticipant(conv.data!.id, userA.accountId)
    expect(error).toBeNull()

    const { data: list } = await adminDb.listParticipants(conv.data!.id)
    expect(list!.some(p => p.account_id === userA.accountId)).toBe(false)
  })

  it('getTarget returns the target linked to a conversation', async () => {
    const conv = await adminDb.createConversation({ type: 'comments' })
    await adminDb.setTarget({ conversation_id: conv.data!.id, target_type: 'article', target_id: '99' })

    const { data, error } = await adminDb.getTarget(conv.data!.id)
    expect(error).toBeNull()
    expect(data!.target_type).toBe('article')
    expect(data!.target_id).toBe('99')
  })

  it('getMessage returns a single message by id', async () => {
    const conv = await adminDb.createConversation({ type: 'group' })
    const msg = await adminDb.sendMessage({
      conversation_id: conv.data!.id,
      sender_id:       userA.accountId,
      body:            'Find me',
    })

    const { data, error } = await adminDb.getMessage(msg.data!.id)
    expect(error).toBeNull()
    expect(data!.id).toBe(msg.data!.id)
    expect(data!.body).toBe('Find me')
  })

  it('listMessages respects the limit option', async () => {
    const conv = await adminDb.createConversation({ type: 'group' })
    await adminDb.sendMessage({ conversation_id: conv.data!.id, sender_id: userA.accountId, body: 'a' })
    await adminDb.sendMessage({ conversation_id: conv.data!.id, sender_id: userA.accountId, body: 'b' })
    await adminDb.sendMessage({ conversation_id: conv.data!.id, sender_id: userA.accountId, body: 'c' })

    const { data, error } = await adminDb.listMessages(conv.data!.id, { limit: 2 })
    expect(error).toBeNull()
    expect(data!.length).toBeLessThanOrEqual(2)
  })

  it('addAttachment, listAttachments, and removeAttachment round-trip', async () => {
    const conv = await adminDb.createConversation({ type: 'group' })
    const msg = await adminDb.sendMessage({
      conversation_id: conv.data!.id,
      sender_id:       userA.accountId,
      body:            'With attachment',
    })

    const { data: att, error: addErr } = await adminDb.addAttachment({
      message_id:   msg.data!.id,
      storage_key:  'uploads/test.txt',
      file_name:    'test.txt',
      content_type: 'text/plain',
      size:         100,
    })
    expect(addErr).toBeNull()
    expect(att!.message_id).toBe(msg.data!.id)

    const { data: list, error: listErr } = await adminDb.listAttachments(msg.data!.id)
    expect(listErr).toBeNull()
    expect(list!.some(a => a.id === att!.id)).toBe(true)

    const { error: removeErr } = await adminDb.removeAttachment(att!.id)
    expect(removeErr).toBeNull()

    const { data: after } = await adminDb.listAttachments(msg.data!.id)
    expect(after!.some(a => a.id === att!.id)).toBe(false)
  })
})

// ── security: conversation impersonation and self-add ─────────────────────────

describe('security: conversation impersonation and self-add', () => {
  let userA: TestUser
  let userB: TestUser
  let userC: TestUser
  let convId: number

  beforeAll(async () => {
    userA = await createTestUser('sec-conv-a')
    userB = await createTestUser('sec-conv-b')
    userC = await createTestUser('sec-conv-c')

    const { data: conv } = await admin
      .from('conversations')
      .insert({ tenant_id: null, type: 'group', title: 'Secure Conv' })
      .select('id')
      .single()
    convId = conv!.id

    await admin
      .from('conversation_participants')
      .insert([
        { conversation_id: convId, account_id: userA.accountId, role: 'owner' },
        { conversation_id: convId, account_id: userB.accountId, role: 'member' },
      ])
  })

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
    await deleteTestUser(userC.id)
  })

  it('non-participant (userC) cannot add themselves to the conversation', async () => {
    const db = createCommentsDb(userC.client)
    const { error } = await db.addParticipant({
      conversation_id: convId,
      account_id: userC.accountId,
      role: 'member',
    })
    expect(error).not.toBeNull()
  })

  it('participant (userB) cannot add a third party (userC) to the conversation', async () => {
    const db = createCommentsDb(userB.client)
    const { error } = await db.addParticipant({
      conversation_id: convId,
      account_id: userC.accountId,
      role: 'member',
    })
    expect(error).not.toBeNull()
  })

  it('participant (userB) cannot send a message with a forged sender_id', async () => {
    const db = createCommentsDb(userB.client)
    const { error } = await db.sendMessage({
      conversation_id: convId,
      sender_id: userA.accountId,
      body: 'This is not from userA',
    })
    expect(error).not.toBeNull()
  })

  it('non-participant (userC) cannot send a message into the conversation', async () => {
    const db = createCommentsDb(userC.client)
    const { error } = await db.sendMessage({
      conversation_id: convId,
      sender_id: userC.accountId,
      body: 'Intruder message',
    })
    expect(error).not.toBeNull()
  })

  it('non-participant (userC) cannot change userA role via updateParticipantRole', async () => {
    const db = createCommentsDb(userC.client)
    const { error } = await db.updateParticipantRole(convId, userA.accountId, 'member')
    expect(error).not.toBeNull()
    const { data } = await admin
      .from('conversation_participants')
      .select('role')
      .eq('conversation_id', convId)
      .eq('account_id', userA.accountId)
      .single()
    expect(data!.role).toBe('owner')
  })
})
