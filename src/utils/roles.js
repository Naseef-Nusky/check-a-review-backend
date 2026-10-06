export const CRM_ROLES = ['super_admin', 'admin', 'viewer', 'business_adder']
export const STAFF_CREATABLE_ROLES = ['admin', 'viewer', 'business_adder']
export const CRM_FULL_WRITE_ROLES = ['super_admin', 'admin']

export function isCrmRole(role) {
  return CRM_ROLES.includes(role)
}

export function isSuperAdmin(role) {
  return role === 'super_admin'
}

export function isViewer(role) {
  return role === 'viewer'
}

export function isBusinessAdder(role) {
  return role === 'business_adder'
}

/** Full CRM writes (reviews, claims, edit businesses, etc.) */
export function canCrmWrite(role) {
  return CRM_FULL_WRITE_ROLES.includes(role)
}

/** Create new business listings only */
export function canCrmCreateBusiness(role) {
  return canCrmWrite(role) || role === 'business_adder'
}

export function crmRoleSqlList() {
  return CRM_ROLES.map((r) => `'${r}'`).join(', ')
}
