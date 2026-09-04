/**
 * One-shot: submit all published business URLs to IndexNow.
 *
 *   node scripts/notify-indexnow.js
 *   PUBLIC_SITE_URL=https://checkareview.com node scripts/notify-indexnow.js
 */
import { searchIndexService } from '../src/services/searchIndex.service.js'
import { pool } from '../src/db/pool.js'

const result = await searchIndexService.notifyAllPublishedBusinesses()
console.log(JSON.stringify(result, null, 2))
await pool.end()
