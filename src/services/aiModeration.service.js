import { env } from '../config/env.js'
import { settingsService } from './settings.service.js'

const MODERATION_PROMPT = `You are a review moderation API for a business review platform.
Analyze the customer review and return JSON ONLY with this exact shape:
{
  "riskScore": <number 0-100>,
  "flags": <array of zero or more of: "spam", "offensive", "fake_pattern", "duplicate", "low_sentiment", "low_content">,
  "sentiment": "positive" | "neutral" | "negative",
  "recommendation": "publish" | "admin_review",
  "summary": "<brief explanation>"
}

Rules:
- riskScore 0 = safe, 100 = high risk
- recommendation must be exactly "publish" or "admin_review" (never a sentence)
- Use "publish" only when the review looks genuine and low-risk
- Use "admin_review" for spam, abuse, fake patterns, or unclear/suspicious content
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
  const recommendation = recommendationRaw.includes('publish') && !recommendationRaw.includes('admin')
    ? 'publish'
    : recommendationRaw.includes('admin') || recommendationRaw.includes('review')
      ? 'admin_review'
      : 'admin_review'

  const sentimentRaw = String(result.sentiment || 'neutral').toLowerCase()
  const sentiment = ['positive', 'neutral', 'negative'].includes(sentimentRaw)
    ? sentimentRaw
    : 'neutral'

  return {
    riskScore: Number(result.riskScore ?? 50),
    flags: Array.isArray(result.flags) ? result.flags : [],
    sentiment,
    recommendation,
    summary: result.summary ?? '',
    provider,
  }
}

export const aiModerationService = {
  isConfigured() {
    return !!env.AI_API_KEY
  },

  async moderateReview({ title, content, rating, businessName }) {
    const settings = await settingsService.getModerationSettings()

    if (!settings.aiModerationEnabled) {
      const analysis = {
        riskScore: 0,
        flags: [],
        sentiment: 'neutral',
        recommendation: 'publish',
        summary: 'AI moderation disabled in CRM settings — review published without screening',
        provider: 'disabled',
      }
      return { analysis, shouldPublish: true, settings }
    }

    const analysis = await this.analyzeReview({
      title,
      content,
      rating,
      businessName,
      autoPublishThreshold: settings.autoPublishThreshold,
    })

    return {
      analysis,
      shouldPublish: this.shouldAutoPublish(analysis, settings.autoPublishThreshold),
      settings,
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
    const flags = []
    let riskScore = 10

    const spamPatterns = [/click here/i, /buy now/i, /http:\/\//i, /www\./i]
    const offensivePatterns = [/damn/i, /hate/i, /stupid/i, /idiot/i]

    if (spamPatterns.some((p) => p.test(content) || p.test(title))) {
      flags.push('spam')
      riskScore += 40
    }
    if (offensivePatterns.some((p) => p.test(content))) {
      flags.push('offensive')
      riskScore += 30
    }
    if (content.length < 20) {
      flags.push('low_content')
      riskScore += 20
    }
    if (rating === 5 && content.length < 30) {
      flags.push('fake_pattern')
      riskScore += 15
    }

    const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral'
    const recommendation = riskScore <= threshold ? 'publish' : 'admin_review'

    return {
      riskScore: Math.min(riskScore, 100),
      flags,
      sentiment,
      recommendation,
      summary: 'Rule-based fallback analysis (AI API not configured or unavailable)',
      provider: 'fallback',
    }
  },

  shouldAutoPublish(analysis, autoPublishThreshold) {
    const threshold = autoPublishThreshold ?? env.AI_AUTO_PUBLISH_THRESHOLD
    return analysis.riskScore <= threshold && analysis.recommendation === 'publish'
  },
}
