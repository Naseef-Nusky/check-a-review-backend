import { query } from '../src/db/pool.js'

const r = await query(
  `SELECT email,
          SUM(CASE WHEN role='customer' THEN 1 ELSE 0 END) AS customer_count,
          SUM(CASE WHEN role='business' THEN 1 ELSE 0 END) AS business_count
   FROM users
   GROUP BY email
   HAVING SUM(CASE WHEN role='customer' THEN 1 ELSE 0 END) > 0
      AND SUM(CASE WHEN role='business' THEN 1 ELSE 0 END) > 0
   LIMIT 20`,
)

console.log(r.rows)

