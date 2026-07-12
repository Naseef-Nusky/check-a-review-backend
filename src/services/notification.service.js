import { query } from '../db/pool.js'

export const notificationService = {
  async create(userId, title, message, type) {
    const result = await query(
      `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, title, message, type],
    )
    return result.rows[0]
  },

  async getByUser(userId) {
    const result = await query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId],
    )
    return result.rows
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
