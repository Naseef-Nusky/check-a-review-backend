import { env } from '../config/env.js'
import { query } from '../db/pool.js'
import { settingsService } from './settings.service.js'

const MODERATION_PROMPT = `You are a review moderation API for a business review platform similar to Trustpilot.
Reviews are held in a processing stage until they pass automated checks.
Analyze the customer review and return JSON ONLY with this exact shape:
{
  "riskScore": <number 0-100>,
  "flags": <array of zero or more of: "spam", "offensive", "fake_pattern", "duplicate", "low_sentiment", "low_content", "personal_info", "promotional">,
  "sentiment": "positive" | "neutral" | "negative",
  "recommendation": "publish" | "admin_review",
  "summary": "<brief explanation>"
}

Rules:
- riskScore 0 = safe, 100 = high risk
- recommendation must be exactly "publish" or "admin_review" (never a sentence)
- Use "publish" only when the review looks genuine, policy-compliant, and low-risk
- Use "admin_review" for spam, abuse, fake patterns, personal information, promotional content, or unclear/suspicious content
- Do not include markdown or extra text outside the JSON object`

function parseJsonResponse(text) {
  if (!text) throw new Error('Empty AI response')

  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const jsonText = fenced ? fenced[1].trim() : trimmed

  return JSON.parse(jsonText)
}

function normalizeAnalysis(result, provider) {
  const recommendationRaw = String(result.recommendation || '').toLowerCase()
  const recommendation =
    recommendationRaw.includes('publish') && !recommendationRaw.includes('admin')
      ? 'publish'
      : 'admin_review'

  const sentimentRaw = String(result.sentiment || 'neutral').toLowerCase()
  const sentiment = ['positive', 'neutral', 'negative'].includes(sentimentRaw)
    ? sentimentRaw
    : 'neutral'

  return {
    riskScore: Math.min(100, Math.max(0, Number(result.riskScore ?? 50))),
    flags: Array.isArray(result.flags) ? [...new Set(result.flags.map(String))] : [],
    sentiment,
    recommendation,
    summary: result.summary ?? '',
    provider,
  }
}

function mergeAnalyses(primary, secondary) {
  const flags = [...new Set([...(primary.flags || []), ...(secondary.flags || [])])]
  const riskScore = Math.max(Number(primary.riskScore || 0), Number(secondary.riskScore || 0))
  const recommendation =
    primary.recommendation === 'admin_review' || secondary.recommendation === 'admin_review'
      ? 'admin_review'
      : 'publish'

  const summaries = [primary.summary, secondary.summary].filter(Boolean)
  return {
    riskScore: Math.min(riskScore, 100),
    flags,
    sentiment: primary.sentiment || secondary.sentiment || 'neutral',
    recommendation,
    summary: summaries.join(' | '),
    provider: primary.provider || secondary.provider,
    checks: {
      ai: primary.provider && primary.provider !== 'rules',
      automated: Boolean(secondary.provider === 'rules' || secondary.checks?.automated),
      duplicate: flags.includes('duplicate'),
      personalInfo: flags.includes('personal_info'),
      promotional: flags.includes('promotional'),
    },
  }
}

