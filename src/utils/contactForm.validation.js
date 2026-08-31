const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_RE = /^[a-zA-ZÀ-ÿ\s'-]+$/

export function normalizeWebsiteUrl(input) {
  let raw = String(input || '').trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`
  try {
    const url = new URL(raw)
    const hostname = url.hostname.replace(/^www\./, '')
    if (!hostname || !hostname.includes('.') || hostname.length > 253) return null
    return raw
  } catch {
    return null
  }
}

function validateName(value, label) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return `${label} is required`
  if (trimmed.length > 80) return `${label} must be 80 characters or fewer`
  if (!NAME_RE.test(trimmed)) return `${label} can only contain letters, spaces, hyphens, and apostrophes`
  return null
}

function validatePhone(phone, phoneCode) {
  const local = String(phone || '').trim()
  if (!local) return 'Phone number is required'

  const digits = local.replace(/\D/g, '')
  if (digits.length < 6) return 'Enter a valid phone number (at least 6 digits)'
  if (digits.length > 15) return 'Phone number is too long'

  const code = String(phoneCode || '').trim()
  if (code && !/^\+\d{1,4}$/.test(code)) return 'Select a valid country code'

  return null
}

export function validateSimpleContactBody(body) {
  const errors = []
  const push = (field, message) => errors.push({ field, message })

  const name = String(body.name || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const subject = String(body.subject || '').trim()
  const message = String(body.message || '').trim()

  if (!name) push('name', 'Name is required')
  else if (name.length > 120) push('name', 'Name must be 120 characters or fewer')

  if (!email) push('email', 'Valid email required')
  else if (!EMAIL_RE.test(email)) push('email', 'Valid email required')
  else if (email.length > 254) push('email', 'Email address is too long')

  if (!subject) push('subject', 'Subject is required')
  else if (subject.length > 200) push('subject', 'Subject must be 200 characters or fewer')

  if (!message) push('message', 'Message is required')
  else if (message.length < 10) push('message', 'Message must be at least 10 characters')
  else if (message.length > 5000) push('message', 'Message must be 5000 characters or fewer')

  return {
    errors,
    isValid: errors.length === 0,
    payload: { name, email, subject, message },
  }
}

export function isSalesContactBody(body) {
  return Boolean(
    body.firstName ||
      body.lastName ||
      body.companyName ||
      body.websiteUrl ||
      body.jobTitle ||
      body.country ||
      body.phone,
  )
}

export function validateContactFormBody(body) {
  const errors = []

  const push = (field, message) => errors.push({ field, message })

  const firstNameError = validateName(body.firstName, 'First name')
  if (firstNameError) push('firstName', firstNameError)

  const lastNameError = validateName(body.lastName, 'Last name')
  if (lastNameError) push('lastName', lastNameError)

  const email = String(body.email || '').trim().toLowerCase()
  if (!email) push('email', 'Valid business email required')
  else if (!EMAIL_RE.test(email)) push('email', 'Valid business email required')
  else if (email.length > 254) push('email', 'Email address is too long')

  const websiteRaw = String(body.websiteUrl || '').trim()
  const normalizedWebsite = websiteRaw ? normalizeWebsiteUrl(websiteRaw) : null
  if (!websiteRaw) push('websiteUrl', 'Website URL is required')
  else if (!normalizedWebsite) push('websiteUrl', 'Enter a valid website URL, e.g. mybusiness.com')

  const country = String(body.country || '').trim()
  if (!country) push('country', 'Country is required')
  else if (country.length > 120) push('country', 'Country is invalid')

  const phoneError = validatePhone(body.phone, body.phoneCode)
  if (phoneError) push('phone', phoneError)

  const companyName = String(body.companyName || '').trim()
  if (!companyName) push('companyName', 'Company name is required')
  else if (companyName.length > 200) push('companyName', 'Company name must be 200 characters or fewer')

  const jobTitle = String(body.jobTitle || '').trim()
  if (!jobTitle) push('jobTitle', 'Job title is required')
  else if (jobTitle.length > 100) push('jobTitle', 'Job title must be 100 characters or fewer')

  const message = String(body.message || '').trim()
  if (!message) push('message', 'Message is required')
  else if (message.length < 10) push('message', 'Message must be at least 10 characters')
  else if (message.length > 5000) push('message', 'Message must be 5000 characters or fewer')

  const phoneCode = String(body.phoneCode || '').trim()
  const phone = String(body.phone || '').trim()
  const fullPhone = phoneCode && !phone.startsWith('+') ? `${phoneCode} ${phone}`.trim() : phone

  return {
    errors,
    isValid: errors.length === 0,
    payload: {
      firstName: String(body.firstName || '').trim(),
      lastName: String(body.lastName || '').trim(),
      email,
      websiteUrl: normalizedWebsite || websiteRaw,
      country,
      phone: fullPhone,
      companyName,
      jobTitle,
      message,
      source: String(body.source || 'website').trim(),
    },
  }
}
