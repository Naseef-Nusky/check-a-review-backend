import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/helpers.js'

const SUMMARY_PROMPT = `You are writing a customer-review summary for a business profile page.
Based only on the provided reviews, return JSON ONLY with this exact shape:
{
  "summary": "<2-4 sentence overview of what customers say>",
  "sentiment": "positive" | "mixed" | "neutral" | "negative",
  "highlights": ["<short theme>", "<short theme>", "<short theme>"],
  "cons": ["<weakness or concern>"]
}

Rules:
- Be fair and factual. Do not invent details not present in the reviews.
- Keep highlights/cons short (3-8 words each).
- If there are few reviews, say so briefly in the summary.
- If there are no clear cons, return an empty cons array.
- Do not include markdown or text outside the JSON object.`

function parseJsonResponse(text) {
  if (!text) throw new Error('Empty AI response')
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const jsonText = fenced ? fenced[1].trim() : trimmed
  return JSON.parse(jsonText)
}

async function ensureSummaryColumn() {
  await query('ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_review_summary JSONB')
}

function fallbackSummary({ businessName, reviews, averageRating }) {
  const count = reviews.length
  if (count === 0) {
    return {
      summary: `${businessName} does not have published customer reviews yet.`,
      sentiment: 'neutral',
    highlights: [],
    cons: [],
    reviewCount: 0,
      averageRating: Number(averageRating) || 0,
      generatedAt: new Date().toISOString(),
      provider: 'fallback',
    }
  }

  const avg = Number(averageRating) || (
    reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / count
  )
  const sentiment = avg >= 4 ? 'positive' : avg >= 3 ? 'mixed' : 'negative'

  return {
    summary: `Based on ${count} published review${count === 1 ? '' : 's'}, ${businessName} has an average rating of ${avg.toFixed(1)} out of 5.`,
    sentiment,
    highlights: [`${avg.toFixed(1)} average rating`, `${count} customer review${count === 1 ? '' : 's'}`],
    cons: avg < 3 ? ['Lower average rating'] : [],
    reviewCount: count,
    averageRating: Number(avg.toFixed(2)),
    generatedAt: new Date().toISOString(),
    provider: 'fallback',
  }
}

async function callGemini(userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.AI_MODEL}:generateContent`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.AI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SUMMARY_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Gemini summary error: ${response.status} ${body.slice(0, 200)}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  return parseJsonResponse(text)
}

async function callOpenAI(userPrompt) {
  const response = await fetch(`${env.AI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.AI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI summary error: ${response.status} ${body.slice(0, 200)}`)
  }

  const data = await response.json()
  return parseJsonResponse(data.choices[0].message.content)
}

function normalizeSummary(result, meta) {
  const sentimentRaw = String(result.sentiment || 'neutral').toLowerCase()
  const sentiment = ['positive', 'mixed', 'neutral', 'negative'].includes(sentimentRaw)
    ? sentimentRaw
    : 'neutral'

  return {
    summary: String(result.summary || '').trim() || 'Customer reviews are available for this business.',
    sentiment,
    highlights: Array.isArray(result.highlights) ? result.highlights.map(String).slice(0, 5) : [],
    cons: Array.isArray(result.cons) ? result.cons.map(String).slice(0, 5) : [],
    reviewCount: meta.reviewCount,
    averageRating: meta.averageRating,
    generatedAt: new Date().toISOString(),
    provider: meta.provider,
  }
}

export const aiReviewSummaryService = {
  async invalidate(businessId) {
    await ensureSummaryColumn()
    await query('UPDATE businesses SET ai_review_summary = NULL WHERE id = $1', [businessId])
  },

  async getSummary(businessIdOrSlug, { force = false } = {}) {
    await ensureSummaryColumn()

    const businessResult = await query(
      `SELECT id, name, average_rating, review_count, ai_review_summary
       FROM businesses
       WHERE id::text = $1 OR slug = $1`,
      [businessIdOrSlug],
    )
    if (businessResult.rows.length === 0) throw new AppError('Business not found', 404)

    const business = businessResult.rows[0]
    const cached = business.ai_review_summary
    const currentCount = Number(business.review_count || 0)

    if (
      !force &&
      cached &&
      typeof cached === 'object' &&
      Number(cached.reviewCount) === currentCount
    ) {
      return cached
    }

    const reviewsResult = await query(
      `SELECT rating, title, content
       FROM reviews
       WHERE business_id = $1 AND status = 'published'
       ORDER BY created_at DESC
       LIMIT 40`,
      [business.id],
    )
    const reviews = reviewsResult.rows
    const averageRating = Number(business.average_rating || 0)

    if (reviews.length === 0) {
      const empty = fallbackSummary({
        businessName: business.name,
        reviews,
        averageRating,
      })
      await query('UPDATE businesses SET ai_review_summary = $1::jsonb WHERE id = $2', [
        JSON.stringify(empty),
        business.id,
      ])
      return empty
    }

    const reviewLines = reviews
      .map((r, i) => `${i + 1}. Rating ${r.rating}/5 | ${r.title || 'Untitled'}: ${String(r.content || '').slice(0, 280)}`)
      .join('\n')

    const userPrompt = `Business: ${business.name}
Average rating: ${averageRating}
Published reviews (${currentCount} total, showing latest ${reviews.length}):
${reviewLines}`

    let summary
    try {
      if (!env.AI_API_KEY) {
        summary = fallbackSummary({ businessName: business.name, reviews, averageRating })
        summary.reviewCount = currentCount
      } else {
        const raw =
          env.AI_PROVIDER === 'openai'
            ? await callOpenAI(userPrompt)
            : await callGemini(userPrompt)
        summary = normalizeSummary(raw, {
          reviewCount: currentCount,
          averageRating,
          provider: env.AI_PROVIDER === 'openai' ? 'openai' : 'gemini',
        })
      }
    } catch (err) {
      console.error('AI review summary failed:', err.message)
      summary = fallbackSummary({ businessName: business.name, reviews, averageRating })
      summary.reviewCount = currentCount
    }

    await query('UPDATE businesses SET ai_review_summary = $1::jsonb WHERE id = $2', [
      JSON.stringify(summary),
      business.id,
    ])

    return summary
  },
}
