export const CRM_ROLES = ['super_admin', 'admin', 'viewer']
export const STAFF_CREATABLE_ROLES = ['admin', 'viewer']

export function isCrmRole(role) {
  return CRM_ROLES.includes(role)
}

export function isSuperAdmin(role) {
  return role === 'super_admin'
}
