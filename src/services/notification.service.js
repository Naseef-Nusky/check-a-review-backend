import { query } from '../db/pool.js'

let linkColumnReady = false

async function ensureLinkColumn() {
  if (linkColumnReady) return
  await query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT')
  linkColumnReady = true
}

export const notificationService = {
  async create(userId, title, message, type, link = null) {
    await ensureLinkColumn()
    const result = await query(
      `INSERT INTO notifications (user_id, title, message, type, link)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, title, message, type, link],
    )
    return result.rows[0]
  },

  /** Notify every CRM staff account (super_admin, admin, viewer). */
  async notifyCrmStaff(title, message, type, link = null) {
    await ensureLinkColumn()
    const staff = await query(
      `SELECT id FROM users WHERE role IN ('super_admin', 'admin', 'viewer')`,
    )
    if (staff.rows.length === 0) return []

    const created = []
    for (const row of staff.rows) {
      const notification = await this.create(row.id, title, message, type, link)
      created.push(notification)
    }
    return created
  },

  async getByUser(userId) {
    await ensureLinkColumn()
    const result = await query(
      `SELECT id, title, message, type, link, read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    )
    return result.rows
  },

  async getUnreadCount(userId) {
    const result = await query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = FALSE',
      [userId],
    )
    return result.rows[0]?.count || 0
  },

  async markAsRead(notificationId, userId) {
    await query(
      'UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2',
      [notificationId, userId],
    )
  },

  async markAllAsRead(userId) {
    await query('UPDATE notifications SET read = TRUE WHERE user_id = $1', [userId])
  },
}