function ruleBasedFlags({ title, content, rating }) {
  const flags = []
  let riskScore = 8
  const text = `${title || ''}\n${content || ''}`

  const spamPatterns = [
    /click here/i,
    /buy now/i,
    /limited time offer/i,
    /free money/i,
    /crypto\s*investment/i,
  ]
  const promotionalPatterns = [
    /https?:\/\//i,
    /www\./i,
    /\b[\w-]+\.(com|net|org|io|co)\b/i,
    /use code\b/i,
    /promo code\b/i,
  ]
  const offensivePatterns = [
    /\bf+u+c+k+/i,
    /\bs+h+i+t+/i,
    /\ba+s+s+h+o+l+e+/i,
    /\bbitch\b/i,
    /\bnigg/i,
    /\bkill\s+yourself\b/i,
  ]
  const personalInfoPatterns = [
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    /\b\+?\d{10,15}\b/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|lane|ln|drive|dr)\b/i,
  ]

  if (spamPatterns.some((p) => p.test(text))) {
    flags.push('spam')
    riskScore += 40
  }
  if (promotionalPatterns.some((p) => p.test(text))) {
    flags.push('promotional')
    riskScore += 35
  }
  if (offensivePatterns.some((p) => p.test(text))) {
    flags.push('offensive')
    riskScore += 45
  }
  if (personalInfoPatterns.some((p) => p.test(text))) {
    flags.push('personal_info')
    riskScore += 40
  }
  if ((content || '').trim().length < 20) {
    flags.push('low_content')
    riskScore += 25
  }
  if (Number(rating) === 5 && (content || '').trim().length < 30) {
    flags.push('fake_pattern')
    riskScore += 20
  }
  if (Number(rating) === 1 && (content || '').trim().length < 25) {
    flags.push('fake_pattern')
    riskScore += 15
  }

  const recommendation = flags.length > 0 && riskScore > 40 ? 'admin_review' : 'publish'
  return {
    riskScore: Math.min(riskScore, 100),
    flags: [...new Set(flags)],
    sentiment: Number(rating) >= 4 ? 'positive' : Number(rating) <= 2 ? 'negative' : 'neutral',
    recommendation,
    summary: flags.length
      ? `Automated policy checks flagged: ${flags.join(', ')}`
      : 'Passed automated policy checks',
    provider: 'rules',
    checks: { automated: true },
  }
}

