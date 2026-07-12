import { env } from '../config/env.js'

const MODERATION_PROMPT = `Analyze this customer review for a business review platform.
Check for: spam, duplicate patterns, offensive language, fake review patterns, and sentiment.
Return JSON only with this structure:
{
  "riskScore": 0-100 (0=safe, 100=high risk),
  "flags": ["spam", "offensive", "fake_pattern", "duplicate", "low_sentiment"],
  "sentiment": "positive" | "neutral" | "negative",
  "recommendation": "publish" | "admin_review",
  "summary": "brief explanation"
}`

export const aiModerationService = {
  isConfigured() {
    return !!env.AI_API_KEY
  },

  async analyzeReview({ title, content, rating, businessName }) {
    if (!env.AI_API_KEY) {
      return this.fallbackAnalysis({ title, content, rating })
    }

    try {
      const response = await fetch(`${env.AI_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: MODERATION_PROMPT },
            {
              role: 'user',
              content: `Business: ${businessName}\nRating: ${rating}/5\nTitle: ${title}\nReview: ${content}`,
            },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      })

      if (!response.ok) {
        console.error('AI API error:', response.statusText)
        return this.fallbackAnalysis({ title, content, rating })
      }

      const data = await response.json()
      const result = JSON.parse(data.choices[0].message.content)

      return {
        riskScore: result.riskScore ?? 50,
        flags: result.flags ?? [],
        sentiment: result.sentiment ?? 'neutral',
        recommendation: result.recommendation ?? 'admin_review',
        summary: result.summary ?? '',
      }
    } catch (err) {
      console.error('AI moderation failed:', err.message)
      return this.fallbackAnalysis({ title, content, rating })
    }
  },

  fallbackAnalysis({ title, content, rating }) {
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
    const recommendation = riskScore <= env.AI_AUTO_PUBLISH_THRESHOLD ? 'publish' : 'admin_review'

    return {
      riskScore: Math.min(riskScore, 100),
      flags,
      sentiment,
      recommendation,
      summary: 'Rule-based fallback analysis (AI API not configured or unavailable)',
    }
  },

  shouldAutoPublish(analysis) {
    return analysis.riskScore <= env.AI_AUTO_PUBLISH_THRESHOLD
      && analysis.recommendation === 'publish'
  },
}