export const aiModerationService = {
  isConfigured() {
    return !!env.AI_API_KEY
  },

  async findDuplicateSignals({ content, userId, businessId, excludeReviewId }) {
    const normalized = String(content || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
    if (normalized.length < 20) {
      return { isDuplicate: false, flags: [], riskScore: 0, summary: '' }
    }

    const params = [normalized.slice(0, 500), userId]
    let sql = `
      SELECT id, business_id, content
      FROM reviews
      WHERE user_id = $2
        AND LOWER(REGEXP_REPLACE(content, '\\s+', ' ', 'g')) = $1
    `
    if (excludeReviewId) {
      params.push(excludeReviewId)
      sql += ` AND id <> $${params.length}`
    }
    sql += ' LIMIT 5'

    const sameUser = await query(sql, params)
    if (sameUser.rows.length > 0) {
      return {
        isDuplicate: true,
        flags: ['duplicate'],
        riskScore: 70,
        summary: 'Duplicate detection: same user submitted matching review text before',
      }
    }

    // Near-duplicate on same business (same opening + similar length)
    const snippet = normalized.slice(0, 80)
    const near = await query(
      `SELECT id FROM reviews
       WHERE business_id = $1
         AND ($2::uuid IS NULL OR id <> $2::uuid)
         AND LOWER(LEFT(REGEXP_REPLACE(content, '\\s+', ' ', 'g'), 80)) = $3
         AND ABS(LENGTH(content) - $4) < 25
       LIMIT 3`,
      [businessId, excludeReviewId || null, snippet, String(content || '').length],
    )

    if (near.rows.length > 0) {
      return {
        isDuplicate: true,
        flags: ['duplicate'],
        riskScore: 55,
        summary: 'Duplicate detection: very similar review already exists for this business',
      }
    }

    return { isDuplicate: false, flags: [], riskScore: 0, summary: '' }
  },

  async runAutomatedChecks({ title, content, rating, userId, businessId, excludeReviewId }) {
    const rules = ruleBasedFlags({ title, content, rating })
    const duplicate = await this.findDuplicateSignals({
      content,
      userId,
      businessId,
      excludeReviewId,
    })

    if (!duplicate.isDuplicate) return rules

    return mergeAnalyses(rules, {
      riskScore: duplicate.riskScore,
      flags: duplicate.flags,
      sentiment: rules.sentiment,
      recommendation: 'admin_review',
      summary: duplicate.summary,
      provider: 'rules',
    })
  },

  async moderateReview({
    title,
    content,
    rating,
    businessName,
    userId,
    businessId,
    excludeReviewId,
  }) {
    const settings = await settingsService.getModerationSettings()
    const automated = await this.runAutomatedChecks({
      title,
      content,
      rating,
      userId,
      businessId,
      excludeReviewId,
    })

    // Even when AI toggle is off, keep automated fraud/policy checks (Trustpilot-style processing).
    if (!settings.aiModerationEnabled) {
      const analysis = {
        ...automated,
        summary: `${automated.summary} | AI moderation disabled — automated checks only`,
        provider: 'rules',
      }
      return {
        analysis,
        shouldPublish: this.shouldAutoPublish(analysis, settings.autoPublishThreshold),
        settings,
        processing: true,
      }
    }

    let aiAnalysis
    if (!env.AI_API_KEY) {
      aiAnalysis = this.fallbackAnalysis({
        title,
        content,
        rating,
        autoPublishThreshold: settings.autoPublishThreshold,
      })
    } else {
      try {
        aiAnalysis = await this.analyzeReview({
          title,
          content,
          rating,
          businessName,
          autoPublishThreshold: settings.autoPublishThreshold,
        })
      } catch (err) {
        console.error('AI moderation failed:', err.message)
        aiAnalysis = this.fallbackAnalysis({
          title,
          content,
          rating,
          autoPublishThreshold: settings.autoPublishThreshold,
        })
      }
    }

    const analysis = mergeAnalyses(aiAnalysis, automated)

    return {
      analysis,
      shouldPublish: this.shouldAutoPublish(analysis, settings.autoPublishThreshold),
      settings,
      processing: true,
    }
  },

  async analyzeReview({ title, content, rating, businessName, autoPublishThreshold }) {
    const threshold = autoPublishThreshold ?? env.AI_AUTO_PUBLISH_THRESHOLD

    if (!env.AI_API_KEY) {
      return this.fallbackAnalysis({ title, content, rating, autoPublishThreshold: threshold })
    }

    const userPrompt = `Business: ${businessName}\nRating: ${rating}/5\nTitle: ${title}\nReview: ${content}`

    try {
      if (env.AI_PROVIDER === 'openai') {
        return await this.analyzeWithOpenAI(userPrompt)
      }
      return await this.analyzeWithGemini(userPrompt)
    } catch (err) {
      console.error('AI moderation failed:', err.message)
      return this.fallbackAnalysis({ title, content, rating, autoPublishThreshold: threshold })
    }
  },

  async analyzeWithGemini(userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.AI_MODEL}:generateContent`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.AI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: MODERATION_PROMPT }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('Gemini API error:', response.status, errorBody)
      throw new Error(`Gemini API error: ${response.status}`)
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    const result = parseJsonResponse(text)

    return normalizeAnalysis(result, 'gemini')
  },

  async analyzeWithOpenAI(userPrompt) {
    const response = await fetch(`${env.AI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.AI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: MODERATION_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('OpenAI API error:', response.status, errorBody)
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const result = parseJsonResponse(data.choices[0].message.content)

    return normalizeAnalysis(result, 'openai')
  },

  fallbackAnalysis({ title, content, rating, autoPublishThreshold }) {
    const threshold = autoPublishThreshold ?? env.AI_AUTO_PUBLISH_THRESHOLD
    const rules = ruleBasedFlags({ title, content, rating })
    const recommendation = rules.riskScore <= threshold && rules.flags.length === 0
      ? 'publish'
      : rules.riskScore <= threshold
        ? rules.recommendation
        : 'admin_review'

    return {
      ...rules,
      recommendation,
      summary: `${rules.summary} (rule-based fallback — AI API unavailable)`,
      provider: 'fallback',
    }
  },

  shouldAutoPublish(analysis, autoPublishThreshold) {
    const threshold = autoPublishThreshold ?? env.AI_AUTO_PUBLISH_THRESHOLD
    if (analysis.recommendation !== 'publish') return false
    if (analysis.riskScore > threshold) return false
    // Hard holds: never auto-publish these without admin
    const hardFlags = ['offensive', 'personal_info', 'duplicate', 'spam', 'promotional']
    if ((analysis.flags || []).some((f) => hardFlags.includes(f))) return false
    return true
  },
}
